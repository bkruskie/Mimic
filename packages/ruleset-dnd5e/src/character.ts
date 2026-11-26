/**
 * Character operations. Every function returns a new character; nothing is mutated in place,
 * so the app can keep an undo history and the vault can save whole documents.
 */
import { findBackground, findClass, resolveItem } from "./content.js";
import { classSpellLists, derive, type DerivedSheet } from "./derive.js";
import { MULTICLASS_MINIMUM, SPELLCASTING_ABILITY, STANDARD_ARRAY, primaryAbilities } from "./mechanics.js";
import { ABILITIES, SKILL_IDS, type Ability, type AbilityScores, type Character, type ClassEntry, type Content, type Homebrew, type InventoryItem } from "./types.js";

export const CURRENT_SCHEMA_VERSION = 2 as const;

export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const now = () => new Date().toISOString();
const touch = (c: Character): Character => ({ ...c, updatedAt: now() });

export interface NewCharacterInput {
  name: string;
  classId: string;
  speciesId: string;
  backgroundId: string;
  baseAbilities?: AbilityScores;
}

export function emptyClassEntry(id: string, level = 1): ClassEntry {
  return { id, level, subclass: null, skills: [], expertise: [], hitPointRolls: [], choices: {}, weaponMasteries: [] };
}

/** Creates a level 1 character with the background's origin feat attached. Choices are filled in by the builder. */
export function createCharacter(content: Content, input: NewCharacterInput): Character {
  const background = findBackground(content, input.backgroundId);
  findClass(content, input.classId);
  const base: AbilityScores =
    input.baseAbilities ?? (Object.fromEntries(ABILITIES.map((a, i) => [a, STANDARD_ARRAY[i]])) as AbilityScores);
  const character: Character = {
    id: newId(),
    ruleset: "dnd5e-2024",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now(),
    updatedAt: now(),
    name: input.name.trim() || "Unnamed adventurer",
    playerName: "",
    portrait: null,
    build: {
      abilityMethod: input.baseAbilities ? "manual" : "standard",
      baseAbilities: base,
      species: { id: input.speciesId, size: "medium", option: null, spellAbility: null, skill: null },
      background: { id: background.id, abilityIncreases: {} },
      classes: [emptyClassEntry(input.classId)],
      feats: [
        {
          id: background.feat.id,
          source: "background",
          ...(background.feat.id === "magic-initiate"
            ? { magicInitiate: { list: (background.feat.option ?? "wizard").toLowerCase() as "cleric" | "druid" | "wizard", ability: "int", cantrips: [], spell: null } }
            : {}),
        },
      ],
      languages: "Common",
      toolNotes: "",
    },
    spells: { cantrips: [], prepared: [] },
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    state: {
      hp: 0,
      tempHp: 0,
      deathSaves: { successes: 0, failures: 0 },
      hitDiceSpent: 0,
      slotsSpent: [],
      pactSlotsSpent: 0,
      resourcesSpent: {},
      conditions: [],
      exhaustion: 0,
      heroicInspiration: false,
      concentratingOn: null,
    },
    notes: { appearance: "", personality: "", backstory: "", other: "" },
  };
  return fullHeal(character, content);
}

/** Sets current HP to the maximum. Used after building and on a Long Rest. */
export function fullHeal(c: Character, content: Content): Character {
  const sheet = derive(c, content);
  return touch({ ...c, state: { ...c.state, hp: sheet.hp.max.value } });
}

/** Adds items from a starting-equipment option and its gold. Unknown items are kept as named entries. */
export function grantEquipment(c: Character, content: Content, items: { name: string; quantity: number }[], gp: number): Character {
  const inventory: InventoryItem[] = [...c.inventory];
  for (const item of items) {
    const ref = resolveItem(content, item.name);
    const name = ref ? displayName(content, ref, item.name) : item.name;
    const existing = inventory.find((i) => i.name === name && JSON.stringify(i.ref) === JSON.stringify(ref));
    if (existing) existing.quantity += item.quantity;
    else inventory.push({ id: newId(), ref, name, quantity: item.quantity, equipped: shouldEquip(content, ref, inventory) });
  }
  return touch({ ...c, inventory, currency: { ...c.currency, gp: c.currency.gp + gp } });
}

