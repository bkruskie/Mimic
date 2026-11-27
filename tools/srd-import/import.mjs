#!/usr/bin/env node
/**
 * Builds the SRD 5.2.1 content pack for the dnd5e-2024 ruleset from a Markdown copy of the SRD.
 *
 * Usage: node tools/srd-import/import.mjs <path to srd-5.2/en> [output dir]
 *
 * The source is a Markdown conversion of the System Reference Document 5.2.1 (CC-BY-4.0).
 * The script only reads local files; it never fetches anything.
 * Output: JSON files in packages/ruleset-dnd5e/content/srd-5.2.1/, committed to the repo.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [, , sourceArg, outArg] = process.argv;
if (!sourceArg) {
  console.error("Usage: node tools/srd-import/import.mjs <path to srd-5.2/en> [output dir]");
  process.exit(1);
}
const SRC = resolve(sourceArg);
const OUT = resolve(outArg ?? "packages/ruleset-dnd5e/content/srd-5.2.1");
const read = (rel) => readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

const ABILITIES = { Strength: "str", Dexterity: "dex", Constitution: "con", Intelligence: "int", Wisdom: "wis", Charisma: "cha" };
const SKILLS = {
  Acrobatics: "acrobatics", "Animal Handling": "animalHandling", Arcana: "arcana", Athletics: "athletics",
  Deception: "deception", History: "history", Insight: "insight", Intimidation: "intimidation",
  Investigation: "investigation", Medicine: "medicine", Nature: "nature", Perception: "perception",
  Performance: "performance", Persuasion: "persuasion", Religion: "religion", "Sleight of Hand": "sleightOfHand",
  Stealth: "stealth", Survival: "survival",
};

// ---------- generic Markdown helpers ----------

const slug = (s) =>
  s.toLowerCase().replace(/[’']/g, "").replace(/\*/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const clean = (s) => s.replace(/\*\*/g, "").replace(/^\*|\*$/g, "").trim();

/** Splits text into heading sections. Each section runs until the next heading of the same or higher rank. */
function sections(text) {
  const lines = text.split("\n");
  const heads = [];
  lines.forEach((line, i) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) heads.push({ depth: m[1].length, title: clean(m[2]), line: i });
  });
  return heads.map((h, idx) => {
    let end = lines.length;
    for (let j = idx + 1; j < heads.length; j++) {
      if (heads[j].depth <= h.depth) {
        end = heads[j].line;
        break;
      }
    }
    const nextHead = heads[idx + 1]?.line ?? lines.length;
    return {
      ...h,
      body: lines.slice(h.line + 1, end).join("\n").trim(),
      ownBody: lines.slice(h.line + 1, nextHead).join("\n").trim(),
    };
  });
}

/** Parses the Markdown table that starts at or after `from` (a line index or a "Table: ..." caption). */
function tableAfter(text, caption) {
  const lines = text.split("\n");
  let i = 0;
  if (caption) {
    i = lines.findIndex((l) => l.startsWith("Table:") && l.includes(caption));
    if (i < 0) return null;
  }
  while (i < lines.length && !lines[i].trim().startsWith("|")) i++;
  const rows = [];
  for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => clean(c));
    if (cells.every((c) => /^-+$/.test(c) || c === "")) {
      if (cells.every((c) => /^-+$/.test(c))) continue;
    }
    rows.push(cells);
  }
  if (rows.length === 0) return null;
  const [header, ...body] = rows;
  return { header, rows: body };
}

