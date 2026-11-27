#!/usr/bin/env node
/**
 * End-to-end check of Phase 3, connecting sheets to a DM's game, against the production build.
 *
 * The DM and two players each get their own browser profile, as on separate devices. Signalling goes through a
 * WebSocket relay started here on this machine (the same code a group can run themselves), so the test doesn't
 * depend on public relays. Game data then flows directly between the browsers over WebRTC.
 *
 *   pnpm --filter @mimicbox/companion build && node tests/e2e/table.mjs
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const DIST = resolve("apps/companion/dist");
const SHOTS = resolve("tests/e2e/screenshots/table");
const FIXTURES = resolve("tests/e2e/fixtures");
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(join(DIST, "studio.html"))) {
  console.error("Build the app first: pnpm --filter @mimicbox/companion build");
  process.exit(1);
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".webmanifest": "application/manifest+json", ".map": "application/json" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(DIST, path === "/" ? "index.html" : path);
  if (!file.startsWith(DIST) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const { createWsRelayServer } = await import(pathToFileURL(resolve("packages/table/node_modules/@trystero-p2p/ws-relay/dist/server.mjs")).href);
const relay = createWsRelayServer({ host: "127.0.0.1", port: 0 });
await relay.ready;
const relayUrl = `ws://127.0.0.1:${relay.address().port}`;

// The QR decoder the app uses, from the app's own dependencies.
const jsQR = createRequire(resolve("apps/companion/package.json"))("jsqr");
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  // Let two browser profiles on one machine reach each other directly.
  args: ["--no-sandbox", "--disable-features=WebRtcHideLocalIpsWithMdns"],
});
const errors = [];
async function device(name, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  return { context, page };
}
let step = 0;
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${String(++step).padStart(2, "0")}-${name}.png`) });
const check = (cond, message) => {
  if (!cond) throw new Error(`Check failed: ${message}`);
  console.log(`  ok  ${message}`);
};
const text = (page) => page.locator("main").innerText();
async function eventually(fn, message, timeout = 20000) {
  const until = Date.now() + timeout;
  for (;;) {
    if (await fn().catch(() => false)) return check(true, message);
    if (Date.now() > until) return check(false, message);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function bringCharacter(page, fixture) {
  await page.goto(base);
  await page.getByText("Your vault is empty").waitFor();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import a file" }).click();
  await (await chooser).setFiles(join(FIXTURES, fixture));
  await page.getByText(/^Imported /).waitFor();
}

/** The DM's studio: Play mode, or a Prepare tab (world, maps, handouts, players, campaign). */
async function dmTo(page, place) {
  const mode = place === "play" ? "Play" : "Prepare";
  const switcher = page.getByRole("group", { name: "Mode" }).getByRole("button", { name: mode });
  if ((await switcher.getAttribute("aria-pressed")) !== "true") await switcher.click();
  if (place === "play") return;
  const names = { world: "World", maps: "Maps", handouts: "Handouts", players: "Players", campaign: "Campaign" };
  const tab = page.getByRole("navigation", { name: "Prepare" }).getByRole("button", { name: names[place], exact: true });
  if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
}

/** The player's table view (the map), opened from the sheet's Map chip. */
async function openTable(page) {
  if ((await page.locator(".table-view").count()) === 0) await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.locator(".table-view").waitFor();
}
/** Back to the sheet from the table view, by the sheet's own tabs on a phone. */
async function openSheet(page) {
  if ((await page.locator(".table-view").count()) === 0) return;
  await page.getByRole("navigation", { name: "Sheet sections" }).getByRole("button", { name: "Actions" }).click();
  await page.locator(".table-view").waitFor({ state: "detached" });
}

async function joinGame(page, inviteUrl, playerName) {
  await page.goto(inviteUrl);
  await page.getByLabel("Your name at the table").fill(playerName);
  await page.getByRole("button", { name: "Join the game" }).click();
}

const dm = await device("DM", { width: 1366, height: 900 });
const alice = await device("Alice", { width: 390, height: 844 });
const bob = await device("Bob", { width: 390, height: 844 });