function displayName(content: Content, ref: NonNullable<InventoryItem["ref"]>, original: string): string {
  const list = ref.kind === "weapon" ? content.weapons : ref.kind === "armor" ? content.armor : content.gear;
  const name = list.find((x) => x.id === ref.id)?.name ?? original;
  // Keep the context in names like "Arcane Focus (Quarterstaff)" -> "Quarterstaff (arcane focus)".
  const focus = /^(Arcane|Druidic) Focus/.exec(original);
  return focus && ref.kind === "weapon" ? `${name} (${focus[1]!.toLowerCase()} focus)` : name;
}

function shouldEquip(content: Content, ref: InventoryItem["ref"], current: InventoryItem[]): boolean {
  if (!ref) return false;
  if (ref.kind === "weapon") return true;
  if (ref.kind !== "armor") return false;
  const def = content.armor.find((a) => a.id === ref.id);
  if (!def) return false;
  const sameSlot = current.some((i) => {
    if (!i.equipped || i.ref?.kind !== "armor") return false;
    const other = content.armor.find((a) => a.id === i.ref!.id);
    return other ? (other.category === "shield") === (def.category === "shield") : false;
  });
  return !sameSlot;
}

export interface LevelUpInput {
  classId: string;
  /** A rolled hit-point die result; omit to take the fixed average. */
  hitPointRoll?: number | null;
}

/**
 * Why the character can't take a first level in a class, or null if they can. Multiclassing needs 13 in the primary
 * ability of the new class and of every class they already have.
 */