function parseList(text) {
  // "A, B, or C" / "A and B" -> [A, B, C]
  return text
    .replace(/\s+or\s+/g, ", ")
    .replace(/\s+and\s+/g, ", ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseItemList(text) {
  const parts = text
    .replace(/,\s*and\s+/g, ", ")
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const items = [];
  let gp = 0;
  for (const part of parts) {
    const money = /^(\d+)\s*GP$/i.exec(part);
    if (money) {
      gp += Number(money[1]);
      continue;
    }
    const qty = /^(\d+)\s+(.+)$/.exec(part);
    items.push(qty ? { name: qty[2], quantity: Number(qty[1]) } : { name: part, quantity: 1 });
  }
  return { items, gp };
}

/** "Choose A or B: (A) ...; or (B) 75 GP" -> options. */
function parseEquipmentChoice(text) {
  const body = text.replace(/^\*?Choose [^:]+:\*?\s*/i, "").trim();
  return body
    .split(/;\s*(?:or\s+)?(?=\([A-Z]\))/)
    .map((chunk) => {
      const m = /^\(([A-Z])\)\s*(.*)$/s.exec(chunk.trim());
      if (!m) throw new Error(`Unrecognised equipment option: ${chunk}`);
      return { label: m[1], ...parseItemList(m[2].trim()) };
    });
}

// ---------- equipment ----------

function importEquipment() {
  const md = read("06_Equipment.md");
  const weapons = [];
  for (const [caption, category, kind] of [
    ["Simple Melee Weapons", "simple", "melee"],
    ["Simple Ranged Weapons", "simple", "ranged"],
    ["Martial Melee Weapons", "martial", "melee"],
    ["Martial Ranged Weapons", "martial", "ranged"],
  ]) {
    const t = tableAfter(md, caption);
    for (const [name, damage, props, mastery, weight, cost] of t.rows) {
      const dm = /^(\d+(?:d\d+)?)\s+(\w+)$/.exec(damage);
      const properties = props === "—" ? [] : props.split(/,\s*(?![^()]*\))/).map((p) => p.trim());
      const range = /Range (\d+)\/(\d+)/.exec(props);
      const versatile = /Versatile \((\d+d\d+)\)/.exec(props);
      weapons.push({
        id: slug(name),
        name,
        category,
        kind,
        damage: dm ? dm[1] : damage,
        damageType: dm ? dm[2].toLowerCase() : null,
        properties: properties.map((p) => p.replace(/\s*\(.*\)$/, "").toLowerCase().replace(/\s+/g, "-")),
        propertiesText: props === "—" ? "" : props,
        range: range ? { normal: Number(range[1]), long: Number(range[2]) } : null,
        versatileDamage: versatile ? versatile[1] : null,
        mastery,
        weight,
        cost,
      });
    }
  }

  const armor = [];
  for (const [caption, category] of [
    ["Light Armor", "light"],
    ["Medium Armor", "medium"],
    ["Heavy Armor", "heavy"],
    ["Shield (", "shield"],
  ]) {
    const t = tableAfter(md, caption);
    for (const [name, ac, strength, stealth, weight, cost] of t.rows) {
      const base = /^\+?(\d+)/.exec(ac);
      const cap = /max (\d+)/.exec(ac);
      armor.push({
        id: slug(name),
        name,
        category,
        baseAc: Number(base?.[1] ?? 0),
        addDex: /Dex/.test(ac),
        maxDex: cap ? Number(cap[1]) : null,
        strength: /Str (\d+)/.test(strength) ? Number(/Str (\d+)/.exec(strength)[1]) : null,
        stealthDisadvantage: /Disadvantage/.test(stealth),
        weight,
        cost,
      });
    }
  }

  const gear = [];
  const secs = sections(md);
  const startGear = secs.findIndex((s) => s.depth === 2 && s.title === "Adventuring Gear");
  const startTools = secs.findIndex((s) => s.depth === 2 && s.title === "Tools");
  for (const [start, kind] of [
    [startTools, "tool"],
    [startGear, "gear"],
  ]) {
    for (let i = start + 1; i < secs.length && secs[i].depth > 2; i++) {
      const s = secs[i];
      if (s.depth !== 4) continue;
      const m = /^(.+?)\s*\(([^)]+)\)$/.exec(s.title);
      if (!m) continue;
      gear.push({ id: slug(m[1]), name: m[1], kind, cost: m[2], text: s.body });
    }
  }
  const mastery = secs
    .filter((s) => s.depth === 4)
    .filter((s) => ["Cleave", "Graze", "Nick", "Push", "Sap", "Slow", "Topple", "Vex"].includes(s.title))
    .map((s) => ({ id: slug(s.title), name: s.title, text: s.body }));
  const properties = secs
    .filter((s) => s.depth === 4)
    .filter((s) =>
      ["Ammunition", "Finesse", "Heavy", "Light", "Loading", "Range", "Reach", "Thrown", "Two-Handed", "Versatile"].includes(s.title),
    )
    .map((s) => ({ id: slug(s.title), name: s.title, text: s.body }));
  return { weapons, armor, gear, mastery, properties };
}

