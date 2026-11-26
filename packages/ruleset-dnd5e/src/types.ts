/** Content and character types for the dnd5e-2024 ruleset. Content types mirror the JSON written by tools/srd-import. */

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];

export const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

export const SKILLS = {
  acrobatics: { name: "Acrobatics", ability: "dex" },
  animalHandling: { name: "Animal Handling", ability: "wis" },
  arcana: { name: "Arcana", ability: "int" },
  athletics: { name: "Athletics", ability: "str" },
  deception: { name: "Deception", ability: "cha" },
  history: { name: "History", ability: "int" },
  insight: { name: "Insight", ability: "wis" },
  intimidation: { name: "Intimidation", ability: "cha" },
  investigation: { name: "Investigation", ability: "int" },
  medicine: { name: "Medicine", ability: "wis" },
  nature: { name: "Nature", ability: "int" },
  perception: { name: "Perception", ability: "wis" },
  performance: { name: "Performance", ability: "cha" },
  persuasion: { name: "Persuasion", ability: "cha" },
  religion: { name: "Religion", ability: "int" },
  sleightOfHand: { name: "Sleight of Hand", ability: "dex" },
  stealth: { name: "Stealth", ability: "dex" },
  survival: { name: "Survival", ability: "wis" },
} as const satisfies Record<string, { name: string; ability: Ability }>;
export type SkillId = keyof typeof SKILLS;
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

// ---------- content ----------

export interface ItemGrant {
  name: string;
  quantity: number;
}
export interface EquipmentOption {
  label: string;
  items: ItemGrant[];
  gp: number;
}

export interface ClassFeature {
  id: string;
  name: string;
  level: number;
  text: string;
}

export interface Subclass {
  id: string;
  name: string;
  description: string;
  features: ClassFeature[];
}

export interface ProgressionRow {
  level: number;
  proficiencyBonus: number;
  features: string[];
  spellSlots?: number[];
  columns: Record<string, string>;
}

export interface ClassDef {
  id: string;
  name: string;
  primaryAbility: string;
  hitDie: number;
  savingThrows: Ability[];
  skills: { choose: number; from: SkillId[] };
  weaponText: string;
  weapons: { simple: boolean; martial: boolean; martialWithProperty: string[] | null };
  toolText: string | null;
  armorText: string;
  armor: { light: boolean; medium: boolean; heavy: boolean; shield: boolean };
  startingEquipment: EquipmentOption[];
  startingEquipmentText: string;
  progression: ProgressionRow[];
  features: ClassFeature[];
  subclasses: Subclass[];
  options: { id: string; name: string; intro: string; items: { id: string; name: string; text: string }[] }[];
  spellList: Record<string, string[]>;
}

export interface SpeciesTrait {
  name: string;
  text: string;
}
export interface SpeciesDef {
  id: string;
  name: string;
  creatureType: string;
  sizeText: string;
  sizes: ("medium" | "small")[];
  speed: number;
  darkvision: number | null;
  traits: SpeciesTrait[];
}

export interface BackgroundDef {
  id: string;
  name: string;
  abilityOptions: Ability[];
  feat: { id: string; name: string; option: string | null };
  skills: SkillId[];
  tool: string;
  equipment: EquipmentOption[];
  equipmentText: string;
}

export interface FeatDef {
  id: string;
  name: string;
  category: "origin" | "general" | "fighting-style" | "epic-boon";
  prerequisite: string | null;
  repeatable: boolean;
  text: string;
}

export interface WeaponDef {
  id: string;
  name: string;
  category: "simple" | "martial";
  kind: "melee" | "ranged";
  damage: string;
  damageType: string | null;
  properties: string[];
  propertiesText: string;
  range: { normal: number; long: number } | null;
  versatileDamage: string | null;
  mastery: string;
  weight: string;
  cost: string;
}

export interface ArmorDef {
  id: string;
  name: string;
  category: "light" | "medium" | "heavy" | "shield";
  baseAc: number;
  addDex: boolean;
  maxDex: number | null;
  strength: number | null;
  stealthDisadvantage: boolean;
  weight: string;
  cost: string;
}

export interface GearDef {
  id: string;
  name: string;
  kind: "gear" | "tool";
  cost: string;
  text: string;
}

