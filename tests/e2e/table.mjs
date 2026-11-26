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
  const writeHandout = async (title, body) => {
    await dm.page.getByRole("button", { name: "Write a handout" }).click();
    await dm.page.getByLabel("Title").fill(title);
    await dm.page.getByLabel("Text").fill(body);
    await dm.page.getByRole("button", { name: "Save handout" }).click();
  };
  await writeHandout("The ferryman's letter", "Meet me at the **Sunken Bell** at midnight.");
  await writeHandout("Villain's plan", "Flood the lower city.");
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
  await shot(alice.page, "alice-handout");
  await alice.page.keyboard.press("Escape");
  await eventually(async () => /Meet me at the Sunken Bell/.test(await display.locator("main").innerText()), "the display shows the handout");
  check(!/Flood the lower city/.test(await display.locator("main").innerText()), "but never the hidden one");
  await shot(display, "display-handout");
  await dm.page.getByRole("article", { name: "The ferryman's letter" }).getByRole("button", { name: "Hide again" }).click();
  await eventually(async () => !/ferryman/.test(await display.locator("main").innerText()), "hiding it again takes it off the display");

  // ----- Combat: initiative from the sheet, hidden creatures, turns -----
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

  await eventually(async () => (await alice.page.getByRole("button", { name: "Map", exact: true }).count()) > 0, "Alice's sheet offers the map");
  await alice.page.getByRole("button", { name: "Map", exact: true }).click();
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
  await alice.page.keyboard.press("Escape");
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
  await dm.page.getByRole("button", { name: "Draw walls" }).click();
  await drag([450, 50], [450, 550]);
  await dm.page.getByRole("button", { name: "Doors" }).click();
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
  await dm.page.mouse.click(...(await at(250, 150)));
  const dmDoors = dm.page.getByRole("img", { name: "docks, as you see it" }).locator(".map-overlay .door.open");
  const openBefore = await dmDoors.count();
  await alice.page.getByRole("button", { name: "Map", exact: true }).click();
  await eventually(async () => (await aliceMap.locator(".map-overlay .door").count()) >= 1, "Alice sees the door next to her");
  const ab = await aliceMap.locator(".map-surface").boundingBox();
  const ak2 = ab.width / 1100;
  await alice.page.mouse.click(ab.x + 250 * ak2, ab.y + 150 * ak2);
  await eventually(async () => (await dmDoors.count()) === openBefore + 1, "Alice opens it from her sheet and the DM's map shows it open");

  // Turns light up the acting token.
  await alice.page.keyboard.press("Escape");
  await dm.page.getByRole("button", { name: "Reveal all" }).click();
  await dm.page.getByRole("button", { name: "Start combat" }).click();
  await dm.page.getByLabel("Creature", { exact: true }).fill("Ogre");
  await dm.page.getByLabel("Init bonus").fill("40");
  await dm.page.getByRole("button", { name: "Add and roll" }).click();
  await dm.page.getByRole("button", { name: "First turn" }).click();
  await eventually(async () => (await display.getByRole("button", { name: "Ogre, acting now" }).count()) === 1, "the display lights up the Ogre's token on its turn");
  await dm.page.getByRole("button", { name: "Next turn" }).click();
  await alice.page.getByRole("button", { name: "Map", exact: true }).click();
  await eventually(async () => (await aliceMap.getByRole("button", { name: "Wren Ashdown, acting now" }).count()) === 1, "and Wren's on hers");
  await shot(alice.page, "alice-map-turn");
  await shot(display, "display-map-turn");
  await alice.page.keyboard.press("Escape");
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

  // ----- Replacing the link keeps out anyone holding the old one -----
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
  const rollsBefore = await dm.page.getByRole("list", { name: "Rolls" }).locator("li").count();
  await alice.page.reload();
  await alice.page.getByRole("heading", { name: "Wren Ashdown" }).waitFor();
  await eventually(async () => /At The Sunken Bell/.test(await alice.page.locator(".sheet-top").innerText()), "Alice's sheet reconnects by itself after a reload");
  await dm.page.waitForTimeout(1500);
  check((await dm.page.getByRole("list", { name: "Rolls" }).locator("li").count()) === rollsBefore, "reconnecting adds no rolls");
  check((await dm.page.locator(".member").count()) === 2, "and no extra party members");
  await shot(dm.page, "dm-party");

  // ----- Backups: the DM moves the campaign to another computer; a player restores their vault -----
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
  const moved = await text(laptop.page);
  check(/Wren Ashdown/.test(moved) && /Bram Hollis/.test(moved) && /Imported\. Send your players the invite link/.test(moved), "the other computer opens the campaign with its party");
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