// ---------- origins ----------

function importOrigins() {
  const md = read("04_CharacterOrigins.md");
  const secs = sections(md);
  const field = (body, label) => {
    const m = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`).exec(body);
    return m ? m[1].trim() : null;
  };

  const backgrounds = [];
  const bgStart = secs.findIndex((s) => s.title === "Background Descriptions");
  for (let i = bgStart + 1; i < secs.length && secs[i].depth === 4; i++) {
    const s = secs[i];
    const feat = field(s.body, "Feat").replace(/\s*\(see "Feats"\)/, "");
    const featMatch = /^(.+?)(?:\s+\((\w+)\))?$/.exec(feat);
    backgrounds.push({
      id: slug(s.title),
      name: s.title,
      abilityOptions: parseList(field(s.body, "Ability Scores")).map((a) => ABILITIES[a]),
      feat: { id: slug(featMatch[1]), name: featMatch[1], option: featMatch[2] ?? null },
      skills: parseList(field(s.body, "Skill Proficiencies")).map((x) => SKILLS[x]),
      tool: field(s.body, "Tool Proficiency"),
      equipment: parseEquipmentChoice(field(s.body, "Equipment")),
      equipmentText: field(s.body, "Equipment").replace(/\*/g, ""),
    });
  }

  const species = [];
  const spStart = secs.findIndex((s) => s.title === "Species Descriptions");
  for (let i = spStart + 1; i < secs.length && secs[i].depth === 4; i++) {
    const s = secs[i];
    const size = field(s.body, "Size");
    const speed = Number(/(\d+) feet/.exec(field(s.body, "Speed"))[1]);
    const traits = [];
    const lines = s.body.split("\n");
    let current = null;
    for (const line of lines) {
      const caption = /^Table:\s*(.+)$/.exec(line);
      if (caption) {
        // Attach a table to the trait that refers to it by name, not just to the trait above it.
        const owner = traits.find((t) => t.text.includes(caption[1].trim()));
        if (owner) current = owner;
      }
      const m = /^\*\*([^*]+?)\.\*\*\s*(.*)$/.exec(line);
      if (m && !["Creature Type:", "Size:", "Speed:"].some((x) => line.includes(x))) {
        current = { name: m[1].trim(), text: m[2] };
        traits.push(current);
      } else if (current && line.trim() !== "" && !/^\*\*(Creature Type|Size|Speed):/.test(line)) {
        current.text += `\n\n${line}`;
      }
    }
    for (const t of traits) t.text = t.text.replace(/\n{3,}/g, "\n\n").trim();
    const dv = /Darkvision with a range of (\d+) feet/.exec(s.body);
    species.push({
      id: slug(s.title),
      name: s.title,
      creatureType: field(s.body, "Creature Type"),
      sizeText: size,
      sizes: /Small/.test(size) && /Medium/.test(size) ? ["medium", "small"] : /Small/.test(size) ? ["small"] : ["medium"],
      speed,
      darkvision: dv ? Number(dv[1]) : null,
      traits,
    });
  }
  // Nested tables inside traits (Draconic Ancestors, Elven Lineages) stay as Markdown in the trait text.
  return { backgrounds, species };
}

// ---------- feats ----------

function importFeats() {
  const md = read("05_Feats.md");
  const secs = sections(md);
  const feats = [];
  let category = null;
  for (const s of secs) {
    if (s.depth === 3 && /Feats$/.test(s.title)) category = slug(s.title.replace(/ Feats$/, ""));
    if (s.depth !== 4 || !category) continue;
    const lines = s.body.split("\n");
    const tag = lines.find((l) => /^\*[^*].*\*$/.test(l.trim())) ?? "";
    const prereq = /Prerequisite:\s*([^)]+)\)/.exec(tag);
    feats.push({
      id: slug(s.title),
      name: s.title,
      category,
      prerequisite: prereq ? prereq[1].trim() : null,
      repeatable: /\*\*Repeatable\.\*\*/.test(s.body),
      text: lines.filter((l) => l !== tag).join("\n").trim(),
    });
  }
  return feats;
}

// ---------- spells ----------

function importSpells() {
  const md = read("07_Spells.md");
  const start = md.indexOf("## Cantrips (Level 0)");
  const secs = sections(md.slice(start));
  const spells = [];
  for (const s of secs) {
    if (s.depth !== 3) continue;
    const lines = s.body.split("\n");
    const tagLine = lines.find((l) => /^\*[^*]/.test(l.trim()));
    if (!tagLine) continue;
    const tag = tagLine.replace(/\*/g, "").trim();
    let level, school;
    const cantrip = /^(\w+) Cantrip/.exec(tag);
    const levelled = /^Level (\d) (\w+)/.exec(tag);
    if (cantrip) {
      level = 0;
      school = cantrip[1];
    } else if (levelled) {
      level = Number(levelled[1]);
      school = levelled[2];
    } else continue;
    const classes = (/\(([^)]+)\)/.exec(tag)?.[1] ?? "").split(",").map((c) => slug(c.trim())).filter(Boolean);
    const get = (label) => new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`).exec(s.body)?.[1].trim() ?? null;
    const castingTime = get("Casting Time");
    const duration = get("Duration");
    const components = get("Components");
    const descStart = lines.findIndex((l) => l.startsWith("**Duration:**"));
    const description = lines.slice(descStart + 1).join("\n").trim();
    const higher = /\*\*_?(Using a Higher-Level Spell Slot|Cantrip Upgrade)\._?\*\*/.test(description);
    spells.push({
      id: slug(s.title),
      name: s.title,
      level,
      school: school.toLowerCase(),
      classes,
      castingTime,
      ritual: /Ritual/.test(castingTime ?? ""),
      range: get("Range"),
      components,
      material: /M \(([^)]+)\)/.exec(components ?? "")?.[1] ?? null,
      duration,
      concentration: /Concentration/.test(duration ?? ""),
      scales: higher,
      description,
    });
  }
  return spells;
}

