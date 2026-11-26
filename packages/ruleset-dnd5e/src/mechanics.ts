/**
 * Hand-written SRD 5.2.1 mechanics: the rules the engine computes. The text players read comes from the content pack;
 * this file only holds numbers and switches the text describes. Every entry names the SRD feature it implements.
 */
import type { Ability, SkillId } from "./types.js";

export const SPELLCASTING_ABILITY: Record<string, Ability> = {
  bard: "cha",
  cleric: "wis",
  druid: "wis",
  paladin: "cha",
  ranger: "wis",
  sorcerer: "cha",
  warlock: "cha",
  wizard: "int",
};

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export type ResetKind = "long" | "short" | "shortOne";

export interface ResourceDef {
  id: string;
  name: string;
  max: number;
  reset: ResetKind;
  /** Shown beside the count, for example "d6" for Bardic Inspiration. */
  detail?: string;
  /** "points" pools such as Lay On Hands are spent in amounts, not single uses. */
  unit?: "uses" | "points";
  source: string;
}

const col = (columns: Record<string, string> | undefined, name: string): number => {
  const raw = columns?.[name];
  if (!raw || raw === "—") return 0;
  return Number.parseInt(raw.replace(/[^\d-]/g, ""), 10) || 0;
};

/** Limited-use class resources for one class at a given level. */
export function classResources(
  classId: string,
  level: number,
  columns: Record<string, string>,
  mods: Record<Ability, number>,
  proficiencyBonus: number,
): ResourceDef[] {
  const out: ResourceDef[] = [];
  const add = (r: ResourceDef) => r.max > 0 && out.push(r);
  switch (classId) {
    case "barbarian":
      add({ id: "rage", name: "Rage", max: col(columns, "Rages"), reset: "shortOne", detail: `+${col(columns, "Rage Damage")} damage`, source: "Barbarian: Rage" });
      break;
    case "bard":
      add({
        id: "bardic-inspiration",
        name: "Bardic Inspiration",
        max: Math.max(1, mods.cha),
        reset: level >= 5 ? "short" : "long",
        detail: (columns["Bardic Die"] ?? "d6").toLowerCase(),
        source: level >= 5 ? "Bard: Bardic Inspiration, Font of Inspiration" : "Bard: Bardic Inspiration",
      });
      break;
    case "cleric":
      add({ id: "channel-divinity", name: "Channel Divinity", max: col(columns, "Channel Divinity"), reset: "shortOne", source: "Cleric: Channel Divinity" });
      if (level >= 10) add({ id: "divine-intervention", name: "Divine Intervention", max: 1, reset: "long", source: level >= 20 ? "Cleric: Divine Intervention, Greater Divine Intervention" : "Cleric: Divine Intervention" });
      break;
    case "druid":
      add({ id: "wild-shape", name: "Wild Shape", max: col(columns, "Wild Shape"), reset: "shortOne", source: "Druid: Wild Shape" });
      break;
    case "fighter":
      add({ id: "second-wind", name: "Second Wind", max: col(columns, "Second Wind"), reset: "shortOne", detail: `1d10+${level} HP`, source: "Fighter: Second Wind" });
      if (level >= 2) add({ id: "action-surge", name: "Action Surge", max: level >= 17 ? 2 : 1, reset: "short", source: "Fighter: Action Surge" });
      if (level >= 9) add({ id: "indomitable", name: "Indomitable", max: level >= 17 ? 3 : level >= 13 ? 2 : 1, reset: "long", source: "Fighter: Indomitable" });
      break;
    case "monk":
      add({ id: "focus", name: "Focus Points", max: col(columns, "Focus Points"), reset: "short", unit: "points", source: "Monk: Monk's Focus" });
      if (level >= 2) add({ id: "uncanny-metabolism", name: "Uncanny Metabolism", max: 1, reset: "long", source: "Monk: Uncanny Metabolism" });
      break;
    case "paladin":
      add({ id: "lay-on-hands", name: "Lay On Hands", max: 5 * level, reset: "long", unit: "points", source: "Paladin: Lay On Hands" });
      add({ id: "channel-divinity", name: "Channel Divinity", max: col(columns, "Channel Divinity"), reset: "shortOne", source: "Paladin: Channel Divinity" });
      if (level >= 5) add({ id: "faithful-steed", name: "Find Steed (free cast)", max: 1, reset: "long", source: "Paladin: Faithful Steed" });
      break;
    case "ranger":
      add({ id: "favored-enemy", name: "Hunter's Mark (free casts)", max: col(columns, "Favored Enemy"), reset: "long", source: "Ranger: Favored Enemy" });
      if (level >= 10) add({ id: "tireless", name: "Tireless (Temporary Hit Points)", max: Math.max(1, mods.wis), reset: "long", detail: `1d8+${Math.max(0, mods.wis)}`, source: "Ranger: Tireless" });
      if (level >= 14) add({ id: "natures-veil", name: "Nature's Veil", max: Math.max(1, mods.wis), reset: "long", source: "Ranger: Nature's Veil" });
      break;
    case "rogue":
      if (level >= 20) add({ id: "stroke-of-luck", name: "Stroke of Luck", max: 1, reset: "short", source: "Rogue: Stroke of Luck" });
      break;
    case "sorcerer":
      add({ id: "innate-sorcery", name: "Innate Sorcery", max: 2, reset: "long", source: "Sorcerer: Innate Sorcery" });
      add({ id: "sorcery-points", name: "Sorcery Points", max: col(columns, "Sorcery Points"), reset: "long", unit: "points", source: "Sorcerer: Font of Magic" });
      if (level >= 5) add({ id: "sorcerous-restoration", name: "Sorcerous Restoration", max: 1, reset: "long", detail: `${Math.floor(level / 2)} points`, source: "Sorcerer: Sorcerous Restoration" });
      break;
    case "warlock":
      if (level >= 2) add({ id: "magical-cunning", name: "Magical Cunning", max: 1, reset: "long", source: "Warlock: Magical Cunning" });
      break;
    case "wizard":
      add({ id: "arcane-recovery", name: "Arcane Recovery", max: 1, reset: "long", detail: `${Math.ceil(level / 2)} slot levels`, source: "Wizard: Arcane Recovery" });
      if (level >= 20) add({ id: "signature-spells", name: "Signature Spells", max: 2, reset: "short", detail: "one cast of each", source: "Wizard: Signature Spells" });
      break;
  }
  void proficiencyBonus;
  return out;
}

