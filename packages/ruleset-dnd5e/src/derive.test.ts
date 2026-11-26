/**
 * Reference characters. Every expected number is worked out by hand from SRD 5.2.1 and written in the comments,
 * so a failing test says which rule the engine got wrong.
 */
import { describe, expect, it } from "vitest";
import {
  applyDamage,
  createCharacter,
  derive,
  exportCharacter,
  grantEquipment,
  heal,
  importCharacter,
  levelUp,
  longRest,
  shortRest,
  srdContent as content,
  type AbilityScores,
  type Character,
} from "./index.js";

const scores = (str: number, dex: number, con: number, int: number, wis: number, cha: number): AbilityScores => ({ str, dex, con, int, wis, cha });

function build(
  input: { classId: string; speciesId: string; backgroundId: string; base: AbilityScores },
  edit: (c: Character) => Character = (c) => c,
): Character {
  const c = createCharacter(content, { name: "Test", classId: input.classId, speciesId: input.speciesId, backgroundId: input.backgroundId, baseAbilities: input.base });
  return edit(c);
}

const withClass = (c: Character, patch: Partial<Character["build"]["classes"][number]>): Character => ({
  ...c,
  build: { ...c.build, classes: [{ ...c.build.classes[0]!, ...patch }] },
});

function equip(c: Character, ...names: string[]): Character {
  return grantEquipment(c, content, names.map((name) => ({ name, quantity: 1 })), 0);
}

describe("Wood Elf Rogue 1 (Criminal)", () => {
  // Point buy 8/15/14/10/13/12; Criminal +2 Dex +1 Con -> Dex 17 (+3), Con 15 (+2).
  let c = build({ classId: "rogue", speciesId: "elf", backgroundId: "criminal", base: scores(8, 15, 14, 10, 13, 12) });
  c = { ...c, build: { ...c.build, background: { id: "criminal", abilityIncreases: { dex: 2, con: 1 } }, species: { ...c.build.species, option: "wood-elf", spellAbility: "wis", skill: "survival" } } };
  c = withClass(c, { skills: ["perception", "acrobatics", "investigation", "insight"], expertise: ["stealth", "sleightOfHand"], weaponMasteries: ["shortsword", "shortbow"] });
  c = equip(c, "Leather Armor", "Shortsword", "Shortbow");
  const s = derive(c, content);

  it("computes ability scores and saves", () => {
    expect(s.abilities.dex.score.value).toBe(17);
    expect(s.abilities.con.score.value).toBe(15);
    expect(s.abilities.dex.save.value).toBe(5); // +3 Dex, +2 proficiency
    expect(s.abilities.int.save.value).toBe(2); // +0 Int, +2 proficiency
    expect(s.abilities.str.save.value).toBe(-1);
  });

  it("computes HP, AC, initiative and speed", () => {
    expect(s.hp.max.value).toBe(10); // d8 max 8 + Con 2
    expect(s.ac.value).toBe(14); // Leather 11 + Dex 3
    expect(s.initiative.value).toBe(5); // Dex 3 + Alert (PB 2)
    expect(s.speed.value).toBe(35); // Wood Elf
    expect(s.darkvision).toBe(60);
  });

  it("applies proficiency and expertise to skills", () => {
    expect(s.skills.stealth.total.value).toBe(7); // Dex 3 + expertise 4
    expect(s.skills.sleightOfHand.total.value).toBe(7);
    expect(s.skills.perception.total.value).toBe(3); // Wis 1 + 2
    expect(s.skills.survival.proficiency).toBe("proficient"); // Keen Senses
    expect(s.skills.athletics.total.value).toBe(-1);
    expect(s.passive.perception).toBe(13);
  });

  it("builds weapon attacks with Sneak Attack notes and masteries", () => {
    const sword = s.attacks.find((a) => a.name === "Shortsword")!;
    expect(sword.toHit.value).toBe(5);
    expect(sword.damage).toBe("1d6+3");
    expect(sword.mastery).toBe("Vex");
    expect(sword.notes.join(" ")).toContain("Sneak Attack: +1d6");
    const bow = s.attacks.find((a) => a.name === "Shortbow")!;
    expect(bow.toHit.value).toBe(5);
    expect(bow.range).toBe("80/320 ft.");
  });

  it("grants Druidcraft and has no pending choices", () => {
    expect(s.grantedSpells.map((g) => g.id)).toContain("druidcraft");
    expect(s.pending).toEqual([]);
    expect(s.warnings).toEqual([]);
  });

  it("warns when a class skill duplicates a background skill", () => {
    const dup = withClass(c, { skills: ["stealth", "acrobatics", "investigation", "insight"] });
    expect(derive(dup, content).warnings.join(" ")).toMatch(/Stealth is granted twice/);
  });
});

