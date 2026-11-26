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
  await dm.page.getByLabel("For").fill("Ambush");
  await dm.page.getByRole("button", { name: "Roll in secret" }).click();
  await dm.page.getByLabel("For").fill("Ogre club");
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