/** Weapon Mastery: how many weapon kinds a class can master at a level. */
export function weaponMasteryCount(classId: string, columns: Record<string, string>): number {
  if (classId === "barbarian" || classId === "fighter") return col(columns, "Weapon Mastery");
  if (classId === "paladin" || classId === "ranger" || classId === "rogue") return 2;
  return 0;
}

/** Expertise picks granted by class level. */
export function expertiseCount(classId: string, level: number): number {
  if (classId === "rogue") return level >= 6 ? 4 : 2;
  if (classId === "bard") return level >= 9 ? 4 : level >= 2 ? 2 : 0;
  if (classId === "ranger") return level >= 9 ? 2 : 0;
  return 0;
}

/** Fighting Style feat: the class level that grants one. */
export const FIGHTING_STYLE_LEVEL: Record<string, number> = { fighter: 1, paladin: 2, ranger: 2 };

/** Levels at which a class grants an Ability Score Improvement (a general feat). */
export function asiLevels(classId: string): number[] {
  const base = [4, 8, 12, 16];
  if (classId === "fighter") return [4, 6, 8, 12, 14, 16];
  if (classId === "rogue") return [4, 8, 10, 12, 16];
  return base;
}

export interface ClassChoiceDef {
  key: string;
  label: string;
  level: number;
  options: { id: string; name: string; summary: string }[];
}