export interface SpellDef {
  id: string;
  name: string;
  level: number;
  school: string;
  classes: string[];
  castingTime: string | null;
  ritual: boolean;
  range: string | null;
  components: string | null;
  material: string | null;
  duration: string | null;
  concentration: boolean;
  scales: boolean;
  description: string;
}

export interface ContentPack {
  id: string;
  ruleset: string;
  name: string;
  version: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  source: string;
}

export interface Content {
  pack: ContentPack;
  classes: ClassDef[];
  species: SpeciesDef[];
  backgrounds: BackgroundDef[];
  feats: FeatDef[];
  weapons: WeaponDef[];
  armor: ArmorDef[];
  gear: GearDef[];
  rulesText: { mastery: { id: string; name: string; text: string }[]; properties: { id: string; name: string; text: string }[] };
  /** Spells are large, so they load separately. Missing until loaded. */
  spells?: SpellDef[];
}

// ---------- character ----------

export type AbilityScores = Record<Ability, number>;

export interface MagicInitiateChoice {
  list: "cleric" | "druid" | "wizard";
  ability: Ability;
  cantrips: string[];
  spell: string | null;
}

export interface FeatChoice {
  /** Feat id from the content pack. */
  id: string;
  /** Where the feat came from, for example "background", "species", "class:fighter:1" or "asi:4". */
  source: string;
  /** Ability Score Improvement increases, or other per-feat ability choices. */
  abilityIncreases?: Partial<AbilityScores>;
  magicInitiate?: MagicInitiateChoice;
  /** Skilled: three skills (tool picks are kept as free text in `notes`). */
  skills?: SkillId[];
  notes?: string;
}

export interface ClassEntry {
  id: string;
  level: number;
  subclass: string | null;
  skills: SkillId[];
  expertise: SkillId[];
  /** Rolled hit points for levels 2 and up, by index (level 2 is index 0). Missing entries use the fixed average. */
  hitPointRolls: (number | null)[];
  /** Named class choices: "divineOrder", "primalOrder", "landType", "elementalAffinity". */
  choices: Record<string, string>;
  weaponMasteries: string[];
  /** Picks from the class's option lists: Eldritch Invocations, Metamagic. Missing on older files. */
  options?: string[];
}

export interface InventoryItem {
  id: string;
  /** Link to content, when the item is a known weapon, armor piece or gear. */
  ref: { kind: "weapon" | "armor" | "gear"; id: string } | null;
  name: string;
  quantity: number;
  equipped: boolean;
  attuned?: boolean;
  notes?: string;
}

export interface Currency {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

export interface PlayState {
  hp: number;
  tempHp: number;
  deathSaves: { successes: number; failures: number };
  hitDiceSpent: number;
  /** Expended spell slots by slot level (index 0 = level 1). */
  slotsSpent: number[];
  pactSlotsSpent: number;
  /** Expended uses of limited resources, by resource id. */
  resourcesSpent: Record<string, number>;
  conditions: string[];
  exhaustion: number;
  heroicInspiration: boolean;
  concentratingOn: string | null;
}

export interface Character {
  id: string;
  ruleset: "dnd5e-2024";
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  name: string;
  playerName: string;
  portrait: string | null;
  build: {
    abilityMethod: "standard" | "pointBuy" | "rolled" | "manual";
    baseAbilities: AbilityScores;
    species: {
      id: string;
      size: "medium" | "small";
      /** Lineage, legacy or ancestry option id, for species that have one. */
      option: string | null;
      /** Spellcasting ability for lineage spells. */
      spellAbility: Ability | null;
      /** Keen Senses (Elf) or Skillful (Human). */
      skill: SkillId | null;
    };
    background: {
      id: string;
      abilityIncreases: Partial<AbilityScores>;
    };
    classes: ClassEntry[];
    feats: FeatChoice[];
    languages: string;
    toolNotes: string;
  };
  spells: {
    cantrips: string[];
    prepared: string[];
    /** Warlock Mystic Arcanum: spell level ("6" to "9") to spell id. Missing on older files. */
    arcanum?: Record<string, string>;
  };
  inventory: InventoryItem[];
  currency: Currency;
  state: PlayState;
  notes: {
    appearance: string;
    personality: string;
    backstory: string;
    other: string;
  };
}