// ---------- classes ----------

function parseCoreTraits(text, className) {
  const t = tableAfter(text, `Core ${className} Traits`);
  const map = Object.fromEntries(t.rows.map(([k, v]) => [k, v]));
  const skillsRaw = map["Skill Proficiencies"];
  let skills;
  const any = /Choose any (\d+)/.exec(skillsRaw);
  const some = /Choose (\d+):\s*(.+)$/.exec(skillsRaw);
  if (any) skills = { choose: Number(any[1]), from: Object.values(SKILLS) };
  else skills = { choose: Number(some[1]), from: parseList(some[2]).map((x) => SKILLS[x]) };
  const armorText = map["Armor Training"];
  return {
    primaryAbility: map["Primary Ability"],
    hitDie: Number(/D(\d+)/.exec(map["Hit Point Die"])[1]),
    savingThrows: parseList(map["Saving Throw Proficiencies"]).map((a) => ABILITIES[a]),
    skills,
    weaponText: map["Weapon Proficiencies"],
    weapons: {
      simple: /Simple/.test(map["Weapon Proficiencies"]),
      martial: /^Simple and Martial weapons$|Simple and Martial weapons$/.test(map["Weapon Proficiencies"]),
      martialWithProperty: /Martial weapons that have the ([\w ]+?) property/.exec(map["Weapon Proficiencies"])?.[1]
        .split(/ or /)
        .map((p) => p.toLowerCase()) ?? null,
    },
    toolText: map["Tool Proficiencies"] ?? null,
    armorText,
    armor: {
      light: /Light/.test(armorText),
      medium: /Medium/.test(armorText),
      heavy: /Heavy/.test(armorText),
      shield: /Shields/.test(armorText),
    },
    startingEquipment: parseEquipmentChoice(map["Starting Equipment"]),
    startingEquipmentText: map["Starting Equipment"],
  };
}