export function multiclassBlocker(c: Character, content: Content, classId: string): string | null {
  if (c.build.classes.some((e) => e.id === classId)) return null;
  const sheet = derive(c, content);
  if (sheet.level >= 20) return "Level 20 is the highest level.";
  for (const id of [...c.build.classes.map((e) => e.id), classId]) {
    const cls = findClass(content, id);
    const req = primaryAbilities(cls.primaryAbility);
    const ok = req.all ? req.abilities.every((a) => sheet.abilities[a].score.value >= MULTICLASS_MINIMUM) : req.abilities.some((a) => sheet.abilities[a].score.value >= MULTICLASS_MINIMUM);
    if (!ok) {
      const names = req.abilities.map((a) => ({ str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" })[a]);
      return `Needs ${names.join(req.all ? " and " : " or ")} ${MULTICLASS_MINIMUM} or higher${id === classId ? "" : ` (for your ${cls.name} levels)`}.`;
    }
  }
  return null;
}

/** Adds one level to a class, or a first level in a new class (multiclassing), and raises current HP by the same amount as the maximum. */
export function levelUp(c: Character, content: Content, input: LevelUpInput): Character {
  const before = derive(c, content);
  if (before.level >= 20) throw new Error("Level 20 is the highest level.");
  const cls = findClass(content, input.classId);
  const roll = input.hitPointRoll ?? null;
  if (roll !== null && (roll < 1 || roll > cls.hitDie)) throw new Error(`A d${cls.hitDie} roll must be between 1 and ${cls.hitDie}.`);
  let classes: ClassEntry[];
  if (c.build.classes.some((e) => e.id === input.classId)) {
    classes = c.build.classes.map((e) => (e.id === input.classId ? { ...e, level: e.level + 1, hitPointRolls: [...e.hitPointRolls, roll] } : e));
  } else {
    const blocker = multiclassBlocker(c, content, input.classId);
    if (blocker) throw new Error(`You can't take a level in ${cls.name} yet. ${blocker}`);
    classes = [...c.build.classes, { ...emptyClassEntry(input.classId), hitPointRolls: [roll] }];
  }
  const next: Character = { ...c, build: { ...c.build, classes } };
  const after = derive(next, content);
  const gained = after.hp.max.value - before.hp.max.value;
  return touch({ ...next, state: { ...next.state, hp: Math.max(0, c.state.hp + gained) } });
}

/** Replaces one spellcasting class's cantrips and prepared spells. */
export function setClassSpells(c: Character, classId: string, next: { cantrips: string[]; prepared: string[] }): Character {
  const first = c.build.classes.find((e) => SPELLCASTING_ABILITY[e.id]);
  if (!first || first.id === classId) return touch({ ...c, spells: { ...c.spells, cantrips: next.cantrips, prepared: next.prepared } });
  return touch({ ...c, spells: { ...c.spells, byClass: { ...(c.spells.byClass ?? {}), [classId]: next } } });
}

export { classSpellLists };

// ---------- play state ----------

export function applyDamage(c: Character, content: Content, amount: number): Character {
  if (!Number.isFinite(amount) || amount <= 0) return c;
  const sheet = derive(c, content);
  let remaining = Math.floor(amount);
  const fromTemp = Math.min(c.state.tempHp, remaining);
  remaining -= fromTemp;
  const hp = Math.max(0, Math.min(c.state.hp, sheet.hp.max.value) - remaining);
  const deathSaves = c.state.hp === 0 && remaining > 0 ? { ...c.state.deathSaves, failures: Math.min(3, c.state.deathSaves.failures + 1) } : c.state.deathSaves;
  return touch({ ...c, state: { ...c.state, tempHp: c.state.tempHp - fromTemp, hp, deathSaves } });
}

export function heal(c: Character, content: Content, amount: number): Character {
  if (!Number.isFinite(amount) || amount <= 0) return c;
  const max = derive(c, content).hp.max.value;
  const hp = Math.min(max, c.state.hp + Math.floor(amount));
  const deathSaves = hp > 0 ? { successes: 0, failures: 0 } : c.state.deathSaves;
  return touch({ ...c, state: { ...c.state, hp, deathSaves } });
}

/** Temporary Hit Points don't stack: the larger amount wins. */
export function setTempHp(c: Character, amount: number): Character {
  return touch({ ...c, state: { ...c.state, tempHp: Math.max(0, Math.floor(amount)) } });
}

export function recordDeathSave(c: Character, outcome: "success" | "failure" | "critical-success" | "critical-failure"): Character {
  const ds = { ...c.state.deathSaves };
  if (outcome === "critical-success") return touch({ ...c, state: { ...c.state, hp: 1, deathSaves: { successes: 0, failures: 0 } } });
  if (outcome === "success") ds.successes = Math.min(3, ds.successes + 1);
  if (outcome === "failure") ds.failures = Math.min(3, ds.failures + 1);
  if (outcome === "critical-failure") ds.failures = Math.min(3, ds.failures + 2);
  return touch({ ...c, state: { ...c.state, deathSaves: ds } });
}

export function spendSlot(c: Character, slotLevel: number, pact = false): Character {
  if (pact) return touch({ ...c, state: { ...c.state, pactSlotsSpent: c.state.pactSlotsSpent + 1 } });
  const slotsSpent = [...c.state.slotsSpent];
  slotsSpent[slotLevel - 1] = (slotsSpent[slotLevel - 1] ?? 0) + 1;
  return touch({ ...c, state: { ...c.state, slotsSpent } });
}

export function restoreSlot(c: Character, slotLevel: number, pact = false): Character {
  if (pact) return touch({ ...c, state: { ...c.state, pactSlotsSpent: Math.max(0, c.state.pactSlotsSpent - 1) } });
  const slotsSpent = [...c.state.slotsSpent];
  slotsSpent[slotLevel - 1] = Math.max(0, (slotsSpent[slotLevel - 1] ?? 0) - 1);
  return touch({ ...c, state: { ...c.state, slotsSpent } });
}

export function setResourceSpent(c: Character, resourceId: string, spent: number): Character {
  return touch({ ...c, state: { ...c.state, resourcesSpent: { ...c.state.resourcesSpent, [resourceId]: Math.max(0, Math.floor(spent)) } } });
}

export function toggleCondition(c: Character, condition: string): Character {
  const has = c.state.conditions.includes(condition);
  const conditions = has ? c.state.conditions.filter((x) => x !== condition) : [...c.state.conditions, condition];
  return touch({ ...c, state: { ...c.state, conditions } });
}

export function setExhaustion(c: Character, level: number): Character {
  return touch({ ...c, state: { ...c.state, exhaustion: Math.max(0, Math.min(6, Math.floor(level))) } });
}

/**
 * Short Rest: spend Hit Point Dice (each `rolls` entry is one die's face; the Constitution modifier is added per die),
 * regain Pact Magic slots, and recover short-rest resources.
 */
/**
 * Short Rest. Each roll is a Hit Point Die result; give `{ die, roll }` when the character has more than one size of
 * Hit Point Die, otherwise a plain number uses the first size that has dice left.
 */
export function shortRest(c: Character, content: Content, rolls: (number | { die: number; roll: number })[] = []): Character {
  const sheet = derive(c, content);
  const conMod = sheet.abilities.con.mod;
  const left: Record<number, number> = Object.fromEntries(sheet.hitDiceByDie.map((g) => [g.die, g.available]));
  const spentByDie: Record<string, number> = Object.fromEntries(sheet.hitDiceByDie.map((g) => [String(g.die), g.total - g.available]));
  let healed = 0;
  let usable = 0;
  for (const r of rolls) {
    const die = typeof r === "number" ? sheet.hitDiceByDie.find((g) => (left[g.die] ?? 0) > 0)?.die : r.die;
    const value = typeof r === "number" ? r : r.roll;
    if (die === undefined || (left[die] ?? 0) <= 0) continue;
    left[die] = (left[die] ?? 0) - 1;
    spentByDie[String(die)] = (spentByDie[String(die)] ?? 0) + 1;
    usable += 1;
    healed += Math.max(0, value + conMod);
  }
  const resourcesSpent = { ...c.state.resourcesSpent };
  for (const r of sheet.resources) {
    if (r.reset === "short") resourcesSpent[r.id] = 0;
    if (r.reset === "shortOne") resourcesSpent[r.id] = Math.max(0, (resourcesSpent[r.id] ?? 0) - 1);
  }
  return touch({
    ...c,
    state: {
      ...c.state,
      hp: Math.min(sheet.hp.max.value, c.state.hp + healed),
      hitDiceSpent: c.state.hitDiceSpent + usable,
      hitDiceSpentByDie: spentByDie,
      pactSlotsSpent: 0,
      resourcesSpent,
    },
  });
}

/** Long Rest: full HP, half of spent Hit Point Dice back is not a 2024 rule; all are regained. Slots and resources reset; one Exhaustion level is removed. */
export function longRest(c: Character, content: Content): Character {
  const sheet = derive(c, content);
  const speciesHuman = c.build.species.id === "human";
  return touch({
    ...c,
    state: {
      ...c.state,
      hp: sheet.hp.max.value,
      tempHp: 0,
      deathSaves: { successes: 0, failures: 0 },
      hitDiceSpent: 0,
      hitDiceSpentByDie: {},
      slotsSpent: [],
      pactSlotsSpent: 0,
      resourcesSpent: {},
      exhaustion: Math.max(0, c.state.exhaustion - 1),
      heroicInspiration: speciesHuman ? true : c.state.heroicInspiration,
      concentratingOn: null,
    },
  });
}

// ---------- import and validation ----------

export class CharacterImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharacterImportError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Checks an imported document is a dnd5e-2024 character this version understands, migrates older schema versions,
 * and returns it with a fresh id when asked (so importing a copy doesn't overwrite the original).
 */
export function importCharacter(raw: unknown, content: Content, options: { newId?: boolean } = {}): Character {
  if (!isRecord(raw)) throw new CharacterImportError("That file isn't a Mimic Box character.");
  const doc = isRecord(raw.character) ? raw.character : raw;
  if (doc.ruleset !== "dnd5e-2024") throw new CharacterImportError(`This character uses the "${String(doc.ruleset)}" rules, which this version doesn't support yet.`);
  const version = Number(doc.schemaVersion);
  if (!Number.isInteger(version) || version < 1) throw new CharacterImportError("The character file has no valid schema version.");
  if (version > CURRENT_SCHEMA_VERSION) throw new CharacterImportError("This character was saved by a newer version of Mimic Box. Update the app to open it.");
  const c = doc as unknown as Character;
  if (!isRecord(c.build) || !Array.isArray(c.build.classes) || c.build.classes.length === 0) throw new CharacterImportError("The character file is missing its class.");
  if (!isRecord(c.state) || !Array.isArray(c.inventory)) throw new CharacterImportError("The character file is incomplete.");
  for (const a of ABILITIES) {
    const score = (c.build.baseAbilities as Record<Ability, unknown>)?.[a];
    if (typeof score !== "number" || score < 1 || score > 30) throw new CharacterImportError(`The ${a.toUpperCase()} score in the file isn't valid.`);
  }
  validateHomebrew(c.homebrew);
  try {
    derive(c, content);
  } catch (e) {
    throw new CharacterImportError(`The character refers to content this app doesn't have: ${(e as Error).message}`);
  }
  const upgraded: Character = { ...c, schemaVersion: CURRENT_SCHEMA_VERSION };
  return options.newId ? { ...upgraded, id: newId(), updatedAt: now() } : upgraded;
}

const BONUS_TARGETS = new Set<string>([
  "ac",
  "saves",
  "initiative",
  "speed",
  "hpMax",
  "attack",
  "spellDc",
  "spellAttack",
  ...ABILITIES.flatMap((a) => [`save:${a}`, `ability:${a}`]),
  ...SKILL_IDS.map((s) => `skill:${s}`),
]);

function validateHomebrew(h: unknown): void {
  if (h === undefined) return;
  const bad = (what: string) => new CharacterImportError(`The character's homebrew ${what} isn't valid, so the file wasn't imported. Remove it from the file or export it again from Mimic Box.`);
  if (!isRecord(h) || !Array.isArray(h.features) || !Array.isArray(h.attacks) || !Array.isArray(h.bonuses)) throw bad("section");
  for (const f of h.features) if (!isRecord(f) || typeof f.name !== "string" || typeof f.text !== "string") throw bad("feature list");
  for (const a of h.attacks) if (!isRecord(a) || typeof a.name !== "string" || typeof a.damage !== "string") throw bad("attack list");
  for (const b of h.bonuses) if (!isRecord(b) || typeof b.value !== "number" || !BONUS_TARGETS.has(String(b.target))) throw bad("bonus list");
  if (h.subclasses !== undefined) {
    if (!Array.isArray(h.subclasses)) throw bad("subclass list");
    for (const sc of h.subclasses) {
      if (!isRecord(sc) || typeof sc.name !== "string" || typeof sc.classId !== "string" || !Array.isArray(sc.features)) throw bad("subclass list");
      for (const f of sc.features) if (!isRecord(f) || typeof f.level !== "number" || typeof f.name !== "string") throw bad("subclass list");
    }
  }
}

// ---------- homebrew ----------

type HomebrewList<K extends keyof Homebrew> = NonNullable<Homebrew[K]>;

/** Adds or replaces one homebrew entry (matched by id). */
export function saveHomebrew<K extends keyof Homebrew>(c: Character, kind: K, entry: HomebrewList<K>[number]): Character {
  const hb: Homebrew = c.homebrew ?? { features: [], attacks: [], bonuses: [] };
  const list = (hb[kind] ?? []) as HomebrewList<K>[number][];
  const next = list.some((e) => e.id === entry.id) ? list.map((e) => (e.id === entry.id ? entry : e)) : [...list, entry];
  return touch({ ...c, homebrew: { ...hb, [kind]: next } });
}

/** Removes one homebrew entry and any uses spent on it. Removing a subclass also unpicks it. */
export function removeHomebrew(c: Character, kind: keyof Homebrew, id: string): Character {
  const hb: Homebrew = c.homebrew ?? { features: [], attacks: [], bonuses: [] };
  const resourcesSpent = { ...c.state.resourcesSpent };
  delete resourcesSpent[`custom:${id}`];
  let classes = c.build.classes;
  if (kind === "subclasses") {
    for (const f of hb.subclasses?.find((x) => x.id === id)?.features ?? []) delete resourcesSpent[`custom:${f.id}`];
    classes = classes.map((e) => (e.subclass === id ? { ...e, subclass: null } : e));
  }
  return touch({
    ...c,
    build: { ...c.build, classes },
    homebrew: { ...hb, [kind]: ((hb[kind] ?? []) as { id: string }[]).filter((e) => e.id !== id) },
    state: { ...c.state, resourcesSpent },
  });
}

export interface CharacterFile {
  format: "mimicbox-character";
  formatVersion: 1;
  exportedAt: string;
  attribution: string;
  character: Character;
}

export function exportCharacter(c: Character, content: Content): CharacterFile {
  return { format: "mimicbox-character", formatVersion: 1, exportedAt: now(), attribution: content.pack.attribution, character: c };
}

export type { DerivedSheet };