/** Named choices a class asks for, with the level that unlocks them. */
export const CLASS_CHOICES: Record<string, ClassChoiceDef[]> = {
  cleric: [
    {
      key: "divineOrder",
      label: "Divine Order",
      level: 1,
      options: [
        { id: "protector", name: "Protector", summary: "Martial weapons and Heavy armor training." },
        { id: "thaumaturge", name: "Thaumaturge", summary: "One extra cantrip; add your Wisdom modifier (min +1) to Arcana and Religion." },
      ],
    },
  ],
  druid: [
    {
      key: "primalOrder",
      label: "Primal Order",
      level: 1,
      options: [
        { id: "magician", name: "Magician", summary: "One extra cantrip; add your Wisdom modifier (min +1) to Arcana and Nature." },
        { id: "warden", name: "Warden", summary: "Martial weapons and Medium armor training." },
      ],
    },
  ],
};

/** Subclass choices that need their own pick (Circle of the Land's land type). */
export const SUBCLASS_CHOICES: Record<string, ClassChoiceDef[]> = {
  "draconic-sorcery": [
    {
      key: "elementalAffinity",
      label: "Elemental Affinity",
      level: 6,
      options: ["Acid", "Cold", "Fire", "Lightning", "Poison"].map((n) => ({
        id: n.toLowerCase(),
        name: n,
        summary: `${n} resistance; add your Charisma modifier to one ${n} damage roll of your Sorcerer spells.`,
      })),
    },
  ],
  "circle-of-the-land": [
    {
      key: "landType",
      label: "Land type",
      level: 3,
      options: ["Arid", "Polar", "Temperate", "Tropical"].map((n) => ({ id: n.toLowerCase(), name: n, summary: `${n} Land spells` })),
    },
  ],
};

export interface SpeciesOption {
  id: string;
  name: string;
  summary: string;
  speed?: number;
  darkvision?: number;
  resistance?: string;
  cantrips?: string[];
  /** Always-prepared spells by character level. */
  spells?: Record<number, string>;
}

export interface SpeciesChoiceDef {
  label: string;
  options: SpeciesOption[];
  needsSpellAbility: boolean;
  skillChoice?: SkillId[] | "any";
  originFeat?: boolean;
}

const dragon = (name: string, type: string): SpeciesOption => ({
  id: name.toLowerCase(),
  name: `${name} (${type})`,
  summary: `${type} breath weapon and ${type} resistance.`,
  resistance: type.toLowerCase(),
});

