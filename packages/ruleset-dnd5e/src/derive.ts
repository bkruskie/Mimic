/**
 * Derivation: turns a stored character (choices + play state) into every number on the sheet.
 * Nothing here is saved. Each value carries its sources so the sheet can explain it.
 */
import { DiceSyntaxError, parseDice } from "@mimicbox/dice";
import { findBackground, findClass, findSpecies } from "./content.js";
import {
  CAPSTONE_ABILITIES,
  CLASS_CHOICES,
  EPIC_BOON_LEVEL,
  FEAT_ABILITY_INCREASE,
  FIGHTING_STYLE_LEVEL,
  MYSTIC_ARCANUM,
  SPECIES_CHOICES,
  SPECIES_RESISTANCE,
  SPELLCASTING_ABILITY,
  SUBCLASS_CHOICES,
  asiLevels,
  attacksPerAction,
  championCritRange,
  classOptionRule,
  classResources,
  laterSaveProficiencies,
  optionLevelPrerequisite,
  optionRequires,
  expertiseCount,
  speciesResources,
  weaponMasteryCount,
  type ResourceDef,
} from "./mechanics.js";
import {
  ABILITIES,
  ABILITY_NAMES,
  SKILLS,
  SKILL_IDS,
  type Ability,
  type ArmorDef,
  type BonusTarget,
  type Character,
  type ClassDef,
  type Content,
  type SkillId,
  type WeaponDef,
} from "./types.js";

export interface Source {
  label: string;
  value: number;
}
export interface Sourced {
  value: number;
  sources: Source[];
}

const sum = (sources: Source[]): Sourced => ({ value: sources.reduce((t, s) => t + s.value, 0), sources });
export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

export type ProficiencyLevel = "none" | "half" | "proficient" | "expertise";

export interface Attack {
  id: string;
  name: string;
  toHit: Sourced;
  damage: string;
  damageType: string;
  versatileDamage: string | null;
  range: string;
  properties: string;
  mastery: string | null;
  proficient: boolean;
  notes: string[];
}

export interface PendingChoice {
  kind:
    | "species-option"
    | "species-skill"
    | "species-spell-ability"
    | "background-abilities"
    | "origin-feat"
    | "magic-initiate"
    | "skilled"
    | "class-skills"
    | "expertise"
    | "class-choice"
    | "subclass"
    | "subclass-choice"
    | "fighting-style"
    | "weapon-mastery"
    | "asi"
    | "cantrips"
    | "prepared"
    | "class-options"
    | "epic-boon"
    | "feat-ability"
    | "mystic-arcanum";
  message: string;
  /** Extra detail the UI needs: counts, levels, choice keys. */
  key?: string;
  count?: number;
  level?: number;
}

export interface SpellcastingInfo {
  classId: string;
  ability: Ability;
  saveDc: Sourced;
  attack: Sourced;
  cantripLimit: number;
  preparedLimit: number;
  /** Slots by spell level (index 0 = level 1). */
  slots: number[];
  pact: { count: number; level: number } | null;
  maxSpellLevel: number;
  /** Class spell list ids by spell level, limited to castable levels. */
  list: Record<number, string[]>;
}

export interface GrantedSpell {
  id: string;
  source: string;
  /** True when the spell can also be cast once per Long Rest without a slot. */
  freeCast: boolean;
  cantrip: boolean;
}

export interface FeatureEntry {
  source: string;
  name: string;
  level: number | null;
  text: string;
}

export interface DerivedSheet {
  level: number;
  proficiencyBonus: number;
  classSummary: string;
  speciesName: string;
  backgroundName: string;
  abilities: Record<Ability, { score: Sourced; mod: number; save: Sourced; saveProficient: boolean }>;
  skills: Record<SkillId, { total: Sourced; ability: Ability; proficiency: ProficiencyLevel }>;
  passive: { perception: number; insight: number; investigation: number };
  ac: Sourced;
  /** Attacks per Attack action, from Extra Attack and similar features. */
  attacksPerAction: { count: number; source: string | null };
  initiative: Sourced;
  initiativeAdvantage: boolean;
  speed: Sourced;
  hp: { max: Sourced; current: number; temp: number };
  hitDice: { classId: string; die: number; total: number }[];
  hitDiceAvailable: number;
  attacks: Attack[];
  spellcasting: SpellcastingInfo | null;
  grantedSpells: GrantedSpell[];
  resources: ResourceDef[];
  features: FeatureEntry[];
  proficiencies: { armor: string; weapons: string; tools: string; languages: string };
  resistances: string[];
  darkvision: number | null;
  size: string;
  pending: PendingChoice[];
  warnings: string[];
}

function featuresFrom(cls: ClassDef, level: number): FeatureEntry[] {
  return cls.features
    .filter((f) => f.level <= level)
    .map((f) => ({ source: cls.name, name: f.name, level: f.level, text: f.text }));
}

/** Parses "| 3 | Aid, Bless |" rows from a subclass feature table into always-prepared spells by class level. */
function subclassSpellTable(text: string, landType: string | null): Record<number, string[]> {
  let body = text;
  if (landType) {
    const caption = `Table: ${landType[0]!.toUpperCase()}${landType.slice(1)} Land`;
    const start = text.indexOf(caption);
    if (start >= 0) {
      const rest = text.slice(start + caption.length);
      const next = rest.indexOf("Table:");
      body = next >= 0 ? rest.slice(0, next) : rest;
    }
  }
  const out: Record<number, string[]> = {};
  for (const line of body.split("\n")) {
    const m = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (!m) continue;
    out[Number(m[1])] = m[2]!.split(/,\s*/).map((n) =>
      n.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    );
  }
  return out;
}