try {
  // ----- The DM creates a campaign and starts hosting -----
  await dm.page.goto(`${base}studio.html?relay=${encodeURIComponent(relayUrl)}`);
  await dm.page.getByLabel("Campaign name").fill("The Sunken Bell");
  await dm.page.getByRole("button", { name: "Create campaign" }).click();
  await dm.page.getByRole("heading", { name: "The Sunken Bell" }).waitFor();
  const inviteInput = dm.page.getByRole("textbox", { name: "Invite link" });
  await inviteInput.waitFor();
  const invite = await inviteInput.inputValue();
  check(/#\/join\/[\w-]+$/.test(invite), "the DM gets an invite link");
  check((await dm.page.getByRole("img", { name: "QR code of the invite link" }).locator("svg").count()) === 1, "with a QR code");
  await shot(dm.page, "dm-hosting");

  // ----- Alice joins with Wren -----
  await bringCharacter(alice.page, "wren.mimicbox-character");
  await joinGame(alice.page, invite, "Alice");
  await alice.page.getByRole("heading", { name: "Wren Ashdown" }).waitFor();
  await eventually(async () => /At The Sunken Bell/.test(await alice.page.locator(".sheet-top").innerText()), "Alice's sheet connects to the DM");
  await eventually(async () => /Wren Ashdown/.test(await text(dm.page)) && /Played by Alice/.test(await text(dm.page)), "the DM sees Wren, played by Alice");
  check(/11\s*\/\s*12/.test(await dm.page.locator(".member", { hasText: "Wren Ashdown" }).innerText()), "with her hit points (11 of 12)");

  // Damage on Alice's sheet reaches the DM.
  await alice.page.locator(".hp-vital").click();
  await alice.page.getByLabel("Amount").fill("5");
  await alice.page.getByRole("button", { name: "Take damage" }).click();
  await alice.page.keyboard.press("Escape");
  await eventually(async () => /6\s*\/\s*12/.test(await dm.page.locator(".member", { hasText: "Wren Ashdown" }).innerText()), "damage on Alice's sheet shows on the DM's page");

  // A roll on Alice's sheet reaches the DM's log.
  await alice.page.getByRole("button", { name: "Skills" }).click();
  await alice.page.locator(".roll-row", { hasText: /^Athletics/ }).click();
  await alice.page.locator(".roll-result .total").waitFor();
  const aliceRoll = await alice.page.locator(".roll-result .total").innerText();
  await alice.page.keyboard.press("Escape");
  await dmTo(dm.page, "play");
  await eventually(async () => (await dm.page.getByRole("list", { name: "Rolls" }).innerText()).includes("Wren Ashdown (Alice): Athletics"), `Alice's Athletics roll (${aliceRoll}) appears in the DM's log`);

  // ----- Secret and public DM rolls -----
  await dm.page.getByLabel("For", { exact: true }).fill("Ambush");
  await dm.page.getByRole("button", { name: "Roll in secret" }).click();
  await dm.page.getByLabel("For", { exact: true }).fill("Ogre club");
  await dm.page.getByLabel("Dice").fill("2d8+4");
  await dm.page.getByRole("button", { name: "Roll for the table" }).click();
  check(/Ambush\s*Only you/.test(await dm.page.getByRole("list", { name: "Rolls" }).innerText()), "the DM's secret roll is marked Only you");
  await alice.page.locator(".chip-table").click();
  await eventually(async () => /DM: Ogre club/.test(await alice.page.getByRole("list", { name: "Table rolls" }).innerText()), "Alice sees the DM's public roll");
  check(!/Ambush/.test(await alice.page.getByRole("dialog").innerText()), "Alice never receives the secret roll");
  await shot(alice.page, "alice-party");
  await alice.page.keyboard.press("Escape");

  // ----- The table display -----
  const [display] = await Promise.all([dm.page.waitForEvent("popup"), dm.page.getByRole("button", { name: "Open table display" }).click()]);
  display.on("pageerror", (e) => errors.push(`Display: ${e.message}`));
  await display.setViewportSize({ width: 1280, height: 720 });
  await display.getByRole("heading", { name: "Wren Ashdown" }).waitFor();
  const shown = await display.locator("main").innerText();
  check(/HP 6\/12/.test(shown) && /Ogre club/.test(shown), "the display shows the party and public rolls");
  check(!/Ambush/.test(shown), "the display never receives the secret roll");
  await shot(display, "display");

  // ----- Handouts: written in private, shown when the DM chooses -----
  await dmTo(dm.page, "handouts");
  const writeHandout = async (title, body, picture) => {
    await dm.page.getByRole("button", { name: "Write a handout" }).click();
    await dm.page.getByLabel("Title").fill(title);
    await dm.page.getByLabel("Text").fill(body);
    if (picture) {
      await dm.page.getByLabel("Handout picture").setInputFiles(join(FIXTURES, picture));
      await dm.page.getByRole("button", { name: "Replace picture" }).waitFor();
    }
    await dm.page.getByRole("button", { name: "Save handout" }).click();
  };
  await writeHandout("The ferryman's letter", "Meet me at the **Sunken Bell** at midnight.", "docks.png");
  await writeHandout("Villain's plan", "Flood the lower city.", "docks.png");
  await alice.page.waitForTimeout(1000);
  await alice.page.locator(".chip-table").click();
  check(!/ferryman|Villain/.test(await alice.page.getByRole("dialog").innerText()), "saved handouts stay with the DM");
  await alice.page.keyboard.press("Escape");
  await dm.page.getByRole("article", { name: "The ferryman's letter" }).getByRole("button", { name: "Show to the party" }).click();
  await eventually(async () => (await alice.page.getByText("New handout: The ferryman's letter").count()) > 0, "Alice is told about the new handout");
  await alice.page.locator(".chip-table").click();
  const drawer = await alice.page.getByRole("dialog").innerText();
  check(/The ferryman's letter/.test(drawer) && !/Villain's plan/.test(drawer), "Alice gets the shown handout and not the hidden one");
  await alice.page.getByRole("dialog").getByText("The ferryman's letter").click();
  check(/Meet me at the Sunken Bell at midnight/.test(await alice.page.getByRole("dialog").innerText()), "and can read it");
  await eventually(
    async () => alice.page.getByRole("dialog").locator("img.handout-image").evaluateAll((imgs) => imgs.length === 1 && imgs[0].complete && imgs[0].naturalWidth > 0),
    "with its picture, and only that one picture",
  );
  await shot(alice.page, "alice-handout");
  await alice.page.keyboard.press("Escape");
  await eventually(async () => /Meet me at the Sunken Bell/.test(await display.locator("main").innerText()), "the display shows the handout");
  check(!/Flood the lower city/.test(await display.locator("main").innerText()), "but never the hidden one");
  await eventually(async () => display.locator(".display-handout img.handout-image").evaluateAll((imgs) => imgs.length === 1 && imgs[0].naturalWidth > 0), "the display shows its picture too");
  await shot(display, "display-handout");
  await dm.page.getByRole("article", { name: "The ferryman's letter" }).getByRole("button", { name: "Hide again" }).click();
  await eventually(async () => !/ferryman/.test(await display.locator("main").innerText()), "hiding it again takes it off the display");

  // ----- Combat: initiative from the sheet, hidden creatures, turns -----
  await dmTo(dm.page, "play");
  await dm.page.getByRole("button", { name: "Start combat" }).click();
  await alice.page.getByRole("button", { name: "Roll initiative" }).waitFor({ timeout: 20000 });
  check(true, "Alice is asked to roll initiative");
  await alice.page.getByRole("button", { name: "Roll initiative" }).click();
  await alice.page.locator(".roll-result .total").waitFor();
  const aliceInit = Number(await alice.page.locator(".roll-result .total").innerText());
  await alice.page.keyboard.press("Escape");
  await eventually(async () => (await dm.page.getByLabel("Wren Ashdown initiative").inputValue()) === String(aliceInit), `Alice's initiative (${aliceInit}) lands in the DM's order`);
  const addCreature = async (name, bonus, hp, hiddenCreature) => {
    await dm.page.getByLabel("Creature").fill(name);
    await dm.page.getByLabel("Init bonus").fill(String(bonus));
    await dm.page.getByLabel("HP", { exact: true }).fill(String(hp));
    if (hiddenCreature) await dm.page.getByRole("checkbox", { name: "Hidden" }).check();
    await dm.page.getByRole("button", { name: "Add and roll" }).click();
    if (hiddenCreature) await dm.page.getByRole("checkbox", { name: "Hidden" }).uncheck();
  };
  await addCreature("Ogre", -1, 59, false);
  await addCreature("Shadow assassin", 30, 30, true);
  await dm.page.getByRole("button", { name: "First turn" }).click();
  await eventually(async () => /Round 1\./.test(await alice.page.locator(".combat-banner").innerText()), "the fight starts on Alice's sheet");
  check(!/assassin/i.test(await alice.page.locator(".combat-banner").innerText()), "the hidden assassin's turn shows no name to Alice");
  await eventually(async () => /Round 1/.test(await display.locator("main").innerText()), "the display shows the initiative order");
  check(!/assassin/i.test(await display.locator("main").innerText()) && !/59/.test(await display.locator("main").innerText()), "without the hidden assassin or creature hit points");
  for (let i = 0; i < 3 && !/Your turn/.test(await alice.page.locator(".combat-banner").innerText()); i++) {
    await dm.page.getByRole("button", { name: "Next turn" }).click();
    await alice.page.waitForTimeout(800);
  }
  check(/Your turn\. Round 1\./.test(await alice.page.locator(".combat-banner").innerText()), "Alice's sheet tells her when it's her turn");
  await shot(alice.page, "alice-your-turn");
  await shot(dm.page, "dm-combat");
  await shot(display, "display-combat");
  await dm.page.getByRole("region", { name: "Combat" }).getByRole("button", { name: "End combat" }).click();
  await dm.page.getByRole("button", { name: "End combat" }).first().click();
  await eventually(async () => (await alice.page.locator(".combat-banner").count()) === 0, "ending combat clears it from Alice's sheet");

  // ----- Maps: fog of war, tokens, the display -----
  await dmTo(dm.page, "maps");
  const mapChooser = dm.page.waitForEvent("filechooser");
  await dm.page.getByRole("button", { name: "Add a map" }).click();
  await (await mapChooser).setFiles(join(FIXTURES, "docks.png"));
  await dm.page.getByRole("button", { name: /^docks/ }).waitFor({ timeout: 20000 });
  // Line the grid up with the 100-pixel squares drawn on this map.
  await dm.page.getByText("Grid", { exact: true }).click();
  await dm.page.getByLabel("Square size (px)").fill("100");
  await dm.page.getByRole("button", { name: "Apply grid" }).click();
  await dm.page.getByLabel("Creature token").fill("Spy");
  await dm.page.getByRole("checkbox", { name: "Hidden" }).last().check();
  await dm.page.getByRole("button", { name: "Add token" }).click();
  // Reveal the top-left two squares by dragging across them.
  await dm.page.getByRole("button", { name: "Reveal squares" }).click();
  const dmSurface = dm.page.getByRole("img", { name: "docks, as you see it" }).locator(".map-surface");
  const box = await dmSurface.boundingBox();
  const k = box.width / 1100;
  await dm.page.mouse.move(box.x + 50 * k, box.y + 50 * k);
  await dm.page.mouse.down();
  await dm.page.mouse.move(box.x + 150 * k, box.y + 50 * k, { steps: 5 });
  await dm.page.mouse.up();
  check(/2 of 66 squares revealed/.test(await text(dm.page)), "the DM reveals two squares by dragging");
  await dm.page.getByRole("button", { name: "Show this map to players" }).click();
  await shot(dm.page, "dm-map");

  await openTable(alice.page);
  const aliceMap = alice.page.getByRole("img", { name: "docks, the parts you can see" });
  await eventually(async () => (await aliceMap.locator(".map-surface > img").count()) === 1, "Alice receives only the one tile with revealed squares");
  const pixel = async (x, y) =>
    aliceMap.locator(".map-surface > img").evaluate(
      (img, [px, py]) => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return [...ctx.getImageData(px, py, 1, 1).data.slice(0, 3)];
      },
      [x, y],
    );
  await alice.page.waitForTimeout(500);
  const secret = await pixel(350, 330);
  const open = await pixel(50, 50);
  check(secret[0] < 60 && secret[1] < 60, `the fogged square's pixels are painted over before they reach Alice (got rgb ${secret.join(",")})`);
  check(open[0] > 120, `the revealed square shows the map (rgb ${open.join(",")})`);
  check((await aliceMap.getByRole("button", { name: /Spy/ }).count()) === 0, "the hidden Spy token never reaches Alice");
  // Alice moves her token one square right.
  const token = aliceMap.getByRole("button", { name: "Wren Ashdown" });
  const tb = await token.boundingBox();
  const ak = (await aliceMap.locator(".map-surface").boundingBox()).width / 1100;
  await alice.page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await alice.page.mouse.down();
  await alice.page.mouse.move(tb.x + tb.width / 2 + 100 * ak, tb.y + tb.height / 2, { steps: 5 });
  await alice.page.mouse.up();
  await shot(alice.page, "alice-map");
  const dmToken = dm.page.getByRole("img", { name: "docks, as you see it" }).getByRole("button", { name: "Wren Ashdown" });
  await eventually(async () => {
    const b = await dmToken.boundingBox();
    return b.x - box.x > 100 * k;
  }, "Alice's move shows on the DM's map");
  // Alice measures three squares across.
  await alice.page.getByRole("button", { name: "Measure" }).click();
  const as = await aliceMap.locator(".map-surface").boundingBox();
  await alice.page.mouse.move(as.x + 50 * ak, as.y + 50 * ak);
  await alice.page.mouse.down();
  await alice.page.mouse.move(as.x + 350 * ak, as.y + 150 * ak, { steps: 6 });
  await alice.page.mouse.up();
  check((await alice.page.getByRole("status").filter({ hasText: "ft" }).innerText()) === "15 ft", "measuring three squares across and one down reads 15 ft");
  await alice.page.getByRole("button", { name: "Move my token" }).click();
  await openSheet(alice.page);
  await eventually(async () => (await display.locator(".display-map .map-surface > img").count()) === 1, "the display shows the revealed part of the map");
  check((await display.getByRole("button", { name: /Spy/ }).count()) === 0, "without the hidden Spy");
  await shot(display, "display-map");

  // Walls and a door: exploring reveals what Wren can see, and the door holds back the rest until it opens.
  // The help text changes with the tool, which can move the map: measure it again before each action.
  const at = async (px, py) => {
    await dm.page.getByRole("img", { name: "docks, as you see it" }).scrollIntoViewIfNeeded();
    const b = await dmSurface.boundingBox();
    const kk = b.width / 1100;
    return [b.x + px * kk, b.y + py * kk];
  };
  const drag = async (from, to) => {
    await dm.page.mouse.move(...(await at(...from)));
    await dm.page.mouse.down();
    await dm.page.mouse.move(...(await at(...to)), { steps: 8 });
    await dm.page.mouse.up();
  };

  // Pins on two layers: the DM's own, and the players' (shown on revealed squares only).
  await dm.page.getByRole("button", { name: "Pins", exact: true }).click();
  await dm.page.getByLabel("Pin text").fill("Trap: poison needle");
  await dm.page.mouse.click(...(await at(50, 50)));
  await dm.page.getByRole("button", { name: "Players too" }).click();
  await dm.page.getByLabel("Pin text").fill("Way out");
  await dm.page.mouse.click(...(await at(150, 50)));
  await dm.page.getByLabel("Pin text").fill("Boat");
  await dm.page.mouse.click(...(await at(850, 450))); // a square nobody has revealed
  const dmMapPins = dm.page.getByRole("img", { name: "docks, as you see it" }).locator(".pin");
  check((await dmMapPins.count()) === 3, "the DM places three pins: one only for themselves, two for players");
  await openTable(alice.page);
  await eventually(async () => (await aliceMap.getByLabel("Pin: Way out").count()) === 1, "Alice sees the players' pin on a revealed square");
  check((await aliceMap.locator(".pin").count()) === 1, "but not the DM's trap, or the pin on a square she can't see");
  const pinBox = await aliceMap.getByLabel("Pin: Way out").boundingBox();
  const mapBoxA = await aliceMap.boundingBox();
  check(pinBox.y >= mapBoxA.y && pinBox.y + pinBox.height <= mapBoxA.y + mapBoxA.height, "and the pin on the top row is drawn inside the map, not cut off");
  await eventually(async () => (await display.locator(".pin").count()) === 1, "the display shows the same one pin");
  await dm.page.getByRole("button", { name: "Your pins" }).click();
  check((await dmMapPins.count()) === 2, "the DM can hide their own pins from their view");
  await dm.page.getByRole("button", { name: "Your pins" }).click();
  await shot(dm.page, "dm-pins");
  await shot(alice.page, "alice-pins");

  // The table view uses the screen (docs/design.md): the map fills a phone in portrait, and on its side the map
  // shares the screen with a side panel that folds away and is remembered.
  const portraitBox = await alice.page.locator(".table-map .map-box").boundingBox();
  const portraitSurface = await alice.page.locator(".table-map .map-surface").boundingBox();
  check(portraitBox.width > 390 * 0.9 && portraitBox.height <= portraitSurface.height + 2, `in portrait the map takes the phone's width with no empty band below it (${Math.round(portraitBox.width)} by ${Math.round(portraitBox.height)} pixels)`);
  check(/Wren Ashdown/.test(await alice.page.locator(".table-below").innerText()), "and the party fills the space under the map");
  await alice.page.setViewportSize({ width: 844, height: 390 });
  await alice.page.getByRole("complementary", { name: "Side panel" }).waitFor();
  check((await alice.page.getByRole("navigation", { name: "Sheet sections" }).count()) === 0, "on its side, the sheet tabs give way to the map");
  check(/Wren Ashdown/.test(await alice.page.getByRole("complementary", { name: "Side panel" }).innerText()), "and the party sits in a side panel beside it");
  await shot(alice.page, "alice-landscape");
  await alice.page.getByRole("button", { name: "Hide the side panel" }).click();
  await alice.page.getByRole("complementary", { name: "Side panel" }).waitFor({ state: "detached" });
  const foldedMap = await alice.page.locator(".table-map .map-box").boundingBox();
  check(foldedMap.width > 844 * 0.9, `folding the panel gives the map the whole width (${Math.round(foldedMap.width)} of 844 pixels)`);
  check((await alice.page.evaluate(() => JSON.parse(localStorage.getItem("mimicbox:table-layout") ?? "{}").open)) === false, "and the folded layout is remembered on the device");
  await alice.page.getByRole("button", { name: "Show the side panel" }).click();
  await alice.page.setViewportSize({ width: 390, height: 844 });
  await openSheet(alice.page);
  await dm.page.getByRole("button", { name: "Draw walls" }).click();
  await drag([450, 50], [450, 550]);
  await dm.page.getByRole("button", { name: "Doors", exact: true }).click();
  await dm.page.mouse.click(...(await at(450, 250)));
  await dm.page.getByRole("checkbox", { name: "Reveal as the party explores" }).check();
  await eventually(async () => /(\d+) of 66 squares revealed/.test(await text(dm.page)) && Number(/(\d+) of 66/.exec(await text(dm.page))[1]) >= 24, "exploring reveals the room Wren stands in");
  const beyond = Number(/(\d+) of 66/.exec(await text(dm.page))[1]);
  check(beyond <= 30, `but nothing past the wall (${beyond} of 66 squares)`);
  await shot(dm.page, "dm-walls");
  await dm.page.mouse.click(...(await at(450, 250))); // open the door
  await eventually(async () => Number(/(\d+) of 66/.exec(await text(dm.page))[1]) > beyond, "opening the door lets Wren see through it");
  await eventually(async () => (await display.locator(".display-map .map-surface > img").count()) > 2, "and the newly seen tiles reach the table display");

  // A door next to Wren (she stands at column 1, row 0): Alice opens it from her sheet.
  await openTable(alice.page);
  await aliceMap.locator(".map-surface").waitFor();
  const aliceDoorsBefore = await aliceMap.locator(".map-overlay .door").count();
  await dm.page.mouse.click(...(await at(250, 150)));
  const dmDoors = dm.page.getByRole("img", { name: "docks, as you see it" }).locator(".map-overlay .door.open");
  const openBefore = await dmDoors.count();
  // Wait for this new door to reach Alice's map, not one she could already see.
  await eventually(async () => (await aliceMap.locator(".map-overlay .door").count()) > aliceDoorsBefore, "Alice sees the door next to her");
  const ab = await aliceMap.locator(".map-surface").boundingBox();
  const ak2 = ab.width / 1100;
  await alice.page.mouse.click(ab.x + 250 * ak2, ab.y + 150 * ak2);
  await eventually(async () => (await dmDoors.count()) === openBefore + 1, "Alice opens it from her sheet and the DM's map shows it open");

  // Turns light up the acting token.
  await openSheet(alice.page);
  await dmTo(dm.page, "play");
  await dm.page.getByRole("button", { name: "Reveal all" }).click();
  await dm.page.getByRole("button", { name: "Start combat" }).click();
  await dm.page.getByLabel("Creature", { exact: true }).fill("Ogre");
  await dm.page.getByLabel("Init bonus").fill("40");
  await dm.page.getByRole("button", { name: "Add and roll" }).click();
  await dm.page.getByRole("button", { name: "First turn" }).click();
  await eventually(async () => (await display.getByRole("button", { name: "Ogre, acting now" }).count()) === 1, "the display lights up the Ogre's token on its turn");
  await dm.page.getByRole("button", { name: "Next turn" }).click();
  await openTable(alice.page);
  await eventually(async () => (await aliceMap.getByRole("button", { name: "Wren Ashdown, acting now" }).count()) === 1, "and Wren's on hers");
  await shot(alice.page, "alice-map-turn");
  await shot(display, "display-map-turn");
  await openSheet(alice.page);
  await dm.page.getByRole("region", { name: "Combat" }).getByRole("button", { name: "End combat" }).click();
  await dm.page.getByRole("button", { name: "End combat" }).first().click();

  // ----- The DM changes a player's sheet: damage, healing, conditions -----
  await dm.page.getByLabel("Amount for Wren Ashdown").fill("4");
  await dm.page.getByRole("group", { name: "Change Wren Ashdown's hit points" }).getByRole("button", { name: "Damage" }).click();
  await eventually(async () => (await alice.page.getByText("The DM dealt you 4 damage.").count()) > 0, "Alice is told the DM dealt her 4 damage");
  await eventually(async () => /2\s*\/\s*12/.test(await alice.page.locator(".hp-vital").innerText()), "her sheet drops from 6 to 2 hit points");
  await eventually(async () => /2\s*\/\s*12/.test(await dm.page.locator(".member", { hasText: "Wren Ashdown" }).innerText()), "and the DM's page follows");
  await dm.page.locator(".member", { hasText: "Wren Ashdown" }).getByText("Conditions").click();
  await dm.page.getByRole("group", { name: "Wren Ashdown's conditions" }).getByRole("button", { name: "Prone" }).click();
  await eventually(async () => /Prone/.test(await alice.page.locator(".sheet-top").innerText()), "a condition from the DM shows on Alice's sheet");
  await dm.page.getByLabel("Amount for Wren Ashdown").fill("4");
  await dm.page.getByRole("group", { name: "Change Wren Ashdown's hit points" }).getByRole("button", { name: "Heal" }).click();
  await eventually(async () => /6\s*\/\s*12/.test(await alice.page.locator(".hp-vital").innerText()), "healing from the DM brings her back to 6");
  await shot(alice.page, "alice-dm-effects");
  await dm.page.getByRole("group", { name: "Wren Ashdown's conditions" }).getByRole("button", { name: "Prone" }).click();
  await eventually(async () => !/Prone/.test(await alice.page.locator(".sheet-top").innerText()), "and clearing it removes it");

  // ----- World notes: entries and paragraphs revealed separately -----
  await dmTo(dm.page, "world");
  const world = dm.page.getByRole("region", { name: "World" });
  const entry = dm.page.getByRole("form", { name: "World entry" });
  await world.getByRole("button", { name: "New place" }).click();
  await entry.getByLabel("Place name").fill("Port Ashen");
  await entry.getByLabel("Paragraph 1").fill("A rain-soaked harbour town. Ask for [[Mara the ferrywoman]].");
  await entry.getByRole("button", { name: "Only you" }).click();
  await entry.getByRole("checkbox", { name: "Players know about this place" }).check();
  await entry.getByLabel("Picture of Port Ashen").setInputFiles(join(FIXTURES, "docks.png"));
  await entry.getByRole("button", { name: "Picture shown to players" }).click();
  await entry.getByRole("button", { name: "Save place" }).click();
  await world.getByRole("button", { name: "New place" }).click();
  await entry.getByLabel("Place name").fill("The Drowned Vault");
  await entry.getByLabel("Paragraph 1").fill("Under the lighthouse.");
  await entry.getByRole("button", { name: "Save place" }).click();
  await world.getByRole("button", { name: "New person" }).click();
  await entry.getByLabel("Person name").fill("Mara the ferrywoman");
  await entry.getByLabel("Inside").selectOption({ label: "Port Ashen" });
  await entry.getByLabel("Paragraph 1").fill("Grey cloak, kind eyes.");
  await entry.getByRole("button", { name: "Only you" }).click();
  await entry.getByRole("button", { name: "Add a paragraph" }).click();
  await entry.getByLabel("Paragraph 2").fill("Secretly serves the drowned god.");
  await entry.getByLabel("Picture of Mara the ferrywoman").setInputFiles(join(FIXTURES, "docks.png"));
  await entry.getByRole("button", { name: "Picture shown to players" }).waitFor();
  await entry.getByRole("checkbox", { name: "Players know about this person" }).check();
  await shot(dm.page, "dm-world");
  await entry.getByRole("button", { name: "Save person" }).click();
  const maraPage = world.getByRole("article", { name: "Mara the ferrywoman" });
  await maraPage.waitFor();
  check(/Port Ashen/.test(await maraPage.locator(".entry-trail").innerText()) && (await maraPage.locator(".entry-block.veil").count()) === 1, "the DM sees Mara as a page: where she is, and her secret in the dashed outline");
  await shot(dm.page, "dm-world-page");
  await eventually(async () => (await alice.page.getByRole("button", { name: "Journal" }).count()) > 0, "Alice's sheet gets a journal");
  await alice.page.getByRole("button", { name: "Journal" }).click();
  const journal = alice.page.getByRole("dialog");
  await journal.getByText("Mara the ferrywoman").click();
  const read = await journal.innerText();
  check(/Port Ashen/.test(read) && /In Port Ashen/.test(read) && /Grey cloak, kind eyes/.test(read), "Alice reads Port Ashen and Mara's public description");
  check(!/drowned god/i.test(read) && !/Drowned Vault/.test(read) && !/lighthouse/.test(read), "but not Mara's secret or the hidden place");
  await journal.locator(".entry-trail").getByRole("button", { name: "Port Ashen" }).click();
  await eventually(async () => journal.locator("img.handout-image").evaluateAll((imgs) => imgs.length === 1 && imgs[0].alt === "Port Ashen" && imgs[0].naturalWidth > 0), "Alice sees Port Ashen's picture, and not Mara's hidden portrait");
  await shot(alice.page, "alice-journal");
  await journal.locator(".prose").getByRole("button", { name: "Mara the ferrywoman" }).click();
  await journal.getByRole("heading", { name: "Mara the ferrywoman" }).waitFor();
  check(true, "a [[link]] in Port Ashen's text takes Alice to Mara's page");
  await maraPage.getByRole("button", { name: "Paragraph only for you. Show it to players." }).click();
  await eventually(async () => /drowned god/.test(await journal.innerText()), "the DM shows Mara's secret from her page, and Alice reads it");
  await maraPage.getByRole("button", { name: "Paragraph shown to players. Hide it." }).last().click();
  await eventually(async () => !/drowned god/.test(await journal.innerText()), "hiding it again takes it out of Alice's journal");
  await alice.page.keyboard.press("Escape");

  // ----- Replacing the link keeps out anyone holding the old one -----
  await dmTo(dm.page, "players");
  await dm.page.getByRole("button", { name: "Replace link" }).click();
  await eventually(async () => (await dm.page.getByRole("textbox", { name: "Invite link" }).inputValue()) !== invite, "the DM replaces the invite link");
  const newInvite = await dm.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  await bringCharacter(bob.page, "bram.mimicbox-character");
  await joinGame(bob.page, invite, "Bob");
  await bob.page.getByRole("heading", { name: "Bram Hollis" }).waitFor();
  await bob.page.waitForTimeout(3000);
  check(/Waiting for the DM of The Sunken Bell/.test(await bob.page.locator(".sheet-top").innerText()), "Bob's old link finds no game");
  check(!/Bram Hollis/.test(await text(dm.page)), "and Bram never reaches the DM");
  await joinGame(bob.page, newInvite, "Bob");
  await eventually(async () => /At The Sunken Bell/.test(await bob.page.locator(".sheet-top").innerText()), "Bob joins with the new link");
  await eventually(async () => /Bram Hollis/.test(await text(dm.page)), "the DM sees Bram");

  // Alice's link was replaced too: she is told why after reconnecting.
  await alice.page.reload();
  await alice.page.getByRole("heading", { name: "Wren Ashdown" }).waitFor();
  await alice.page.waitForTimeout(3000);
  check(!/At The Sunken Bell/.test(await alice.page.locator(".sheet-top").innerText()), "Alice's replaced link no longer connects");
  await joinGame(alice.page, newInvite, "Alice");
  await eventually(async () => /At The Sunken Bell/.test(await alice.page.locator(".sheet-top").innerText()), "Alice rejoins with the new link");

  // ----- A reconnect doesn't repeat anything -----
  await dmTo(dm.page, "play");
  const rollsBefore = await dm.page.getByRole("list", { name: "Rolls" }).locator("li").count();
  await alice.page.reload();
  await alice.page.getByRole("heading", { name: "Wren Ashdown" }).waitFor();
  await eventually(async () => /At The Sunken Bell/.test(await alice.page.locator(".sheet-top").innerText()), "Alice's sheet reconnects by itself after a reload");
  await dm.page.waitForTimeout(1500);
  check((await dm.page.getByRole("list", { name: "Rolls" }).locator("li").count()) === rollsBefore, "reconnecting adds no rolls");
  check((await dm.page.locator(".member").count()) === 2, "and no extra party members");
  await shot(dm.page, "dm-party");
  // Play mode fits the DM's screen too: on a phone the map comes first and the play panel follows below it.
  const dmSize = dm.page.viewportSize();
  await dm.page.setViewportSize({ width: 390, height: 844 });
  // Wait for the phone layout itself: the wide layout has a "Play panel" too, so waiting for that name alone
  // measured before the page had switched (it failed on slower CI machines).
  const dmPanel = dm.page.locator("aside.play-below");
  await dmPanel.waitFor();
  const dmMapBox = await dm.page.locator(".play-map").boundingBox();
  const dmPanelBox = await dmPanel.boundingBox();
  check(dmPanelBox.y >= dmMapBox.y + dmMapBox.height - 1 && dmMapBox.width > 370, "on a phone, Play puts the map first, full width, and the panel below it");
  const toolPicker = dm.page.getByRole("combobox", { name: "Map tool" });
  const surfaceTop = (await dm.page.locator(".play-map .map-surface").boundingBox()).y;
  const pickerCount = await toolPicker.count();
  check(pickerCount === 1 && surfaceTop - dmMapBox.y < 230, `and its map tools are one picker, so the map starts near the top (${Math.round(surfaceTop - dmMapBox.y)} pixels down)`);
  await toolPicker.selectOption("measure");
  check((await dm.page.locator(".play-map").innerText()).includes("Drag from one square to another"), "the picker switches tools");
  await shot(dm.page, "dm-play-phone");
  await dm.page.setViewportSize(dmSize);

  // ----- Backups: the DM moves the campaign to another computer; a player restores their vault -----
  await dmTo(dm.page, "campaign");
  const [campaignFile] = await Promise.all([dm.page.waitForEvent("download"), dm.page.getByRole("button", { name: "Download a backup" }).click()]);
  check(/\.mimicbox-campaign$/.test(campaignFile.suggestedFilename()), `the DM downloads ${campaignFile.suggestedFilename()}`);
  const backupPath = join(SHOTS, "backup.mimicbox-campaign");
  await campaignFile.saveAs(backupPath);
  check(!readFileSync(backupPath, "utf8").includes(newInvite.split("/join/")[1]), "the backup holds no invite secret");
  const laptop = await device("DM laptop", { width: 1280, height: 800 });
  await laptop.page.goto(`${base}studio.html?relay=${encodeURIComponent(relayUrl)}`);
  const campaignChooser = laptop.page.waitForEvent("filechooser");
  await laptop.page.getByRole("button", { name: "Import a campaign" }).click();
  await (await campaignChooser).setFiles(backupPath);
  await laptop.page.getByRole("heading", { name: "The Sunken Bell" }).waitFor();
  await dmTo(laptop.page, "players");
  const moved = await laptop.page.locator("body").innerText();
  check(/Wren Ashdown/.test(moved) && /Bram Hollis/.test(moved) && /Imported\. Send your players the new invite link/.test(moved), "the other computer opens the campaign with its party");
  await dmTo(laptop.page, "handouts");
  const laptopLetter = laptop.page.getByRole("article", { name: "The ferryman's letter" });
  await laptopLetter.getByText("Read").click();
  await eventually(async () => laptopLetter.locator("img.handout-image").evaluateAll((imgs) => imgs.length === 1 && imgs[0].naturalWidth > 0), "with the handout's picture");
  await dmTo(laptop.page, "world");
  const laptopWorld = await laptop.page.getByRole("region", { name: "World" }).innerText();
  check(/Port Ashen/.test(laptopWorld) && /Mara the ferrywoman/.test(laptopWorld) && /The Drowned Vault/.test(laptopWorld), "with its world notes, secrets included");
  await dmTo(laptop.page, "maps");
  await laptop.page.getByRole("button", { name: /^docks/ }).click();
  await eventually(async () => (await laptop.page.getByRole("img", { name: "docks, as you see it" }).locator(".map-surface > img").count()) === 6, "the map and all six of its tiles come along");
  await laptop.context.close();

  const [vaultFile] = await Promise.all([bob.page.waitForEvent("download"), (async () => {
    await bob.page.goto(base);
    await bob.page.getByRole("button", { name: "Back up all characters" }).click();
  })()]);
  const vaultPath = join(SHOTS, "bob.mimicbox-backup");
  await vaultFile.saveAs(vaultPath);
  const phone = await device("Bob's new phone", { width: 390, height: 844 });
  await phone.page.goto(base);
  await phone.page.getByText("Your vault is empty").waitFor();
  const vaultChooser = phone.page.waitForEvent("filechooser");
  await phone.page.getByRole("button", { name: "Import a file" }).click();
  await (await vaultChooser).setFiles(vaultPath);
  await phone.page.getByText("Bram Hollis").first().waitFor();
  check(true, "a player's backup restores their characters on a new phone");
  await phone.context.close();

  // ----- A DM prepares with no connection at all -----
  const cabin = await device("DM, no connection", { width: 1280, height: 800 });
  const studioUrl = `${base}studio.html?relay=${encodeURIComponent(relayUrl)}`;
  await cabin.page.goto(studioUrl);
  await cabin.page.evaluate(() => navigator.serviceWorker.ready);
  await cabin.page.reload();
  check(await cabin.page.evaluate(() => !!navigator.serviceWorker.controller), "the studio installs itself for offline use");
  await cabin.context.setOffline(true);
  await cabin.page.reload();
  await cabin.page.getByLabel("Campaign name").fill("Snowbound");
  await cabin.page.getByRole("button", { name: "Create campaign" }).click();
  await cabin.page.getByRole("heading", { name: "Snowbound" }).waitFor();
  const cabinText = await cabin.page.locator("body").innerText();
  check(/You're offline\. Keep preparing/.test(cabinText), `offline, the studio says so and keeps working${/You're offline/.test(cabinText) ? "" : `: ${cabinText.slice(0, 200)}`}`);
  await dmTo(cabin.page, "world");
  const cabinWorld = cabin.page.getByRole("region", { name: "World" });
  const cabinEntry = cabin.page.getByRole("form", { name: "World entry" });
  await cabinWorld.getByRole("button", { name: "New place" }).click();
  await cabinEntry.getByLabel("Place name").fill("Hollow Keep");
  await cabinEntry.getByLabel("Paragraph 1").fill("A keep buried to its battlements in snow.");
  await cabinEntry.getByRole("button", { name: "Save place" }).click();
  await shot(cabin.page, "dm-offline");
  await cabin.page.waitForTimeout(500);
  await cabin.page.reload();
  await cabin.page.getByRole("heading", { name: "Snowbound" }).waitFor(); // the address keeps the campaign open
  await cabinWorld.getByRole("heading", { name: "Hollow Keep" }).waitFor();
  check(true, "the world prepared offline is still there after a reload");

  await cabin.context.setOffline(false);
  await dmTo(cabin.page, "players");
  await eventually(async () => (await cabin.page.getByRole("textbox", { name: "Invite link" }).count()) > 0, "back online, hosting starts and the invite link appears");
  await dmTo(cabin.page, "world");

  // ----- A player joins on the DM's network: codes swapped, no relay or other server -----
  // Chrome's offline emulation also blocks WebRTC, so it can't stand in for Wi-Fi without internet. Instead Dana's
  // phone is watched: after loading the app it must not contact anything, not even the relay.
  await cabinWorld.getByRole("button", { name: "Edit Hollow Keep" }).click();
  await cabinEntry.getByRole("checkbox", { name: "Players know about this place" }).check();
  await cabinEntry.getByRole("button", { name: "Shown to players" }).click().catch(() => undefined);
  await cabinEntry.getByRole("button", { name: "Save place" }).click();
  const dana = await device("Dana", { width: 390, height: 844 });
  await bringCharacter(dana.page, "wren.mimicbox-character");
  await dana.page.evaluate(() => navigator.serviceWorker.ready);
  await dana.page.reload();
  const contacted = [];
  dana.page.on("websocket", (ws) => contacted.push(ws.url()));
  dana.page.on("request", (r) => !r.url().startsWith(base) && !r.url().startsWith("data:") && contacted.push(r.url()));
  await dmTo(cabin.page, "players");
  await cabin.page.getByRole("button", { name: "Add a player without internet" }).click();
  const dmCode = await cabin.page.getByRole("textbox", { name: "Code for the player" }).inputValue();
  check(/^MB-LAN1\./.test(dmCode), `the DM's screen shows a code for the player (${dmCode.length} characters)`);
  await shot(cabin.page, "dm-lan-code");
  // The code as drawn on screen must be readable: decode a screenshot of it with the same library phones without
  // BarcodeDetector use.
  const qrPng = await cabin.page.getByRole("img", { name: "QR code for the player" }).screenshot();
  const pixels = await cabin.page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, data: Array.from(ctx.getImageData(0, 0, c.width, c.height).data) };
  }, qrPng.toString("base64"));
  const qrRead = jsQR(Uint8ClampedArray.from(pixels.data), pixels.w, pixels.h);
  check(qrRead?.data === dmCode, "the QR code on screen reads back as the exact code");
  await dana.page.goto(`${base}#/join`);
  await dana.page.getByRole("button", { name: "Join on the DM's network" }).click();
  await dana.page.getByLabel("Code from the DM").fill(dmCode);
  await dana.page.getByRole("button", { name: "Read the code" }).click();
  await dana.page.getByRole("heading", { name: "Join Snowbound" }).waitFor();
  await dana.page.getByLabel("Your name at the table").fill("Dana");
  await dana.page.getByRole("button", { name: "Join the game" }).click();
  const danaReply = await dana.page.getByRole("textbox", { name: "Your reply" }).inputValue();
  check(/^MB-LAN1\./.test(danaReply), `Dana's phone makes a reply (${danaReply.length} characters)`);
  await shot(dana.page, "dana-lan-reply");
  await cabin.page.getByLabel("Player's reply").fill(danaReply);
  await cabin.page.getByRole("button", { name: "Connect" }).click();
  await eventually(async () => /#\/c\//.test(dana.page.url()) && /At Snowbound/.test(await dana.page.locator(".chip-table").innerText()), "the DM reads the reply and Dana's sheet connects").catch(async (e) => {
    const lanState = await cabin.page.getByRole("group", { name: "Add a player without internet" }).innerText().catch(() => "(no group)");
    const lanStatus = await cabin.page.locator("[role=status]").allInnerTexts().catch(() => []);
    throw new Error(`${e.message}. Dana at ${dana.page.url()}: ${(await dana.page.locator("main").innerText()).slice(0, 300)} | DM: ${lanState.slice(0, 200)} ${lanStatus.join(" / ")}`);
  });
  await eventually(async () => (await cabin.page.getByRole("article", { name: "Wren Ashdown" }).count()) > 0, "Dana's character joins the DM's party");
  await dana.page.getByRole("button", { name: "Journal" }).click();
  check(/Hollow Keep/.test(await dana.page.getByRole("dialog").innerText()), "and her journal gets the revealed place");
  await dana.page.keyboard.press("Escape");
  await dmTo(cabin.page, "handouts");
  await cabin.page.getByRole("button", { name: "Write a handout" }).click();
  await cabin.page.getByLabel("Title").fill("Map of the keep");
  await cabin.page.getByLabel("Handout picture").setInputFiles(join(FIXTURES, "docks.png"));
  await cabin.page.getByRole("button", { name: "Replace picture" }).waitFor();
  await cabin.page.getByRole("button", { name: "Save handout" }).click();
  await cabin.page.getByRole("article", { name: "Map of the keep" }).getByRole("button", { name: "Show to the party" }).click();
  await eventually(async () => (await dana.page.getByText("New handout: Map of the keep").count()) > 0, "a handout reaches Dana over the local link");
  await dana.page.locator(".chip-table").click();
  await dana.page.getByRole("dialog").getByText("Map of the keep").click();
  await eventually(async () => dana.page.getByRole("dialog").locator("img.handout-image").evaluateAll((imgs) => imgs.length === 1 && imgs[0].naturalWidth > 0), "with its picture, sent in frames");
  await shot(dana.page, "dana-lan-handout");
  await dana.page.keyboard.press("Escape");
  await shot(cabin.page, "dm-lan-party");
  check(contacted.length === 0, `Dana's phone contacted no relay or server${contacted.length ? `: ${contacted.join(", ")}` : ""}`);

  // ----- A hex grid: fog painted around one revealed hex -----
  await dmTo(cabin.page, "maps");
  const hexChooser = cabin.page.waitForEvent("filechooser");
  await cabin.page.getByRole("button", { name: "Add a map" }).click();
  await (await hexChooser).setFiles(join(FIXTURES, "docks.png"));
  await cabin.page.getByRole("button", { name: /^docks/ }).waitFor({ timeout: 20000 });
  await cabin.page.getByText("Grid", { exact: true }).click();
  await cabin.page.getByLabel("Grid shape").selectOption("hex-rows");
  await cabin.page.getByLabel("Hex width (px)").fill("100");
  await cabin.page.getByRole("button", { name: "Apply grid" }).click();
  await cabin.page.getByRole("button", { name: "Reveal hexes" }).click();
  const hexSurface = cabin.page.getByRole("img", { name: "docks, as you see it" }).locator(".map-surface");
  await hexSurface.scrollIntoViewIfNeeded();
  const hb = await hexSurface.boundingBox();
  const hk = hb.width / 1100;
  // Hex (1, 1): odd rows sit half a hex right, so its centre is at (200, 144) on a 100-pixel grid.
  await cabin.page.mouse.click(hb.x + 200 * hk, hb.y + 144 * hk);
  await eventually(async () => /1 of \d+ hexes revealed/.test(await cabin.page.locator("body").innerText()), "the DM switches a map to hexes and reveals one hex");
  await cabin.page.getByRole("button", { name: "Show this map to players" }).click();
  await shot(cabin.page, "dm-hex-map");
  await openTable(dana.page);
  const danaMap = dana.page.getByRole("img", { name: "docks, the parts you can see" });
  await eventually(async () => (await danaMap.locator(".map-surface > img").count()) === 1, "Dana receives the one tile holding that hex");
  const danaPixel = (x, y) =>
    danaMap.locator(".map-surface > img").evaluate(
      async (img, [px, py]) => {
        await img.decode();
        const c = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(px, py, 1, 1).data.slice(0, 3));
      },
      [x, y],
    );
  const dark = ([r, g, b]) => r < 40 && g < 30 && b < 40;
  check(!dark(await danaPixel(200, 144)), "the revealed hex keeps its pixels");
  check(dark(await danaPixel(305, 305)) && dark(await danaPixel(200, 40)) && dark(await danaPixel(110, 144)), "the red secret square, the hex above and the hex beside it are painted over");
  await shot(dana.page, "dana-hex-map");
  await openSheet(dana.page);

  // ----- No grid: straight-line measuring -----
  await cabin.page.getByLabel("Grid shape").selectOption("none");
  await cabin.page.getByLabel("Pixels per 5 feet").fill("100");
  await cabin.page.getByRole("button", { name: "Apply grid" }).click();
  await cabin.page.getByRole("button", { name: "Measure" }).click();
  await hexSurface.scrollIntoViewIfNeeded();
  const nb = await hexSurface.boundingBox();
  const nk = nb.width / 1100;
  await cabin.page.mouse.move(nb.x + 100 * nk, nb.y + 100 * nk);
  await cabin.page.mouse.down();
  await cabin.page.mouse.move(nb.x + 400 * nk, nb.y + 500 * nk, { steps: 6 });
  await cabin.page.mouse.up();
  await eventually(async () => (await cabin.page.locator(".ruler-label").innerText()).trim() === "25 ft", "with no grid, the ruler measures a straight line: 300 by 400 pixels is 25 feet");
  check((await cabin.page.getByRole("img", { name: "docks, as you see it" }).locator(".map-overlay > path, .map-overlay pattern").count()) === 0, "and no grid lines are drawn");
  await dana.context.close();

  await cabin.context.close();

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  console.log(`\nAll table checks passed. Screenshots in ${SHOTS}`);
} catch (e) {
  await Promise.all([shot(dm.page, "failure-dm"), shot(alice.page, "failure-alice"), shot(bob.page, "failure-bob")].map((p) => p.catch(() => {})));
  console.error(`\n${e.message}`);
  if (errors.length) console.error(`Console errors: ${errors.join(" | ")}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await relay.close();
  server.close();
}