function importClass(file) {
  const md = read(join("03_Classes", file));
  const name = /^## (.+)$/m.exec(md)[1].trim();
  const id = slug(name);
  const core = parseCoreTraits(md, name);

  const lines = md.split("\n");
  const captionIdx = lines.findIndex((l) => /^Table: .*Features/.test(l) && !/Core/.test(l));
  const table = tableAfter(lines.slice(captionIdx).join("\n"));
  const header = table.header.map((h) => h.replace(/\s+/g, " ").trim());
  const progression = table.rows.map((row) => {
    const entry = { level: Number(row[0]), proficiencyBonus: Number(row[1].replace("+", "")) };
    entry.features = row[2] === "—" ? [] : row[2].split(/,\s*/);
    const columns = {};
    const slots = [];
    header.slice(3).forEach((h, i) => {
      const v = row[i + 3];
      if (/^[1-9]$/.test(h)) slots[Number(h) - 1] = v === "—" ? 0 : Number(v);
      else columns[h] = v;
    });
    if (slots.length) entry.spellSlots = slots;
    entry.columns = columns;
    return entry;
  });

  const secs = sections(md);
  const features = [];
  const subclasses = [];
  const options = [];
  const spellList = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [], 9: [] };
  let mode = "class";
  let currentSub = null;
  let optionGroup = null;
  for (const s of secs) {
    const sub = /Subclass:\s*(.+)$/.exec(s.title);
    if (sub) {
      mode = "subclass";
      currentSub = { id: slug(sub[1]), name: sub[1].trim(), description: s.ownBody, features: [] };
      subclasses.push(currentSub);
      continue;
    }
    if (/Spell List$/.test(s.title)) {
      mode = "spells";
      for (const tline of s.body.split("\n").filter((l) => l.startsWith("Table:"))) {
        const lvl = /Cantrips/.test(tline) ? 0 : Number(/Level (\d)/.exec(tline)?.[1]);
        const t = tableAfter(s.body, tline.slice("Table: ".length));
        if (t) spellList[lvl].push(...t.rows.map((r) => slug(r[0])));
      }
      continue;
    }
    if (/Options$/.test(s.title) && s.depth === 3) {
      mode = "options";
      optionGroup = { id: slug(s.title), name: s.title, intro: s.ownBody, items: [] };
      options.push(optionGroup);
      continue;
    }
    if (mode === "options" && s.depth === 4) {
      optionGroup.items.push({ id: slug(s.title), name: s.title, text: s.body });
      continue;
    }
    const lvl = /^Level (\d+):\s*(.+)$/.exec(s.title);
    if (!lvl) continue;
    const feature = { id: slug(lvl[2]), name: lvl[2].trim(), level: Number(lvl[1]), text: s.body };
    if (mode === "subclass" && currentSub) currentSub.features.push(feature);
    else if (mode === "class") features.push(feature);
  }

  return { id, name, ...core, progression, features, subclasses, options, spellList };
}

// ---------- run ----------

mkdirSync(OUT, { recursive: true });
const equipment = importEquipment();
const origins = importOrigins();
const feats = importFeats();
const spells = importSpells();
const classFiles = [
  "01_Barbarian.md", "02_Bard.md", "03_Cleric.md", "04_Druid.md", "05_Fighter.md", "06_Monk.md",
  "07_Paladin.md", "08_Ranger.md", "09_Rogue.md", "10_Sorcerer.md", "11_Warlock.md", "12_Wizard.md",
];
const classes = classFiles.map(importClass);