export const SPECIES_CHOICES: Record<string, SpeciesChoiceDef> = {
  dragonborn: {
    label: "Draconic Ancestry",
    needsSpellAbility: false,
    options: [
      dragon("Black", "Acid"),
      dragon("Blue", "Lightning"),
      dragon("Brass", "Fire"),
      dragon("Bronze", "Lightning"),
      dragon("Copper", "Acid"),
      dragon("Gold", "Fire"),
      dragon("Green", "Poison"),
      dragon("Red", "Fire"),
      dragon("Silver", "Cold"),
      dragon("White", "Cold"),
    ],
  },
  elf: {
    label: "Elven Lineage",
    needsSpellAbility: true,
    skillChoice: ["insight", "perception", "survival"],
    options: [
      { id: "drow", name: "Drow", summary: "Darkvision 120 ft.; Dancing Lights.", darkvision: 120, cantrips: ["dancing-lights"], spells: { 3: "faerie-fire", 5: "darkness" } },
      { id: "high-elf", name: "High Elf", summary: "Prestidigitation (swappable for a Wizard cantrip).", cantrips: ["prestidigitation"], spells: { 3: "detect-magic", 5: "misty-step" } },
      { id: "wood-elf", name: "Wood Elf", summary: "Speed 35 ft.; Druidcraft.", speed: 35, cantrips: ["druidcraft"], spells: { 3: "longstrider", 5: "pass-without-trace" } },
    ],
  },
  gnome: {
    label: "Gnomish Lineage",
    needsSpellAbility: true,
    options: [
      { id: "forest-gnome", name: "Forest Gnome", summary: "Minor Illusion; Speak with Animals always prepared.", cantrips: ["minor-illusion"], spells: { 1: "speak-with-animals" } },
      { id: "rock-gnome", name: "Rock Gnome", summary: "Mending and Prestidigitation; clockwork devices.", cantrips: ["mending", "prestidigitation"] },
    ],
  },
  goliath: {
    label: "Giant Ancestry",
    needsSpellAbility: false,
    options: [
      { id: "cloud", name: "Cloud's Jaunt", summary: "Bonus Action teleport up to 30 ft." },
      { id: "fire", name: "Fire's Burn", summary: "+1d10 Fire damage on a hit." },
      { id: "frost", name: "Frost's Chill", summary: "+1d6 Cold damage and −10 ft. Speed on a hit." },
      { id: "hill", name: "Hill's Tumble", summary: "Knock a Large or smaller target Prone on a hit." },
      { id: "stone", name: "Stone's Endurance", summary: "Reaction: reduce damage by 1d12 + Con." },
      { id: "storm", name: "Storm's Thunder", summary: "Reaction: 1d8 Thunder damage to an attacker." },
    ],
  },
  tiefling: {
    label: "Fiendish Legacy",
    needsSpellAbility: true,
    options: [
      { id: "abyssal", name: "Abyssal", summary: "Poison resistance; Poison Spray.", resistance: "poison", cantrips: ["poison-spray", "thaumaturgy"], spells: { 3: "ray-of-sickness", 5: "hold-person" } },
      { id: "chthonic", name: "Chthonic", summary: "Necrotic resistance; Chill Touch.", resistance: "necrotic", cantrips: ["chill-touch", "thaumaturgy"], spells: { 3: "false-life", 5: "ray-of-enfeeblement" } },
      { id: "infernal", name: "Infernal", summary: "Fire resistance; Fire Bolt.", resistance: "fire", cantrips: ["fire-bolt", "thaumaturgy"], spells: { 3: "hellish-rebuke", 5: "darkness" } },
    ],
  },
  human: {
    label: "Human",
    needsSpellAbility: false,
    options: [],
    skillChoice: "any",
    originFeat: true,
  },
};

/** Fixed species resistances (Dwarf). Option resistances live on the option. */
export const SPECIES_RESISTANCE: Record<string, string> = { dwarf: "poison" };

/** Species limited-use traits, by character level and proficiency bonus. */
export function speciesResources(speciesId: string, level: number, pb: number): ResourceDef[] {
  const out: ResourceDef[] = [];
  switch (speciesId) {
    case "dragonborn":
      out.push({ id: "breath-weapon", name: "Breath Weapon", max: pb, reset: "long", detail: `${level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1}d10`, source: "Dragonborn: Breath Weapon" });
      if (level >= 5) out.push({ id: "draconic-flight", name: "Draconic Flight", max: 1, reset: "long", source: "Dragonborn: Draconic Flight" });
      break;
    case "dwarf":
      out.push({ id: "stonecunning", name: "Stonecunning", max: pb, reset: "long", source: "Dwarf: Stonecunning" });
      break;
    case "goliath":
      out.push({ id: "giant-ancestry", name: "Giant Ancestry", max: pb, reset: "long", source: "Goliath: Giant Ancestry" });
      if (level >= 5) out.push({ id: "large-form", name: "Large Form", max: 1, reset: "long", source: "Goliath: Large Form" });
      break;
    case "orc":
      out.push({ id: "adrenaline-rush", name: "Adrenaline Rush", max: pb, reset: "short", source: "Orc: Adrenaline Rush" });
      out.push({ id: "relentless-endurance", name: "Relentless Endurance", max: 1, reset: "long", source: "Orc: Relentless Endurance" });
      break;
  }
  return out;
}