describe("Dwarf Fighter 1 (Soldier) in Chain Mail", () => {
  // Standard array 15/14/13/12/10/8; Soldier +2 Str +1 Con -> Str 17 (+3), Con 14 (+2), Dex 14 (+2).
  let c = build({ classId: "fighter", speciesId: "dwarf", backgroundId: "soldier", base: scores(15, 14, 13, 12, 10, 8) });
  c = { ...c, build: { ...c.build, background: { id: "soldier", abilityIncreases: { str: 2, con: 1 } } } };
  c = withClass(c, { skills: ["perception", "history"], weaponMasteries: ["greatsword", "flail", "javelin"] });
  c = { ...c, build: { ...c.build, feats: [...c.build.feats, { id: "defense", source: "class:fighter:fighting-style" }] } };
  c = equip(c, "Chain Mail", "Greatsword");
  const s = derive(c, content);

  it("adds Dwarven Toughness to HP", () => {
    expect(s.hp.max.value).toBe(13); // d10 max 10 + Con 2 + Dwarven Toughness 1
  });
  it("uses heavy armor with the Defense fighting style", () => {
    expect(s.ac.value).toBe(17); // Chain Mail 16 + Defense 1 (no Dex)
    expect(s.speed.value).toBe(30); // Str 17 meets Chain Mail's 13
  });
  it("attacks with a greatsword", () => {
    const g = s.attacks.find((a) => a.name === "Greatsword")!;
    expect(g.toHit.value).toBe(5); // Str 3 + PB 2
    expect(g.damage).toBe("2d6+3");
    expect(g.mastery).toBe("Graze");
  });
  it("has Second Wind and Poison resistance, and nothing left to choose", () => {
    expect(s.resources.find((r) => r.id === "second-wind")?.max).toBe(2);
    expect(s.resistances).toEqual(["poison"]);
    expect(s.pending).toEqual([]);
  });
  it("loses 10 ft. of speed when too weak for the armor", () => {
    const weak = { ...c, build: { ...c.build, baseAbilities: scores(10, 14, 13, 12, 10, 8), background: { id: "soldier", abilityIncreases: { dex: 2, con: 1 } } } };
    expect(derive(weak, content).speed.value).toBe(20);
  });
});

describe("High Elf Wizard 1 (Sage)", () => {
  // Base 8/14/14/15/12/10; Sage +2 Int +1 Con -> Int 17 (+3), Con 15 (+2).
  let c = build({ classId: "wizard", speciesId: "elf", backgroundId: "sage", base: scores(8, 14, 14, 15, 12, 10) });
  c = { ...c, build: { ...c.build, background: { id: "sage", abilityIncreases: { int: 2, con: 1 } }, species: { ...c.build.species, option: "high-elf", spellAbility: "int", skill: "perception" } } };
  c = withClass(c, { skills: ["arcana", "investigation"] });
  const s = derive(c, content);

  it("computes spellcasting numbers and slots", () => {
    expect(s.spellcasting?.ability).toBe("int");
    expect(s.spellcasting?.saveDc.value).toBe(13); // 8 + 3 + 2
    expect(s.spellcasting?.attack.value).toBe(5);
    expect(s.spellcasting?.slots[0]).toBe(2);
    expect(s.spellcasting?.cantripLimit).toBe(3);
    expect(s.spellcasting?.preparedLimit).toBe(4);
    expect(s.spellcasting?.maxSpellLevel).toBe(1);
  });
  it("unarmored AC and HP", () => {
    expect(s.ac.value).toBe(12); // 10 + Dex 2
    expect(s.hp.max.value).toBe(8); // d6 max 6 + Con 2
  });
  it("asks for cantrips, prepared spells and the Sage's Magic Initiate picks", () => {
    const kinds = s.pending.map((p) => p.kind);
    expect(kinds).toContain("cantrips");
    expect(kinds).toContain("prepared");
    expect(kinds).toContain("magic-initiate");
  });
  it("Arcana and History overlap is flagged (Sage gives both)", () => {
    expect(s.warnings.join(" ")).toMatch(/Arcana is granted twice/);
  });
});