// Class spell lists come from each spell's own class tag, which is the authoritative source in the SRD.
// The per-class tables are only used to report disagreements.
for (const c of classes) {
  const fromSpells = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [], 9: [] };
  for (const s of spells) if (s.classes.includes(c.id)) fromSpells[s.level].push(s.id);
  const tableIds = new Set(Object.values(c.spellList).flat());
  const tagIds = new Set(Object.values(fromSpells).flat());
  const onlyTable = [...tableIds].filter((x) => !tagIds.has(x));
  const onlyTag = [...tagIds].filter((x) => !tableIds.has(x));
  if (tableIds.size && (onlyTable.length || onlyTag.length)) {
    console.warn(`${c.name}: spell list table and spell tags disagree. Only in table: ${onlyTable.join(", ") || "none"}; only in tags: ${onlyTag.join(", ") || "none"}`);
  }
  c.spellList = fromSpells;
}


// ---------- monsters (12_MonstersA-Z.md, 13_Animals.md) ----------

const ABILITY_COLS = ["str", "dex", "con", "int", "wis", "cha"];
const signed = (t) => Number(String(t).replace(/[−–]/g, "-").replace("+", ""));

/** One stat block: the heading's section with an "Armor Class" line. Entries are "**_Name._** text" paragraphs. */
function parseMonster(sec, all) {
  const lines = sec.ownBody.split("\n");
  const bullet = (label) => {
    const re = new RegExp(`^- \\*\\*${label}:?\\*\\*:?\\s*(.*)$`);
    for (const l of lines) {
      const m = re.exec(l.trim());
      if (m) return clean(m[1]);
    }
    return null;
  };
  const kind = /^\*([^*]+)\*$/m.exec(sec.ownBody);
  const [sizeType, alignment = ""] = kind ? kind[1].split(/,\s*(?=[^,]*$)/) : ["", ""];
  const sizeWords = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
  const sizeMatch = new RegExp(`^((?:${sizeWords.join("|")})(?: or (?:${sizeWords.join("|")}))?)\\s+(.*)$`).exec(sizeType.trim());
  const hp = /^(\d+)\s*\(([^)]+)\)/.exec(bullet("Hit Points") ?? "");
  const init = /^([+−–-]?\d+)\s*\((\d+)\)/.exec(bullet("Initiative") ?? "");
  const crLine = lines.find((l) => /^- \*\*CR\*\*/.test(l.trim())) ?? "";
  const cr = /\*\*CR\*\*\s*([\d/]+)\s*\(XP ([\d,]+)(?:, or [\d,]+ in lair)?; PB \+(\d+)\)/.exec(crLine);
  const abilities = {};
  const table = tableAfter(sec.ownBody);
  for (const row of table?.rows ?? []) {
    const label = (row[0] ?? "").toUpperCase();
    if (!["SCORE", "MOD", "SAVE"].includes(label)) continue;
    ABILITY_COLS.forEach((a, i) => {
      abilities[a] ??= {};
      abilities[a][label.toLowerCase()] = signed(row[i + 1]);
    });
  }
  const acText = bullet("Armor Class") ?? "";
  const monster = {
    id: slug(sec.title),
    name: sec.title,
    size: sizeMatch ? sizeMatch[1] : "",
    type: sizeMatch ? sizeMatch[2] : sizeType.trim(),
    alignment: alignment.trim(),
    ac: Number(/^\d+/.exec(acText)?.[0] ?? 10),
    acNote: acText.replace(/^\d+\s*/, "") || undefined,
    hp: hp ? { average: Number(hp[1]), formula: hp[2].replace(/\s+/g, " ").trim() } : { average: 1, formula: "1" },
    speed: bullet("Speed") ?? "",
    initiative: init ? { bonus: signed(init[1]), score: Number(init[2]) } : { bonus: 0, score: 10 },
    abilities,
    skills: bullet("Skills") ?? undefined,
    vulnerabilities: bullet("Vulnerabilities") ?? undefined,
    resistances: bullet("Resistances") ?? undefined,
    immunities: bullet("Immunities") ?? undefined,
    gear: bullet("Gear") ?? undefined,
    senses: bullet("Senses") ?? "",
    languages: bullet("Languages") ?? "",
    cr: cr ? cr[1] : "0",
    xp: cr ? Number(cr[2].replace(/,/g, "")) : 0,
    pb: cr ? Number(cr[3]) : 2,
    sections: [],
  };
  for (const sub of all.filter((x) => x.depth === sec.depth + 1 && x.line > sec.line && x.line < sec.end)) {
    const entries = [];
    let intro = "";
    for (const para of sub.ownBody.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
      const m = /^\*\*_?([^*_]+?)\.?_?\*\*\s*([\s\S]*)$/.exec(para);
      if (m && !para.startsWith("- ")) entries.push({ name: m[1].replace(/\.$/, "").trim(), text: m[2].trim() });
      else if (entries.length) entries[entries.length - 1].text += `\n\n${para}`;
      else intro += (intro ? "\n\n" : "") + para;
    }
    monster.sections.push({ title: sub.title, ...(intro ? { intro } : {}), entries });
  }
  return monster;
}