/** The SRD conditions, for the condition picker. Exhaustion is tracked as a level separately. */
export const CONDITIONS = [
  "Blinded",
  "Charmed",
  "Deafened",
  "Frightened",
  "Grappled",
  "Incapacitated",
  "Invisible",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Restrained",
  "Stunned",
  "Unconscious",
] as const;

// ---------- levels 6 to 20 ----------

/** Epic Boon: every class gains a feat at level 19. */
export const EPIC_BOON_LEVEL = 19;

/** Attacks per Attack action from Extra Attack and its upgrades. */
export function attacksPerAction(classId: string, level: number): { count: number; source: string } | null {
  if (classId === "fighter") {
    if (level >= 20) return { count: 4, source: "Fighter: Three Extra Attacks" };
    if (level >= 11) return { count: 3, source: "Fighter: Two Extra Attacks" };
  }
  if (["barbarian", "fighter", "monk", "paladin", "ranger"].includes(classId) && level >= 5) {
    return { count: 2, source: `${classId[0]!.toUpperCase()}${classId.slice(1)}: Extra Attack` };
  }
  return null;
}

/** Level 20 capstones that raise ability scores above 20 (Primal Champion, Body and Mind). */
export const CAPSTONE_ABILITIES: Record<string, { abilities: Ability[]; amount: number; max: number; source: string }> = {
  barbarian: { abilities: ["str", "con"], amount: 4, max: 25, source: "Primal Champion" },
  monk: { abilities: ["dex", "wis"], amount: 4, max: 25, source: "Body and Mind" },
};

/** Saving throw proficiencies gained later: Monk Disciplined Survivor (14), Rogue Slippery Mind (15). */
export function laterSaveProficiencies(classId: string, level: number): { abilities: Ability[]; source: string } | null {
  if (classId === "monk" && level >= 14) return { abilities: ["str", "dex", "con", "int", "wis", "cha"], source: "Disciplined Survivor" };
  if (classId === "rogue" && level >= 15) return { abilities: ["wis", "cha"], source: "Slippery Mind" };
  return null;
}

/** Feats that raise one ability score by 1, and the cap that increase may reach. */
export const FEAT_ABILITY_INCREASE: Record<string, { abilities: Ability[] | "any"; max: number }> = {
  grappler: { abilities: ["str", "dex"], max: 20 },
  "boon-of-combat-prowess": { abilities: "any", max: 30 },
  "boon-of-dimensional-travel": { abilities: "any", max: 30 },
  "boon-of-fate": { abilities: "any", max: 30 },
  "boon-of-irresistible-offense": { abilities: ["str", "dex"], max: 30 },
  "boon-of-spell-recall": { abilities: ["int", "wis", "cha"], max: 30 },
  "boon-of-the-night-spirit": { abilities: "any", max: 30 },
  "boon-of-truesight": { abilities: "any", max: 30 },
};

export interface ClassOptionRule {
  /** The option list's id in the content pack. */
  listId: string;
  label: string;
  count: number;
}

/** How many picks a class has from its option list at a level: Eldritch Invocations, Metamagic. */
export function classOptionRule(classId: string, level: number, columns: Record<string, string>): ClassOptionRule | null {
  if (classId === "warlock") return { listId: "eldritch-invocation-options", label: "Eldritch Invocations", count: col(columns, "Eldritch Invocations") };
  if (classId === "sorcerer" && level >= 2) return { listId: "metamagic-options", label: "Metamagic", count: level >= 17 ? 6 : level >= 10 ? 4 : 2 };
  return null;
}

/** "Level 5+ Warlock" prerequisites on an option, read from its text. Other prerequisites are listed for the player to check. */
export function optionLevelPrerequisite(text: string): number {
  const m = /Prerequisite:[^*]*?Level (\d+)\+/.exec(text);
  return m ? Number(m[1]) : 0;
}

/** Options that require another option first, for example Thirsting Blade needs Pact of the Blade. */
export function optionRequires(text: string): string | null {
  const m = /Prerequisite:[^*]*?, ([A-Z][^,*]+?) Invocation/.exec(text);
  return m ? m[1]!.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-") : null;
}

