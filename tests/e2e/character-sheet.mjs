#!/usr/bin/env node
/**
 * End-to-end check of the Phase 1 character sheet on a phone-sized screen, against the production build.
 *
 *   pnpm --filter @mimicbox/companion build && node tests/e2e/character-sheet.mjs
 *
 * Uses an installed Chrome (CHROME_PATH, default /usr/bin/google-chrome). Screenshots go to tests/e2e/screenshots/.
 * Exits non-zero on the first failed check.
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const DIST = resolve("apps/companion/dist");
const SHOTS = resolve("tests/e2e/screenshots");
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(join(DIST, "index.html"))) {
  console.error("Build the app first: pnpm --filter @mimicbox/companion build");
  process.exit(1);
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".webmanifest": "application/manifest+json", ".map": "application/json" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(DIST, path === "/" ? "index.html" : path);
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

let step = 0;
const shot = async (name) => page.screenshot({ path: join(SHOTS, `${String(++step).padStart(2, "0")}-${name}.png`), fullPage: false });
const check = (cond, message) => {
  if (!cond) throw new Error(`Check failed: ${message}`);
  console.log(`  ok  ${message}`);
};
const tap = (role, name, opts = {}) => page.getByRole(role, { name, exact: true, ...opts }).first().click();

try {
  await page.goto(base);
  await page.getByText("Your vault is empty").waitFor();
  await shot("vault-empty");
  check(true, "empty vault invites you to build a character");

  await tap("button", "Build a character");
  // 1. Class
  await page.getByRole("button", { name: /^Rogue/ }).click();
  await page.getByText("Sneak Attack").first().waitFor();
  await shot("builder-class");
  await page.getByRole("button", { name: /^Next: Species/ }).click();
  // 2. Species: Wood Elf, Wisdom, Perception -> we pick Survival to avoid clashing with class skills.
  await page.getByRole("button", { name: /^Elf/ }).click();
  await page.getByRole("button", { name: /^Wood Elf/ }).click();
  await page.getByRole("group", { name: "Spellcasting ability" }).getByRole("button", { name: "Wisdom" }).click();
  await page.getByRole("group", { name: "Species skill" }).getByRole("button", { name: "Survival" }).click();
  await shot("builder-species");
  await page.getByRole("button", { name: /^Next: Background/ }).click();
  // 3. Background: Criminal, +2 Dex +1 Con
  await page.getByRole("button", { name: /^Criminal/ }).click();
  await page.getByRole("group", { name: "Plus two" }).getByRole("button", { name: "Dexterity" }).click();
  await page.getByRole("group", { name: "Plus one" }).getByRole("button", { name: "Constitution" }).click();
  await shot("builder-background");
  await page.getByRole("button", { name: /^Next: Abilities/ }).click();
  // 4. Abilities: point buy 8/15/14/10/13/12
  await tap("button", "Point buy");
  const raise = async (ability, times) => {
    for (let i = 0; i < times; i++) await page.getByRole("button", { name: `Raise ${ability}` }).click();
  };
  await raise("Dexterity", 7);
  await raise("Constitution", 6);
  await raise("Intelligence", 2);
  await raise("Wisdom", 5);
  await raise("Charisma", 4);
  await page.getByText("0 of 27 points left").waitFor();
  check(true, "point buy spends exactly 27 points");
  await shot("builder-abilities");
  await page.getByRole("button", { name: /^Next: Class options/ }).click();
  // 5. Class options
  const classSkills = page.getByRole("group", { name: "Class skills" });
  for (const s of ["Acrobatics", "Insight", "Investigation", "Perception"]) await classSkills.getByRole("button", { name: s }).click();
  const expertise = page.getByRole("group", { name: "Expertise" });
  for (const s of ["Stealth", "Sleight of Hand"]) await expertise.getByRole("button", { name: s }).click();
  const mastery = page.getByRole("group", { name: "Weapon Mastery" });
  await mastery.getByRole("button", { name: /^Shortsword/ }).click();
  await mastery.getByRole("button", { name: /^Shortbow/ }).click();
  await shot("builder-class-options");
  await page.getByRole("button", { name: /^Next: Equipment/ }).click();
  // 6. Equipment
  await page.getByRole("button", { name: /^Option A.*Leather Armor/ }).click();
  await page.getByRole("button", { name: /^Option A.*Crowbar/ }).click();
  await shot("builder-equipment");
  await page.getByRole("button", { name: /^Next: Name and finish/ }).click();
  // 7. Details
  await page.getByLabel("Character name").fill("Wren Ashdown");
  await page.getByText("Every choice is made.").waitFor();
  check(true, "builder reports no open choices");
  await shot("builder-finish");
  await tap("button", "Save to vault");

  // Sheet
  await page.getByRole("heading", { name: "Wren Ashdown" }).waitFor();
  await shot("sheet-actions");
  const vitals = await page.locator(".vitals").innerText();
  check(/10\s*\/\s*10/.test(vitals), "HP is 10 of 10 (d8 8 + Con 2)");
  check(/AC\s*14/.test(vitals), "AC is 14 (Leather 11 + Dex 3)");
  check(/\+5/.test(vitals), "Initiative is +5 (Dex 3 + Alert 2)");
  check(/35/.test(vitals), "Speed is 35 (Wood Elf)");
  const actions = await page.locator("main").innerText();
  check(/Shortsword/.test(actions) && /1d6\+3/.test(actions), "Shortsword attack shows 1d6+3 damage");
  check(/Sneak Attack: \+1d6/.test(actions), "Sneak Attack note shows 1d6");

  // Roll an attack, then damage.
  await page.locator(".attack", { hasText: "Shortsword" }).getByRole("button", { name: /Hit/ }).click();
  await page.locator(".roll-result .total").waitFor();
  await page.waitForTimeout(300);
  await shot("roll-attack");
  const total = Number(await page.locator(".roll-result .total").innerText());
  check(total >= 6 && total <= 25, `attack roll total ${total} is within 1d20+5`);
  await page.getByRole("button", { name: /damage$/i }).first().click();
  await page.waitForTimeout(150);
  const dmg = Number(await page.locator(".roll-result .total").innerText());
  check(dmg >= 4 && dmg <= 24, `damage total ${dmg} is within 1d6+3 (or doubled dice on a crit)`);
  await page.keyboard.press("Escape");

  // Skills tab
  await tap("button", "Skills");
  await shot("sheet-skills");
  const stealth = await page.locator(".roll-row", { hasText: /^Stealth/ }).locator(".num").innerText();
  check(stealth === "+7", "Stealth is +7 with Expertise");
  const passive = await page.locator(".spread", { hasText: "Passive Perception" }).innerText();
  check(/13/.test(passive), "Passive Perception is 13");

  // Take damage, then reload and check it was saved on the device.
  await page.locator(".hp-vital").click();
  await page.getByLabel("Amount").fill("4");
  await tap("button", "Take damage");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700); // autosave delay
  await page.reload();
  await page.getByRole("heading", { name: "Wren Ashdown" }).waitFor();
  check(/6\s*\/\s*10/.test(await page.locator(".vitals").innerText()), "damage survives a reload (6 of 10 HP)");

  // Spells tab shows Druidcraft from Wood Elf.
  await tap("button", "Spells");
  await page.getByText("Druidcraft").waitFor();
  await shot("sheet-spells");
  check(true, "Wood Elf Druidcraft appears under always prepared");

  // Gear and Notes
  await tap("button", "Gear");
  await shot("sheet-gear");
  check(/Thieves' Tools/.test(await page.locator("main").innerText()), "starting equipment is in the inventory");
  await tap("button", "Notes");
  await shot("sheet-notes");

  // Level up to 2: Cunning Action, HP 10 -> 17 (avg 5 + Con 2).
  await tap("button", "Level up");
  await page.getByRole("button", { name: "Reach level 2" }).click();
  await page.waitForTimeout(200);
  check(/13\s*\/\s*17/.test(await page.locator(".vitals").innerText()), "level 2 raises max HP to 17 and current HP by 7");

  // Level up to 3: the subclass choice appears under To do and clears once made.
  await tap("button", "Level up");
  await page.getByRole("button", { name: "Reach level 3" }).click();
  await page.getByRole("heading", { name: "To do" }).waitFor();
  check(/Choose your Rogue subclass/.test(await page.locator("main").innerText()), "level 3 asks for a subclass");
  await shot("sheet-todo-subclass");
  await page.getByRole("button", { name: "Choose", exact: true }).first().click();
  await page.waitForTimeout(200);
  check((await page.getByRole("heading", { name: "To do" }).count()) === 0, "choosing Thief clears the To do list");
  check(/Rogue 3 \(Thief\)/.test(await page.locator(".sheet-top").innerText()), "header shows Rogue 3 (Thief)");

  // Dice pad
  await page.getByRole("button", { name: "Roll dice" }).click();
  await page.getByLabel("Any roll, such as 2d6+3 or 4d6dl1").fill("4d6dl1");
  await page.getByRole("button", { name: "Roll", exact: true }).click();
  await page.waitForTimeout(300);
  const statRoll = Number(await page.locator(".roll-result .total").innerText());
  check(statRoll >= 3 && statRoll <= 18, `custom roll 4d6dl1 gave ${statRoll}`);
  await shot("roll-custom");
  await page.keyboard.press("Escape");

  // Back to the vault: the character is listed.
  await page.getByRole("button", { name: "Back to the vault" }).click();
  await page.getByText("Rogue 3 (Thief), Elf (Wood Elf)").waitFor();
  await shot("vault-with-character");
  check(true, "vault lists the character with class and species");

  // ----- A spellcaster: Human Wizard (Sage), standard array -----
  await tap("button", "Build a character");
  await page.getByRole("button", { name: /^Wizard/ }).click();
  await page.getByRole("button", { name: /^Next: Species/ }).click();
  await page.getByRole("button", { name: /^Human/ }).click();
  await page.getByRole("group", { name: "Species skill" }).getByRole("button", { name: "Perception" }).click();
  await page.getByRole("group", { name: "Origin feat" }).getByRole("button", { name: "Skilled" }).click();
  const skilled = page.getByRole("group", { name: "Skilled feat skills" });
  for (const sk of ["Athletics", "Stealth", "Insight"]) await skilled.getByRole("button", { name: sk }).click();
  await page.getByRole("button", { name: /^Next: Background/ }).click();
  await page.getByRole("button", { name: /^Sage/ }).click();
  await page.getByRole("group", { name: "Plus two" }).getByRole("button", { name: "Intelligence" }).click();
  await page.getByRole("group", { name: "Plus one" }).getByRole("button", { name: "Constitution" }).click();
  await page.getByRole("button", { name: /^Next: Abilities/ }).click();
  // Standard array: put 15 in Intelligence by swapping with Strength.
  await page.getByLabel("Intelligence", { exact: true }).selectOption("15");
  await page.getByRole("button", { name: /^Next: Class options/ }).click();
  const wizSkills = page.getByRole("group", { name: "Class skills" });
  check(await wizSkills.getByRole("button", { name: "Arcana" }).isDisabled(), "Arcana is unavailable because the Sage already grants it");
  await wizSkills.getByRole("button", { name: "Investigation" }).click();
  await wizSkills.getByRole("button", { name: "Medicine" }).click();
  await page.getByRole("button", { name: /^Next: Equipment/ }).click();
  await page.getByRole("button", { name: /^Option A.*Spellbook/ }).click();
  await page.getByRole("button", { name: /^Option A.*Calligrapher/ }).click();
  await page.getByRole("button", { name: /^Next: Spells/ }).click();
  const pick = async (section, n) => {
    // The innermost section holding that heading (the Magic Initiate panel is itself a section).
    const block = page.locator("section", { has: page.getByRole("heading", { name: section, exact: true }) }).last();
    for (let i = 0; i < n; i++) await block.getByRole("button", { name: "Choose", exact: true }).first().click();
  };
  await page.getByRole("heading", { name: "Wizard cantrips" }).waitFor();
  await pick("Wizard cantrips", 3);
  await pick("Prepared Wizard spells", 4);
  await page.getByRole("button", { name: "Intelligence", exact: true }).click();
  const known = page.locator("section", { has: page.getByRole("heading", { name: "Two cantrips", exact: true }) }).last().getByRole("button", { name: "Known" });
  check((await known.count()) === 3, "Magic Initiate marks the 3 Wizard cantrips already chosen as Known");
  await pick("Two cantrips", 2);
  await pick("One level 1 spell", 1);
  await shot("builder-spells");
  await page.getByRole("button", { name: /^Next: Name and finish/ }).click();
  await page.getByLabel("Character name").fill("Oryn Vale");
  await page.getByText("Every choice is made.").waitFor();
  check(true, "wizard builder reports no open choices after spells and feats");
  await tap("button", "Save to vault");
  await page.getByRole("heading", { name: "Oryn Vale" }).waitFor();
  await tap("button", "Spells");
  await page.getByText("Save DC").waitFor();
  const dc = await page.locator(".ability", { hasText: "Save DC" }).locator(".mod").innerText();
  check(dc === "13", `Wizard spell save DC is 13 (8 + Int 17 → +3 + PB 2), got ${dc}`);
  check((await page.locator(".pip").count()) === 2, "two level 1 spell slots");
  await page.locator(".pip").first().click();
  check((await page.locator('.pip[aria-pressed="true"]').count()) === 1, "spending a slot marks it used");
  await shot("sheet-spells-wizard");

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  console.log(`\nAll checks passed. Screenshots in ${SHOTS}`);
} catch (e) {
  await shot("failure").catch(() => {});
  console.error(`\n${e.message}`);
  if (errors.length) console.error(`Console errors: ${errors.join(" | ")}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