describe("Human Monk 3 (Warrior of the Open Hand), unarmored", () => {
  // Base 10/15/14/8/15/10, Acolyte? No: Criminal +2 Dex +1 Con -> Dex 17 (+3), Con 15 (+2), Wis 15 (+2).
  let c = build({ classId: "monk", speciesId: "human", backgroundId: "criminal", base: scores(10, 15, 14, 8, 15, 10) });
  c = { ...c, build: { ...c.build, background: { id: "criminal", abilityIncreases: { dex: 2, con: 1 } }, species: { ...c.build.species, skill: "athletics" } } };
  c = withClass(c, { level: 3, subclass: "warrior-of-the-open-hand", skills: ["acrobatics", "insight"] });
  c = { ...c, build: { ...c.build, feats: [...c.build.feats, { id: "skilled", source: "species", skills: ["perception", "history", "religion"] }] } };
  c = equip(c, "Spear");
  const s = derive(c, content);

  it("uses Unarmored Defense and Unarmored Movement", () => {
    expect(s.ac.value).toBe(15); // 10 + Dex 3 + Wis 2
    expect(s.speed.value).toBe(40); // 30 + 10
  });
  it("averages HP after level 1", () => {
    expect(s.hp.max.value).toBe(24); // 8 + 5 + 5 (average d8) + Con 2 x 3
  });
  it("uses Dexterity and the Martial Arts die for Monk weapons and unarmed strikes", () => {
    const spear = s.attacks.find((a) => a.name === "Spear")!;
    expect(spear.toHit.value).toBe(5); // Dex 3 + PB 2
    expect(spear.damage).toBe("1d6+3");
    const fist = s.attacks.find((a) => a.id === "unarmed-strike")!;
    expect(fist.damage).toBe("1d6+3");
  });
  it("has Focus Points equal to the table", () => {
    expect(s.resources.find((r) => r.id === "focus")?.max).toBe(3);
  });
});

describe("Goliath Barbarian 5 (Path of the Berserker)", () => {
  // Base 15/13/14/8/12/10; Soldier +2 Str +1 Con -> Str 17 (+3), Con 15 (+2), Dex 13 (+1).
  let c = build({ classId: "barbarian", speciesId: "goliath", backgroundId: "soldier", base: scores(15, 13, 14, 8, 12, 10) });
  c = { ...c, build: { ...c.build, background: { id: "soldier", abilityIncreases: { str: 2, con: 1 } }, species: { ...c.build.species, option: "stone" } } };
  c = withClass(c, { level: 5, subclass: "path-of-the-berserker", skills: ["perception", "survival"], weaponMasteries: ["greataxe", "handaxe"] });
  c = { ...c, build: { ...c.build, feats: [...c.build.feats, { id: "ability-score-improvement", source: "asi:barbarian:4", abilityIncreases: { str: 1, con: 1 } }] } };
  c = equip(c, "Greataxe");
  const s = derive(c, content);

  it("applies the level 4 ASI", () => {
    expect(s.abilities.str.score.value).toBe(18);
    expect(s.abilities.con.score.value).toBe(16);
  });
  it("Unarmored Defense, Fast Movement, HP", () => {
    expect(s.ac.value).toBe(14); // 10 + Dex 1 + Con 3
    expect(s.speed.value).toBe(45); // Goliath 35 + Fast Movement 10
    expect(s.hp.max.value).toBe(55); // 12 + 7 x 4 + Con 3 x 5
    expect(s.proficiencyBonus).toBe(3);
  });
  it("Rage uses and greataxe attack", () => {
    expect(s.resources.find((r) => r.id === "rage")?.max).toBe(3);
    const axe = s.attacks.find((a) => a.name === "Greataxe")!;
    expect(axe.toHit.value).toBe(7); // Str 4 + PB 3
    expect(axe.damage).toBe("1d12+4");
    expect(axe.notes.join(" ")).toContain("While raging: +2 damage");
  });
  it("has Large Form at level 5", () => {
    expect(s.resources.map((r) => r.id)).toContain("large-form");
  });
});

describe("Life Domain Cleric 3 (Acolyte), Thaumaturge", () => {
  // Base 14/10/14/8/15/12; Acolyte +2 Wis +1 Cha -> Wis 17 (+3), Cha 13.
  let c = build({ classId: "cleric", speciesId: "dwarf", backgroundId: "acolyte", base: scores(14, 10, 14, 8, 15, 12) });
  c = { ...c, build: { ...c.build, background: { id: "acolyte", abilityIncreases: { wis: 2, cha: 1 } } } };
  c = withClass(c, { level: 3, subclass: "life-domain", skills: ["medicine", "history"], choices: { divineOrder: "thaumaturge" } });
  const s = derive(c, content);

  it("has Life Domain spells always prepared", () => {
    const ids = s.grantedSpells.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(["aid", "bless", "cure-wounds", "lesser-restoration"]));
    expect(ids).not.toContain("revivify"); // level 5
  });
  it("adds the Thaumaturge cantrip and skill bonus", () => {
    expect(s.spellcasting?.cantripLimit).toBe(4); // 3 + 1
    expect(s.skills.religion.total.value).toBe(4); // Int -1 + PB 2 + Wis 3 (Religion from Acolyte)
    expect(s.spellcasting?.slots.slice(0, 2)).toEqual([4, 2]);
    expect(s.spellcasting?.saveDc.value).toBe(13); // 8 + 3 + 2
  });
});