/** Warlock Mystic Arcanum: class level that grants each spell level. */
export const MYSTIC_ARCANUM: Record<number, number> = { 11: 6, 13: 7, 15: 8, 17: 9 };

/** Champion crit range by Fighter level. */
export function championCritRange(level: number): number {
  return level >= 15 ? 18 : level >= 3 ? 19 : 20;
}

// ---------- multiclassing ----------

/** Multiclass Spellcaster table: spell slots by combined caster level (index 0 = level 1). */
export const MULTICLASS_SLOTS: number[][] = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const FULL_CASTERS = ["bard", "cleric", "druid", "sorcerer", "wizard"];
const HALF_CASTERS = ["paladin", "ranger"];

/** Classes with the Spellcasting feature (Warlock has Pact Magic instead). */
export const hasSpellcastingFeature = (classId: string) => FULL_CASTERS.includes(classId) || HALF_CASTERS.includes(classId);

/** Combined level for the Multiclass Spellcaster table: full casters count fully, Paladin and Ranger count half, rounded up. */
export function multiclassCasterLevel(entries: { id: string; level: number }[]): number {
  return entries.reduce((t, e) => t + (FULL_CASTERS.includes(e.id) ? e.level : HALF_CASTERS.includes(e.id) ? Math.ceil(e.level / 2) : 0), 0);
}

/** What a class grants when it is not your first class ("As a Multiclass Character"). */
export interface MulticlassGains {
  armor: { light?: boolean; medium?: boolean; shield?: boolean };
  martial: boolean;
  /** Skill picks: from the class list, or any skill (Bard). */
  skills: { count: number; from: "class" | "any" };
  tool: string | null;
}
export const MULTICLASS_GAINS: Record<string, MulticlassGains> = {
  barbarian: { armor: { shield: true }, martial: true, skills: { count: 0, from: "class" }, tool: null },
  bard: { armor: { light: true }, martial: false, skills: { count: 1, from: "any" }, tool: "One Musical Instrument of your choice (Bard)" },
  cleric: { armor: { light: true, medium: true, shield: true }, martial: false, skills: { count: 0, from: "class" }, tool: null },
  druid: { armor: { light: true, shield: true }, martial: false, skills: { count: 0, from: "class" }, tool: null },
  fighter: { armor: { light: true, medium: true, shield: true }, martial: true, skills: { count: 0, from: "class" }, tool: null },
  monk: { armor: {}, martial: false, skills: { count: 0, from: "class" }, tool: null },
  paladin: { armor: { light: true, medium: true, shield: true }, martial: true, skills: { count: 0, from: "class" }, tool: null },
  ranger: { armor: { light: true, medium: true, shield: true }, martial: true, skills: { count: 1, from: "class" }, tool: null },
  rogue: { armor: { light: true }, martial: false, skills: { count: 1, from: "class" }, tool: "Thieves' Tools (Rogue)" },
  sorcerer: { armor: {}, martial: false, skills: { count: 0, from: "class" }, tool: null },
  warlock: { armor: { light: true }, martial: false, skills: { count: 0, from: "class" }, tool: null },
  wizard: { armor: {}, martial: false, skills: { count: 0, from: "class" }, tool: null },
};

const ABILITY_BY_NAME: Record<string, Ability> = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };

/** Reads a class's primary ability from the pack: "Strength or Dexterity" needs either, "Dexterity and Wisdom" needs both. */
export function primaryAbilities(text: string): { abilities: Ability[]; all: boolean } {
  const abilities = text
    .toLowerCase()
    .split(/\s+(?:or|and)\s+|,\s*/)
    .map((w) => ABILITY_BY_NAME[w.trim()])
    .filter((a): a is Ability => Boolean(a));
  return { abilities, all: /\band\b/i.test(text) };
}

/** Multiclassing needs 13 in the primary ability of the new class and of every current class. */
export const MULTICLASS_MINIMUM = 13;