function parseMonsters(file) {
  const all = sections(read(file));
  // Each section's end line, so sub-headings can be matched to their stat block.
  const lines = read(file).split("\n").length;
  all.forEach((h, i) => {
    h.end = lines;
    for (let j = i + 1; j < all.length; j++) {
      if (all[j].depth <= h.depth) {
        h.end = all[j].line;
        break;
      }
    }
  });
  return all.filter((x) => /\*\*Armor Class:?\*\*/.test(x.ownBody)).map((x) => parseMonster(x, all));
}

const monsters = [...parseMonsters("12_MonstersA-Z.md"), ...parseMonsters("13_Animals.md")].sort((a, b) => a.name.localeCompare(b.name));
const monsterIds = new Set();
for (const m of monsters) {
  if (monsterIds.has(m.id)) console.warn(`Two monsters share the id ${m.id}`);
  monsterIds.add(m.id);
  if (Object.keys(m.abilities).length !== 6) console.warn(`${m.name}: ability table not read`);
  if (!m.sections.length) console.warn(`${m.name}: no actions read`);
}

const legal = read("00_Legal.md");
const attribution = /^> (.+)$/m.exec(legal)[1];
const pack = {
  id: "srd-5.2.1",
  ruleset: "dnd5e-2024",
  name: "System Reference Document 5.2.1",
  version: "5.2.1",
  license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/legalcode",
  attribution,
  source: "https://www.dndbeyond.com/srd",
  importedWith: "tools/srd-import/import.mjs",
};

const write = (name, data) => writeFileSync(join(OUT, name), `${JSON.stringify(data, null, 1)}\n`);
write("pack.json", pack);
write("classes.json", classes);
write("species.json", origins.species);
write("backgrounds.json", origins.backgrounds);
write("feats.json", feats);
write("weapons.json", equipment.weapons);
write("armor.json", equipment.armor);
write("gear.json", equipment.gear);
write("rules-text.json", { mastery: equipment.mastery, properties: equipment.properties });
write("spells.json", spells);
write("monsters.json", monsters);

console.log(
  `SRD 5.2.1 pack written to ${OUT}: ${classes.length} classes, ${origins.species.length} species, ` +
    `${origins.backgrounds.length} backgrounds, ${feats.length} feats, ${equipment.weapons.length} weapons, ` +
    `${equipment.armor.length} armor, ${equipment.gear.length} gear and tools, ${spells.length} spells, ${monsters.length} monsters.`,
);