function weaponProficient(
  weapon: WeaponDef,
  cls: ClassDef,
  entryChoices: Record<string, string>,
): boolean {
  if (weapon.category === "simple") return cls.weapons.simple;
  if (cls.weapons.martial) return true;
  if (entryChoices.divineOrder === "protector" || entryChoices.primalOrder === "warden") return true;
  const props = cls.weapons.martialWithProperty;
  return props ? props.some((p) => weapon.properties.includes(p)) : false;
}

export function derive(character: Character, content: Content): DerivedSheet {
  const warnings: string[] = [];
  const pending: PendingChoice[] = [];
  const { build, state } = character;

  const entries = build.classes;
  const level = entries.reduce((t, e) => t + e.level, 0) || 1;
  const proficiencyBonus = 2 + Math.floor((level - 1) / 4);
  const primary = entries[0];
  const primaryClass = primary ? findClass(content, primary.id) : null;
  const species = findSpecies(content, build.species.id);
  const speciesChoice = SPECIES_CHOICES[species.id];
  const speciesOption = speciesChoice?.options.find((o) => o.id === build.species.option) ?? null;
  const background = findBackground(content, build.background.id);
  const featIds = new Set(build.feats.map((f) => f.id));

  // ----- homebrew bonuses -----
  const homebrew = character.homebrew ?? { features: [], attacks: [], bonuses: [] };
  const activeBonuses = homebrew.bonuses.filter((b) => {
    if (!b.itemId) return true;
    const item = character.inventory.find((i) => i.id === b.itemId);
    if (!item) warnings.push(`"${b.label}" is tied to an item that is no longer in your inventory, so it doesn't count.`);
    return Boolean(item?.equipped);
  });
  const bonusSources = (target: BonusTarget): Source[] =>
    activeBonuses.filter((b) => b.target === target && !b.setMinimum).map((b) => ({ label: b.label, value: b.value }));

  // ----- ability scores -----
  const scoreSources: Record<Ability, Source[]> = Object.fromEntries(
    ABILITIES.map((a) => [a, [{ label: "Base score", value: build.baseAbilities[a] }]]),
  ) as Record<Ability, Source[]>;
  const bgInc = build.background.abilityIncreases;
  const bgValues = Object.values(bgInc).filter((v): v is number => (v ?? 0) > 0).sort();
  const bgValid =
    Object.keys(bgInc).every((a) => background.abilityOptions.includes(a as Ability)) &&
    (JSON.stringify(bgValues) === "[1,2]" || JSON.stringify(bgValues) === "[1,1,1]");
  if (!bgValid) {
    pending.push({
      kind: "background-abilities",
      message: `Choose your ${background.name} ability increases: +2 and +1, or +1 to all three of ${background.abilityOptions.map((a) => ABILITY_NAMES[a]).join(", ")}.`,
    });
  }
  // Increases apply in order of their cap: the usual maximum of 20 first, then capstones (25), then Epic Boons (30).
  const increases: { ability: Ability; label: string; value: number; cap: number }[] = [];
  for (const a of ABILITIES) {
    const v = bgInc[a] ?? 0;
    if (v) increases.push({ ability: a, label: `${background.name} background`, value: v, cap: 20 });
  }
  for (const feat of build.feats) {
    const def = content.feats.find((d) => d.id === feat.id);
    const cap = FEAT_ABILITY_INCREASE[feat.id]?.max ?? 20;
    for (const a of ABILITIES) {
      const v = feat.abilityIncreases?.[a] ?? 0;
      if (!v) continue;
      const label = feat.id === "ability-score-improvement" ? `Ability Score Improvement (level ${feat.source.split(":").pop()})` : def?.name ?? feat.id;
      increases.push({ ability: a, label, value: v, cap });
    }
  }
  for (const e of entries) {
    const cap = CAPSTONE_ABILITIES[e.id];
    if (cap && e.level >= 20) for (const a of cap.abilities) increases.push({ ability: a, label: cap.source, value: cap.amount, cap: cap.max });
  }
  increases.sort((x, y) => x.cap - y.cap);
  const scores = {} as Record<Ability, Sourced>;
  for (const a of ABILITIES) {
    const sources = scoreSources[a];
    let current = build.baseAbilities[a];
    for (const inc of increases.filter((i) => i.ability === a)) {
      const applied = Math.max(0, Math.min(inc.value, inc.cap - current));
      if (applied < inc.value) warnings.push(`${inc.label} raises ${ABILITY_NAMES[a]} by ${inc.value}, but only ${applied} counts: the maximum is ${inc.cap}.`);
      if (applied > 0 || inc.value > 0) sources.push({ label: applied < inc.value ? `${inc.label} (maximum ${inc.cap})` : inc.label, value: applied });
      current += applied;
    }
    for (const b of activeBonuses.filter((x) => x.target === `ability:${a}`)) {
      if (b.setMinimum) {
        if (b.value > current) {
          sources.push({ label: `${b.label} (score becomes ${b.value})`, value: b.value - current });
          current = b.value;
        }
      } else {
        const applied = Math.max(0, Math.min(b.value, 30 - current));
        sources.push({ label: applied < b.value ? `${b.label} (maximum 30)` : b.label, value: applied });
        current += applied;
      }
    }
    scores[a] = sum(sources);
  }
  const mods = Object.fromEntries(ABILITIES.map((a) => [a, abilityMod(scores[a].value)])) as Record<Ability, number>;

  // ----- saving throws -----
  const saveProf = new Set<Ability>(primaryClass?.savingThrows ?? []);
  const laterSaveSource = new Map<Ability, string>();
  for (const e of entries) {
    const later = laterSaveProficiencies(e.id, e.level);
    for (const a of later?.abilities ?? []) if (!saveProf.has(a)) {
      saveProf.add(a);
      laterSaveSource.set(a, later!.source);
    }
  }
  const paladin = entries.find((e) => e.id === "paladin");
  const aura = paladin && paladin.level >= 6 ? Math.max(1, mods.cha) : 0;
  const abilities = {} as DerivedSheet["abilities"];
  for (const a of ABILITIES) {
    const sources: Source[] = [{ label: `${ABILITY_NAMES[a]} modifier`, value: mods[a] }];
    if (saveProf.has(a)) sources.push({ label: laterSaveSource.has(a) ? `Proficiency (${laterSaveSource.get(a)})` : "Proficiency", value: proficiencyBonus });
    if (aura) sources.push({ label: "Aura of Protection (while conscious)", value: aura });
    sources.push(...bonusSources("saves"), ...bonusSources(`save:${a}`));
    abilities[a] = { score: scores[a], mod: mods[a], save: sum(sources), saveProficient: saveProf.has(a) };
  }

  // ----- skills -----
  const proficient = new Map<SkillId, string>();
  const addSkill = (s: SkillId, from: string) => {
    if (proficient.has(s)) warnings.push(`${SKILLS[s].name} is granted twice (${proficient.get(s)} and ${from}); pick a different skill for one of them.`);
    else proficient.set(s, from);
  };
  background.skills.forEach((s) => addSkill(s, `${background.name} background`));
  if (build.species.skill) addSkill(build.species.skill, species.name);
  for (const e of entries) e.skills.forEach((s) => addSkill(s, findClass(content, e.id).name));
  for (const f of build.feats) if (f.id === "skilled") (f.skills ?? []).forEach((s) => addSkill(s, "Skilled feat"));
  const expertise = new Set(entries.flatMap((e) => e.expertise));
  const bardLevel = entries.find((e) => e.id === "bard")?.level ?? 0;
  const jackOfAllTrades = bardLevel >= 2;
  const order = primary?.choices.divineOrder ?? primary?.choices.primalOrder ?? null;
  const wisBonus = Math.max(1, mods.wis);

  const skills = {} as DerivedSheet["skills"];
  for (const id of SKILL_IDS) {
    const ability = SKILLS[id].ability;
    const sources: Source[] = [{ label: `${ABILITY_NAMES[ability]} modifier`, value: mods[ability] }];
    let prof: ProficiencyLevel = "none";
    if (expertise.has(id) && proficient.has(id)) {
      prof = "expertise";
      sources.push({ label: "Expertise (double proficiency)", value: proficiencyBonus * 2 });
    } else if (proficient.has(id)) {
      prof = "proficient";
      sources.push({ label: `Proficiency (${proficient.get(id)})`, value: proficiencyBonus });
    } else if (jackOfAllTrades) {
      prof = "half";
      sources.push({ label: "Jack of All Trades", value: Math.floor(proficiencyBonus / 2) });
    }
    if (order === "thaumaturge" && (id === "arcana" || id === "religion")) sources.push({ label: "Thaumaturge", value: wisBonus });
    if (order === "magician" && (id === "arcana" || id === "nature")) sources.push({ label: "Magician", value: wisBonus });
    sources.push(...bonusSources(`skill:${id}`));
    skills[id] = { total: sum(sources), ability, proficiency: prof };
  }
  for (const s of expertise) if (!proficient.has(s)) warnings.push(`Expertise in ${SKILLS[s].name} needs proficiency in it first.`);

  // ----- class choices and pending picks -----
  for (const e of entries) {
    const cls = findClass(content, e.id);
    if (e.skills.length < cls.skills.choose) {
      pending.push({ kind: "class-skills", message: `Choose ${cls.skills.choose - e.skills.length} more ${cls.name} skill${cls.skills.choose - e.skills.length === 1 ? "" : "s"}.`, count: cls.skills.choose - e.skills.length, key: e.id });
    }
    const needExpertise = expertiseCount(e.id, e.level) - e.expertise.length;
    if (needExpertise > 0) pending.push({ kind: "expertise", message: `Choose ${needExpertise} skill${needExpertise === 1 ? "" : "s"} for Expertise.`, count: needExpertise, key: e.id });
    for (const choice of CLASS_CHOICES[e.id] ?? []) {
      if (e.level >= choice.level && !e.choices[choice.key]) pending.push({ kind: "class-choice", message: `Choose your ${choice.label}.`, key: choice.key, level: choice.level });
    }
    if (e.level >= 3 && !e.subclass) pending.push({ kind: "subclass", message: `Choose your ${cls.name} subclass.`, key: e.id, level: 3 });
    for (const choice of e.subclass ? SUBCLASS_CHOICES[e.subclass] ?? [] : []) {
      if (e.level >= choice.level && !e.choices[choice.key]) pending.push({ kind: "subclass-choice", message: `Choose your ${choice.label}.`, key: choice.key, level: choice.level });
    }
    const fsLevel = FIGHTING_STYLE_LEVEL[e.id];
    if (fsLevel !== undefined && e.level >= fsLevel && !build.feats.some((f) => f.source === `class:${e.id}:fighting-style`)) {
      pending.push({ kind: "fighting-style", message: "Choose a Fighting Style feat.", key: e.id, level: fsLevel });
    }
    const row = cls.progression[e.level - 1];
    const masteries = weaponMasteryCount(e.id, row?.columns ?? {});
    if (e.weaponMasteries.length < masteries) {
      pending.push({ kind: "weapon-mastery", message: `Choose ${masteries - e.weaponMasteries.length} more weapon${masteries - e.weaponMasteries.length === 1 ? "" : "s"} for Weapon Mastery.`, count: masteries - e.weaponMasteries.length, key: e.id });
    }
    for (const asiLevel of asiLevels(e.id).filter((l) => l <= e.level)) {
      const taken = build.feats.find((f) => f.source === `asi:${e.id}:${asiLevel}`);
      const unspent =
        taken?.id === "ability-score-improvement" &&
        Object.values(taken.abilityIncreases ?? {}).reduce((t, v) => t + (v ?? 0), 0) < 2;
      if (!taken || unspent) {
        pending.push({ kind: "asi", message: `Level ${asiLevel}: take an Ability Score Improvement or another feat.`, key: e.id, level: asiLevel });
      }
    }
    if (e.level >= EPIC_BOON_LEVEL) {
      const boon = build.feats.find((f) => f.source === `boon:${e.id}:${EPIC_BOON_LEVEL}`);
      const unspent = boon?.id === "ability-score-improvement" && Object.values(boon.abilityIncreases ?? {}).reduce((t, v) => t + (v ?? 0), 0) < 2;
      if (!boon || unspent) pending.push({ kind: "epic-boon", message: `Level ${EPIC_BOON_LEVEL}: choose an Epic Boon or another feat.`, key: e.id, level: EPIC_BOON_LEVEL });
    }
    const optionRule = classOptionRule(e.id, e.level, row?.columns ?? {});
    if (optionRule) {
      const list = cls.options.find((o) => o.id === optionRule.listId);
      const chosen = e.options ?? [];
      const gap = optionRule.count - chosen.length;
      if (gap > 0) pending.push({ kind: "class-options", message: `Choose ${gap} more ${optionRule.label === "Metamagic" ? "Metamagic option" : "Eldritch Invocation"}${gap === 1 ? "" : "s"}.`, count: gap, key: e.id });
      if (gap < 0) warnings.push(`You have ${chosen.length} ${optionRule.label}; the limit is ${optionRule.count}.`);
      for (const id of chosen) {
        const item = list?.items.find((i) => i.id === id);
        if (!item) continue;
        const need = optionLevelPrerequisite(item.text);
        if (need > e.level) warnings.push(`${item.name} needs ${cls.name} level ${need}.`);
        const requires = optionRequires(item.text);
        if (requires && !chosen.includes(requires)) warnings.push(`${item.name} needs the ${list!.items.find((i) => i.id === requires)?.name ?? requires} invocation.`);
      }
    }
    if (e.id === "warlock") {
      for (const [lvl, spellLevel] of Object.entries(MYSTIC_ARCANUM)) {
        if (e.level >= Number(lvl) && !character.spells.arcanum?.[String(spellLevel)]) {
          pending.push({ kind: "mystic-arcanum", message: `Choose a level ${spellLevel} spell for Mystic Arcanum.`, key: e.id, level: spellLevel });
        }
      }
    }
  }
  for (const f of build.feats) {
    const rule = FEAT_ABILITY_INCREASE[f.id];
    if (rule && !Object.values(f.abilityIncreases ?? {}).some((v) => (v ?? 0) > 0)) {
      pending.push({ kind: "feat-ability", message: `Choose which ability ${content.feats.find((d) => d.id === f.id)?.name ?? f.id} raises by 1.`, key: f.source });
    }
  }

  if (speciesChoice) {
    if (speciesChoice.options.length && !speciesOption) pending.push({ kind: "species-option", message: `Choose your ${speciesChoice.label}.` });
    if (speciesChoice.needsSpellAbility && !build.species.spellAbility) pending.push({ kind: "species-spell-ability", message: `Choose Intelligence, Wisdom or Charisma for your ${speciesChoice.label} spells.` });
    if (speciesChoice.skillChoice && !build.species.skill) pending.push({ kind: "species-skill", message: `Choose a skill from ${species.name}.` });
    if (speciesChoice.originFeat && !build.feats.some((f) => f.source === "species")) pending.push({ kind: "origin-feat", message: "Choose an Origin feat (Versatile)." });
  }
  for (const f of build.feats) {
    if (f.id === "magic-initiate" && (!f.magicInitiate || f.magicInitiate.cantrips.length < 2 || !f.magicInitiate.spell)) {
      pending.push({ kind: "magic-initiate", message: "Choose two cantrips and a level 1 spell for Magic Initiate.", key: f.source });
    }
    if (f.id === "skilled" && (f.skills?.length ?? 0) < 3) pending.push({ kind: "skilled", message: "Choose three skills for the Skilled feat.", key: f.source });
  }

  const warlockOptions = entries.find((e) => e.id === "warlock")?.options ?? [];

  // ----- hit points -----
  const hpSources: Source[] = [];
  const hitDice: DerivedSheet["hitDice"] = [];
  entries.forEach((e, idx) => {
    const cls = findClass(content, e.id);
    hitDice.push({ classId: e.id, die: cls.hitDie, total: e.level });
    for (let l = 1; l <= e.level; l++) {
      const first = idx === 0 && l === 1;
      const roll = first ? cls.hitDie : e.hitPointRolls[l - 2] ?? cls.hitDie / 2 + 1;
      hpSources.push({ label: first ? `${cls.name} level 1 (max d${cls.hitDie})` : `${cls.name} level ${l} (${e.hitPointRolls[l - 2] ? "rolled" : "average"} d${cls.hitDie})`, value: roll });
    }
  });
  if (mods.con !== 0) hpSources.push({ label: `Constitution modifier × ${level}`, value: mods.con * level });
  if (species.id === "dwarf") hpSources.push({ label: "Dwarven Toughness", value: level });
  const sorcerer = entries.find((e) => e.id === "sorcerer");
  if (sorcerer?.subclass === "draconic-sorcery" && sorcerer.level >= 3) hpSources.push({ label: "Draconic Resilience", value: sorcerer.level });
  hpSources.push(...bonusSources("hpMax"));
  const maxHp = sum(hpSources);
  if (maxHp.value < level) {
    maxHp.sources.push({ label: "Minimum 1 per level", value: level - maxHp.value });
    maxHp.value = level;
  }

  // ----- armor class -----
  const equipped = character.inventory.filter((i) => i.equipped && i.ref);
  const armorDefs = equipped
    .filter((i) => i.ref!.kind === "armor")
    .map((i) => content.armor.find((a) => a.id === i.ref!.id))
    .filter((a): a is ArmorDef => Boolean(a));
  const bodyArmor = armorDefs.find((a) => a.category !== "shield") ?? null;
  const shield = armorDefs.find((a) => a.category === "shield") ?? null;
  if (armorDefs.filter((a) => a.category !== "shield").length > 1) warnings.push("Only one suit of armor counts at a time; the first equipped one is used.");

  const armorTraining = { light: false, medium: false, heavy: false, shield: false };
  if (primaryClass) Object.assign(armorTraining, primaryClass.armor);
  if (order === "protector") armorTraining.heavy = true;
  if (order === "warden") armorTraining.medium = true;
  const trainedFor = (a: ArmorDef) => armorTraining[a.category];

  const acCandidates: Sourced[] = [];
  if (bodyArmor) {
    const s: Source[] = [{ label: bodyArmor.name, value: bodyArmor.baseAc }];
    if (bodyArmor.addDex) s.push({ label: bodyArmor.maxDex !== null ? `Dexterity modifier (max ${bodyArmor.maxDex})` : "Dexterity modifier", value: bodyArmor.maxDex !== null ? Math.min(mods.dex, bodyArmor.maxDex) : mods.dex });
    if (featIds.has("defense")) s.push({ label: "Defense fighting style", value: 1 });
    acCandidates.push(sum(s));
    if (!trainedFor(bodyArmor)) warnings.push(`You lack ${bodyArmor.category} armor training: Disadvantage on Strength and Dexterity D20 Tests, and you can't cast spells.`);
  } else {
    acCandidates.push(sum([{ label: "Unarmored", value: 10 }, { label: "Dexterity modifier", value: mods.dex }]));
    if (entries.some((e) => e.id === "barbarian")) {
      acCandidates.push(sum([{ label: "Unarmored Defense", value: 10 }, { label: "Dexterity modifier", value: mods.dex }, { label: "Constitution modifier", value: mods.con }]));
    }
    if (entries.some((e) => e.id === "monk") && !shield) {
      acCandidates.push(sum([{ label: "Unarmored Defense", value: 10 }, { label: "Dexterity modifier", value: mods.dex }, { label: "Wisdom modifier", value: mods.wis }]));
    }
    if (sorcerer?.subclass === "draconic-sorcery" && sorcerer.level >= 3) {
      acCandidates.push(sum([{ label: "Draconic Resilience", value: 10 }, { label: "Dexterity modifier", value: mods.dex }, { label: "Charisma modifier", value: mods.cha }]));
    }
    if (warlockOptions.includes("armor-of-shadows")) {
      acCandidates.push(sum([{ label: "Mage Armor (Armor of Shadows)", value: 13 }, { label: "Dexterity modifier", value: mods.dex }]));
    }
  }
  const ac = acCandidates.reduce((best, c) => (c.value > best.value ? c : best));
  if (shield) {
    if (armorTraining.shield) ac.sources = [...ac.sources, { label: "Shield", value: 2 }];
    else warnings.push("You lack Shield training, so the Shield gives no Armor Class.");
    ac.value = ac.sources.reduce((t, s) => t + s.value, 0);
  }
  const acBonus = bonusSources("ac");
  if (acBonus.length) {
    ac.sources = [...ac.sources, ...acBonus];
    ac.value = ac.sources.reduce((t, s) => t + s.value, 0);
  }

  // ----- initiative and speed -----
  const initSources: Source[] = [{ label: "Dexterity modifier", value: mods.dex }];
  if (featIds.has("alert")) initSources.push({ label: "Alert feat", value: proficiencyBonus });
  else if (jackOfAllTrades) initSources.push({ label: "Jack of All Trades", value: Math.floor(proficiencyBonus / 2) });
  initSources.push(...bonusSources("initiative"));
  const fighter = entries.find((e) => e.id === "fighter");
  const initiativeAdvantage = fighter?.subclass === "champion" && fighter.level >= 3;

  const speedSources: Source[] = [{ label: speciesOption?.speed ? speciesOption.name : species.name, value: speciesOption?.speed ?? species.speed }];
  const monk = entries.find((e) => e.id === "monk");
  if (monk && !bodyArmor && !shield) {
    const bonus = Number.parseInt(findClass(content, "monk").progression[monk.level - 1]?.columns["Unarmored Movement"] ?? "", 10);
    if (bonus > 0) speedSources.push({ label: "Unarmored Movement", value: bonus });
  }
  const barbarian = entries.find((e) => e.id === "barbarian");
  if (barbarian && barbarian.level >= 5 && bodyArmor?.category !== "heavy") speedSources.push({ label: "Fast Movement", value: 10 });
  if (bodyArmor?.strength && scores.str.value < bodyArmor.strength) speedSources.push({ label: `${bodyArmor.name} needs Strength ${bodyArmor.strength}`, value: -10 });
  speedSources.push(...bonusSources("speed"));

  // ----- attacks -----
  const attacks: Attack[] = [];
  const masteries = new Set(entries.flatMap((e) => e.weaponMasteries));
  const rageEntry = barbarian ? findClass(content, "barbarian").progression[barbarian.level - 1] : undefined;
  const rogue = entries.find((e) => e.id === "rogue");
  const sneak = rogue ? findClass(content, "rogue").progression[rogue.level - 1]?.columns["Sneak Attack"] : undefined;
  const martialArtsDie = monk ? findClass(content, "monk").progression[monk.level - 1]?.columns["Martial Arts"] ?? "1d6" : null;
  const critRange = fighter?.subclass === "champion" ? championCritRange(fighter.level) : 20;
  let attacksPerActionValue: DerivedSheet["attacksPerAction"] = { count: 1, source: null };
  for (const e of entries) {
    const extra = attacksPerAction(e.id, e.level);
    if (extra && extra.count > attacksPerActionValue.count) attacksPerActionValue = extra;
  }
  if (warlockOptions.includes("thirsting-blade") && attacksPerActionValue.count < 2) attacksPerActionValue = { count: 2, source: "Thirsting Blade, pact weapon only" };
  const radiantStrikes = Boolean(paladin && paladin.level >= 11);

  const weaponItems = character.inventory.filter((i) => i.equipped && i.ref?.kind === "weapon");
  for (const item of weaponItems) {
    const weapon = content.weapons.find((w) => w.id === item.ref!.id);
    if (!weapon) continue;
    const isMonkWeapon = Boolean(monk) && weapon.kind === "melee" && (weapon.category === "simple" || weapon.properties.includes("light"));
    let ability: Ability = weapon.kind === "ranged" ? "dex" : "str";
    if (weapon.properties.includes("finesse") || isMonkWeapon) ability = mods.dex > mods.str ? "dex" : "str";
    const prof = primaryClass ? weaponProficient(weapon, primaryClass, primary!.choices) : false;
    const toHit: Source[] = [{ label: `${ABILITY_NAMES[ability]} modifier`, value: mods[ability] }];
    if (prof) toHit.push({ label: "Proficiency", value: proficiencyBonus });
    if (featIds.has("archery") && weapon.kind === "ranged") toHit.push({ label: "Archery fighting style", value: 2 });
    toHit.push(...bonusSources("attack"));
    let die = weapon.damage;
    if (isMonkWeapon && martialArtsDie && dieSize(martialArtsDie) > dieSize(weapon.damage)) die = martialArtsDie;
    const notes: string[] = [];
    if (!prof) notes.push("Not proficient: no Proficiency Bonus to hit.");
    if (critRange < 20) notes.push(`Critical hit on ${critRange}–20 (${critRange <= 18 ? "Superior Critical" : "Improved Critical"}).`);
    if (radiantStrikes && weapon.kind === "melee") notes.push("Radiant Strikes: +1d8 Radiant damage on a hit.");
    if (warlockOptions.includes("pact-of-the-blade") && mods.cha > mods[ability]) notes.push(`As your pact weapon, it can use Charisma: ${formatSigned(mods.cha + (prof ? proficiencyBonus : 0))} to hit.`);
    if (rageEntry && ability === "str") notes.push(`While raging: ${rageEntry.columns["Rage Damage"]} damage.`);
    if (sneak && (weapon.properties.includes("finesse") || weapon.kind === "ranged")) notes.push(`Sneak Attack: +${sneak} once per turn.`);
    if (featIds.has("great-weapon-fighting") && weapon.kind === "melee" && (weapon.properties.includes("two-handed") || weapon.properties.includes("versatile"))) {
      notes.push("Great Weapon Fighting: treat 1s and 2s on damage dice as 3s when wielded with two hands.");
    }
    const dmgMod = mods[ability];
    attacks.push({
      id: item.id,
      name: item.name,
      toHit: sum(toHit),
      damage: withMod(die, dmgMod),
      damageType: weapon.damageType ?? "",
      versatileDamage: weapon.versatileDamage ? withMod(weapon.versatileDamage, dmgMod) : null,
      range: weapon.range ? `${weapon.range.normal}/${weapon.range.long} ft.` : weapon.properties.includes("reach") ? "10 ft." : "5 ft.",
      properties: weapon.propertiesText,
      mastery: masteries.has(weapon.id) ? weapon.mastery : null,
      proficient: prof,
      notes,
    });
  }
  // Unarmed Strike: everyone has it.
  {
    const ability: Ability = monk && mods.dex > mods.str ? "dex" : "str";
    const notes: string[] = [];
    if (rageEntry && ability === "str") notes.push(`While raging: ${rageEntry.columns["Rage Damage"]} damage.`);
    attacks.push({
      id: "unarmed-strike",
      name: "Unarmed Strike",
      toHit: sum([{ label: `${ABILITY_NAMES[ability]} modifier`, value: mods[ability] }, { label: "Proficiency", value: proficiencyBonus }, ...bonusSources("attack")]),
      damage: martialArtsDie ? withMod(martialArtsDie, mods[ability]) : `${Math.max(0, 1 + mods[ability])}`,
      damageType: "bludgeoning",
      versatileDamage: null,
      range: "5 ft.",
      properties: martialArtsDie ? "Martial Arts" : "",
      mastery: null,
      proficient: true,
      notes,
    });
  }

  // ----- spellcasting -----
  let spellcasting: SpellcastingInfo | null = null;
  const caster = entries.find((e) => SPELLCASTING_ABILITY[e.id]);
  if (caster) {
    const cls = findClass(content, caster.id);
    const row = cls.progression[caster.level - 1]!;
    const ability = SPELLCASTING_ABILITY[caster.id]!;
    const slots = row.spellSlots ? [...row.spellSlots] : [];
    const pactCount = Number.parseInt(row.columns["Spell Slots"] ?? "", 10);
    const pact = caster.id === "warlock" && pactCount > 0 ? { count: pactCount, level: Number.parseInt(row.columns["Slot Level"] ?? "1", 10) } : null;
    const maxSpellLevel = pact ? pact.level : slots.reduce((m, n, i) => (n > 0 ? i + 1 : m), 0);
    const extraCantrip = order === "thaumaturge" || order === "magician" ? 1 : 0;
    const list: Record<number, string[]> = {};
    for (let l = 0; l <= maxSpellLevel; l++) list[l] = cls.spellList[String(l)] ?? [];
    spellcasting = {
      classId: caster.id,
      ability,
      saveDc: sum([{ label: "Base", value: 8 }, { label: `${ABILITY_NAMES[ability]} modifier`, value: mods[ability] }, { label: "Proficiency", value: proficiencyBonus }, ...bonusSources("spellDc")]),
      attack: sum([{ label: `${ABILITY_NAMES[ability]} modifier`, value: mods[ability] }, { label: "Proficiency", value: proficiencyBonus }, ...bonusSources("spellAttack")]),
      cantripLimit: (Number.parseInt(row.columns["Cantrips"] ?? "0", 10) || 0) + extraCantrip,
      preparedLimit: Number.parseInt(row.columns["Prepared Spells"] ?? "0", 10) || 0,
      slots,
      pact,
      maxSpellLevel,
      list,
    };
    const cantripGap = spellcasting.cantripLimit - character.spells.cantrips.length;
    if (cantripGap > 0) pending.push({ kind: "cantrips", message: `Choose ${cantripGap} more cantrip${cantripGap === 1 ? "" : "s"}.`, count: cantripGap });
    const preparedGap = spellcasting.preparedLimit - character.spells.prepared.length;
    if (preparedGap > 0) pending.push({ kind: "prepared", message: `Prepare ${preparedGap} more spell${preparedGap === 1 ? "" : "s"}.`, count: preparedGap });
    if (character.spells.cantrips.length > spellcasting.cantripLimit) warnings.push(`You know ${character.spells.cantrips.length} cantrips; the limit is ${spellcasting.cantripLimit}.`);
    if (character.spells.prepared.length > spellcasting.preparedLimit) warnings.push(`You have ${character.spells.prepared.length} spells prepared; the limit is ${spellcasting.preparedLimit}.`);
    if (bodyArmor && !trainedFor(bodyArmor)) warnings.push("You can't cast spells while wearing armor you lack training with.");
  }

  // ----- homebrew attacks -----
  for (const h of homebrew.attacks) {
    const ability: Ability | null = h.ability === "none" ? null : h.ability === "spell" ? spellcasting?.ability ?? null : h.ability;
    if (h.ability === "spell" && !spellcasting) warnings.push(`${h.name} uses your spellcasting ability, but you don't have the Spellcasting feature; no ability modifier is added.`);
    const toHit: Source[] = [];
    if (ability) toHit.push({ label: `${ABILITY_NAMES[ability]} modifier`, value: mods[ability] });
    if (h.proficient) toHit.push({ label: "Proficiency", value: proficiencyBonus });
    if (h.toHitBonus) toHit.push({ label: "Bonus", value: h.toHitBonus });
    toHit.push(...bonusSources(h.ability === "spell" ? "spellAttack" : "attack"));
    let damage = h.damage.trim();
    try {
      parseDice(damage);
    } catch (e) {
      if (!(e instanceof DiceSyntaxError)) throw e;
      warnings.push(`${h.name}: "${damage}" isn't a dice roll Mimic Box can read, such as 1d8 or 2d6+1.`);
      damage = "0";
    }
    attacks.push({
      id: `custom:${h.id}`,
      name: h.name,
      toHit: sum(toHit),
      damage: h.addModifier && ability ? withMod(damage, mods[ability]) : damage,
      damageType: h.damageType,
      versatileDamage: null,
      range: h.range,
      properties: "Homebrew",
      mastery: null,
      proficient: h.proficient,
      notes: h.notes ? [h.notes] : [],
    });
  }

  // ----- granted spells -----
  const grantedSpells: GrantedSpell[] = [];
  const grant = (id: string, source: string, freeCast: boolean, cantrip: boolean) => {
    if (!grantedSpells.some((g) => g.id === id)) grantedSpells.push({ id, source, freeCast, cantrip });
  };
  if (speciesOption) {
    speciesOption.cantrips?.forEach((c) => grant(c, `${species.name}: ${speciesOption.name}`, false, true));
    for (const [lvl, spell] of Object.entries(speciesOption.spells ?? {})) if (level >= Number(lvl)) grant(spell, `${species.name}: ${speciesOption.name}`, true, false);
  }
  for (const e of entries) {
    if (e.id === "druid") grant("speak-with-animals", "Druidic", false, false);
    if (e.id === "ranger") grant("hunters-mark", "Favored Enemy", false, false);
    const sub = e.subclass ? findClass(content, e.id).subclasses.find((s) => s.id === e.subclass) : null;
    for (const f of sub?.features ?? []) {
      if (!/Spells$/.test(f.name) || f.level > e.level) continue;
      const table = subclassSpellTable(f.text, e.choices.landType ?? null);
      for (const [lvl, ids] of Object.entries(table)) if (e.level >= Number(lvl)) ids.forEach((id) => grant(id, `${sub!.name}`, false, false));
    }
  }
  for (const [spellLevel, id] of Object.entries(character.spells.arcanum ?? {})) {
    if (id) grant(id, `Mystic Arcanum (level ${spellLevel})`, true, false);
  }
  for (const f of build.feats) {
    if (f.id === "magic-initiate" && f.magicInitiate) {
      f.magicInitiate.cantrips.forEach((c) => grant(c, "Magic Initiate", false, true));
      if (f.magicInitiate.spell) grant(f.magicInitiate.spell, "Magic Initiate", true, false);
    }
  }

  // ----- resources -----
  const resources: ResourceDef[] = [];
  for (const e of entries) {
    const row = findClass(content, e.id).progression[e.level - 1];
    resources.push(...classResources(e.id, e.level, row?.columns ?? {}, mods, proficiencyBonus));
  }
  resources.push(...speciesResources(species.id, level, proficiencyBonus));
  for (const g of grantedSpells.filter((g) => g.freeCast)) {
    const spellName = content.spells?.find((x) => x.id === g.id)?.name ?? g.id.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
    resources.push({ id: `free-cast:${g.id}`, name: `Free cast: ${spellName}`, max: species.id === "gnome" && g.id === "speak-with-animals" ? proficiencyBonus : 1, reset: "long", source: g.source });
  }

  for (const f of homebrew.features) {
    if (f.uses && f.uses.max > 0) resources.push({ id: `custom:${f.id}`, name: f.name, max: f.uses.max, reset: f.uses.reset, source: `${f.kind}: ${f.name}` });
  }

  // ----- features -----
  const features: FeatureEntry[] = [];
  for (const e of entries) {
    const cls = findClass(content, e.id);
    features.push(...featuresFrom(cls, e.level));
    const sub = cls.subclasses.find((s) => s.id === e.subclass);
    if (sub) features.push(...sub.features.filter((f) => f.level <= e.level).map((f) => ({ source: sub.name, name: f.name, level: f.level, text: f.text })));
    for (const id of e.options ?? []) {
      for (const list of cls.options) {
        const item = list.items.find((i) => i.id === id);
        if (item) features.push({ source: list.name.replace(/ Options$/, ""), name: item.name, level: null, text: item.text });
      }
    }
  }
  for (const t of species.traits) features.push({ source: species.name, name: t.name, level: null, text: t.text });
  for (const f of homebrew.features) features.push({ source: f.kind || "Homebrew", name: f.name, level: null, text: f.text });
  for (const f of build.feats) {
    const def = content.feats.find((d) => d.id === f.id);
    if (def) features.push({ source: f.source === "background" ? `${background.name} background` : def.category === "epic-boon" ? "Epic Boon" : "Feat", name: def.name, level: null, text: def.text });
  }

  // ----- proficiencies, resistances -----
  const armorList = Object.entries(armorTraining).filter(([, v]) => v).map(([k]) => (k === "shield" ? "Shields" : `${k[0]!.toUpperCase()}${k.slice(1)} armor`));
  let weaponsText = primaryClass?.weaponText ?? "";
  if (order === "protector" || order === "warden") weaponsText = `${weaponsText}; Martial weapons (${order === "protector" ? "Protector" : "Warden"})`;
  const toolList = [background.tool, primaryClass?.toolText ?? null, build.toolNotes || null].filter(Boolean).join("; ");
  const affinity = sorcerer?.subclass === "draconic-sorcery" && sorcerer.level >= 6 ? sorcerer.choices.elementalAffinity : undefined;
  const resistances = [...new Set([SPECIES_RESISTANCE[species.id], speciesOption?.resistance, affinity].filter((r): r is string => Boolean(r)))];

  const classSummary = entries
    .map((e) => {
      const cls = findClass(content, e.id);
      const sub = cls.subclasses.find((s) => s.id === e.subclass);
      return `${cls.name} ${e.level}${sub ? ` (${sub.name})` : ""}`;
    })
    .join(" / ");

  return {
    level,
    proficiencyBonus,
    classSummary,
    speciesName: speciesOption ? `${species.name} (${speciesOption.name})` : species.name,
    backgroundName: background.name,
    abilities,
    skills,
    passive: {
      perception: 10 + skills.perception.total.value,
      insight: 10 + skills.insight.total.value,
      investigation: 10 + skills.investigation.total.value,
    },
    ac,
    attacksPerAction: attacksPerActionValue,
    initiative: sum(initSources),
    initiativeAdvantage,
    speed: sum(speedSources),
    hp: { max: maxHp, current: Math.min(state.hp, maxHp.value), temp: state.tempHp },
    hitDice,
    hitDiceAvailable: Math.max(0, level - state.hitDiceSpent),
    attacks,
    spellcasting,
    grantedSpells,
    resources,
    features,
    proficiencies: { armor: armorList.join(", ") || "None", weapons: weaponsText || "None", tools: toolList || "None", languages: build.languages || "Common" },
    resistances,
    darkvision: speciesOption?.darkvision ?? species.darkvision,
    size: build.species.size === "small" ? "Small" : "Medium",
    pending,
    warnings,
  };
}

function dieSize(notation: string): number {
  const m = /d(\d+)/.exec(notation);
  return m ? Number(m[1]) : 0;
}

function withMod(die: string, mod: number): string {
  if (mod === 0) return die;
  return `${die}${mod > 0 ? "+" : "-"}${Math.abs(mod)}`;
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}