describe("Draconic Sorcerer 3 and Fiend Warlock 3", () => {
  it("adds Draconic Resilience to HP and AC", () => {
    // Base 8/14/14/10/12/15; Acolyte +2 Cha +1 Int -> Cha 17 (+3), Dex 14 (+2), Con 14 (+2).
    let c = build({ classId: "sorcerer", speciesId: "human", backgroundId: "acolyte", base: scores(8, 14, 14, 10, 12, 15) });
    c = { ...c, build: { ...c.build, background: { id: "acolyte", abilityIncreases: { cha: 2, int: 1 } } } };
    c = withClass(c, { level: 3, subclass: "draconic-sorcery", skills: ["arcana", "deception"] });
    const s = derive(c, content);
    expect(s.hp.max.value).toBe(23); // 6 + 4 + 4 (average d6) + Con 2 x 3 + Draconic Resilience 3
    expect(s.ac.value).toBe(15); // 10 + Dex 2 + Cha 3, no armor
  });

  it("uses Pact Magic slots for a Warlock", () => {
    let c = build({ classId: "warlock", speciesId: "tiefling", backgroundId: "sage", base: scores(8, 14, 14, 12, 10, 15) });
    c = withClass(c, { level: 3, subclass: "fiend-patron" });
    const s = derive(c, content);
    expect(s.spellcasting?.pact).toEqual({ count: 2, level: 2 });
    expect(s.spellcasting?.maxSpellLevel).toBe(2);
    expect(s.grantedSpells.map((g) => g.id)).toEqual(expect.arrayContaining(["burning-hands", "command", "scorching-ray", "suggestion"]));
  });
});

describe("play state", () => {
  let c = build({ classId: "fighter", speciesId: "human", backgroundId: "soldier", base: scores(15, 14, 13, 12, 10, 8) });
  c = { ...c, build: { ...c.build, background: { id: "soldier", abilityIncreases: { str: 2, con: 1 } } } };
  c = longRest(c, content);

  it("spends temporary HP first, then HP, and never goes below 0", () => {
    const max = derive(c, content).hp.max.value; // 10 + Con 2 = 12
    expect(max).toBe(12);
    let d = { ...c, state: { ...c.state, tempHp: 5 } };
    d = applyDamage(d, content, 8);
    expect(d.state.tempHp).toBe(0);
    expect(d.state.hp).toBe(9);
    d = applyDamage(d, content, 50);
    expect(d.state.hp).toBe(0);
    d = heal(d, content, 100);
    expect(d.state.hp).toBe(12);
  });

  it("levels up with the average and raises current HP by the same amount", () => {
    const hurt = applyDamage(c, content, 4); // 8 / 12
    const up = levelUp(hurt, content, { classId: "fighter" });
    expect(derive(up, content).hp.max.value).toBe(20); // 12 + 6 (avg d10) + 2
    expect(up.state.hp).toBe(16);
  });

  it("short rest spends hit dice and recovers one Second Wind; long rest resets everything", () => {
    let d = applyDamage(c, content, 10); // 2 / 12
    d = { ...d, state: { ...d.state, resourcesSpent: { "second-wind": 2 } } };
    d = shortRest(d, content, [6]); // 6 + Con 2 = 8
    expect(d.state.hp).toBe(10);
    expect(d.state.hitDiceSpent).toBe(1);
    expect(d.state.resourcesSpent["second-wind"]).toBe(1);
    d = longRest(d, content);
    expect(d.state.hp).toBe(12);
    expect(d.state.hitDiceSpent).toBe(0);
    expect(d.state.resourcesSpent).toEqual({});
    expect(d.state.heroicInspiration).toBe(true); // Human: Resourceful
  });

  it("round-trips through export and import", () => {
    const file = JSON.parse(JSON.stringify(exportCharacter(c, content)));
    expect(file.attribution).toContain("SRD 5.2.1");
    const back = importCharacter(file, content);
    expect(back).toEqual(c);
    const copy = importCharacter(file, content, { newId: true });
    expect(copy.id).not.toBe(c.id);
  });

  it("rejects files it can't read, with a clear message", () => {
    expect(() => importCharacter({ ruleset: "pf2e", schemaVersion: 1 }, content)).toThrow(/pf2e/);
    expect(() => importCharacter({ ruleset: "dnd5e-2024", schemaVersion: 99 }, content)).toThrow(/newer version/);
    expect(() => importCharacter("nope", content)).toThrow(/isn't a Mimic Box character/);
  });
});
