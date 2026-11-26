/**
 * Multiclassing, from SRD 5.2.1 "Multiclassing". Expected numbers are worked out by hand in the comments.
 */
import { describe, expect, it } from "vitest";
import {
  classSpellLists,
  createCharacter,
  derive,
  levelUp,
  longRest,
  multiclassBlocker,
  setClassSpells,
  shortRest,
  srdContent as content,
  type AbilityScores,
  type Character,
  type ClassEntry,
} from "./index.js";

const scores = (str: number, dex: number, con: number, int: number, wis: number, cha: number): AbilityScores => ({ str, dex, con, int, wis, cha });

function make(base: AbilityScores, bg: { id: string; inc: Partial<AbilityScores> }, classes: Partial<ClassEntry>[]): Character {
  const c = createCharacter(content, { name: "Mc", classId: classes[0]!.id!, speciesId: "human", backgroundId: bg.id, baseAbilities: base });
  return {
    ...c,
    build: {
      ...c.build,
      background: { id: bg.id, abilityIncreases: bg.inc },
      classes: classes.map((e, i) => ({ ...(i === 0 ? c.build.classes[0]! : { skills: [], expertise: [], hitPointRolls: [], choices: {}, weaponMasteries: [], subclass: null }), ...e }) as ClassEntry),
    },
  };
}

describe("Fighter 5 / Wizard 3 (Soldier)", () => {
  // Str 15+2 = 17, Dex 13, Con 14+1 = 15, Int 13. PB at level 8 is +3.
  const c = make(scores(15, 13, 14, 13, 10, 8), { id: "soldier", inc: { str: 2, con: 1 } }, [
    { id: "fighter", level: 5, subclass: "champion" },
    { id: "wizard", level: 3, subclass: "evoker" },
  ]);
  const s = derive(c, content);

  it("adds levels, hit points and hit dice by class", () => {
    expect(s.level).toBe(8);
    expect(s.proficiencyBonus).toBe(3);
    expect(s.classSummary).toBe("Fighter 5 (Champion) / Wizard 3 (Evoker)");
    expect(s.hp.max.value).toBe(62); // d10: 10 + 4 × 6; d6: 3 × 4 average; Con +2 × 8
    expect(s.hitDiceByDie).toEqual([
      { die: 10, total: 5, available: 5 },
      { die: 6, total: 3, available: 3 },
    ]);
  });

  it("keeps the first class's saving throws and Extra Attack", () => {
    expect(s.abilities.str.saveProficient).toBe(true);
    expect(s.abilities.int.saveProficient).toBe(false); // Wizard saves aren't gained by multiclassing
    expect(s.attacksPerAction.count).toBe(2);
  });

  it("casts as a level 3 Wizard", () => {
    const w = s.spellcasting!;
    expect(w.classId).toBe("wizard");
    expect(w.slots.filter((n) => n > 0)).toEqual([4, 2]);
    expect(w.saveDc.value).toBe(12); // 8 + Int 1 + PB 3
    expect(w.maxSpellLevel).toBe(2);
    expect(s.pending.some((p) => p.kind === "cantrips" && p.key === "wizard")).toBe(true);
    expect(s.warnings).toEqual([]);
  });
});

describe("Cleric 3 / Paladin 4 (Acolyte): shared slots", () => {
  // Str 13, Wis 14+1 = 15, Cha 13+2 = 15. Caster level 3 + ceil(4 / 2) = 5.
  const c = make(scores(13, 10, 14, 8, 14, 13), { id: "acolyte", inc: { cha: 2, wis: 1 } }, [
    { id: "cleric", level: 3, subclass: "life-domain", choices: { divineOrder: "protector" } },
    { id: "paladin", level: 4, subclass: "oath-of-devotion" },
  ]);
  const s = derive(c, content);

  it("uses the Multiclass Spellcaster table for slots", () => {
    expect(s.spellcastingClasses.map((x) => x.classId)).toEqual(["cleric", "paladin"]);
    expect(s.spellcastingClasses[0]!.slots).toEqual([4, 3, 2]);
    expect(s.spellcastingClasses[1]!.slots).toEqual([4, 3, 2]);
  });

  it("prepares each class's spells as if single-classed", () => {
    expect(s.spellcastingClasses[0]!.maxSpellLevel).toBe(2); // Cleric 3
    expect(s.spellcastingClasses[1]!.maxSpellLevel).toBe(1); // Paladin 4
    expect(s.spellcastingClasses[1]!.saveDc.value).toBe(13); // 8 + Cha 2 + PB 3
    expect(s.pending.find((p) => p.kind === "prepared" && p.key === "paladin")?.message).toMatch(/Paladin spells/);
  });

  it("stores the second class's spells separately", () => {
    let next = setClassSpells(c, "paladin", { cantrips: [], prepared: ["bless", "cure-wounds"] });
    next = setClassSpells(next, "cleric", { cantrips: ["guidance"], prepared: ["healing-word"] });
    expect(classSpellLists(next, "paladin").prepared).toEqual(["bless", "cure-wounds"]);
    expect(next.spells.prepared).toEqual(["healing-word"]);
    expect(next.spells.byClass?.paladin?.prepared).toEqual(["bless", "cure-wounds"]);
  });
});

describe("taking a new class", () => {
  // Wizard with Str 8, Dex 14, Int 15+2 = 17.
  const wizard = make(scores(8, 14, 13, 15, 12, 10), { id: "sage", inc: { int: 2, con: 1 } }, [{ id: "wizard", level: 2 }]);

  it("checks the primary ability of the new class and the current one", () => {
    expect(multiclassBlocker(wizard, content, "barbarian")).toBe("Needs Strength 13 or higher.");
    expect(multiclassBlocker(wizard, content, "fighter")).toBeNull(); // Dex 14 counts for Fighter
    expect(multiclassBlocker(wizard, content, "monk")).toBe("Needs Dexterity and Wisdom 13 or higher.");
    expect(() => levelUp(wizard, content, { classId: "barbarian" })).toThrow(/can't take a level in Barbarian yet/);
  });

  it("gains only the multiclass proficiencies and the new hit die", () => {
    const before = derive(wizard, content);
    const next = levelUp(wizard, content, { classId: "fighter", hitPointRoll: 7 });
    const s = derive(next, content);
    expect(s.classSummary).toBe("Wizard 2 / Fighter 1");
    expect(s.hp.max.value).toBe(before.hp.max.value + 7 + 2); // rolled 7 + Con 2 (13 + 1 = 14)
    expect(next.state.hp).toBe(wizard.state.hp + 9);
    expect(s.proficiencies.armor).toBe("Light armor, Medium armor, Shields"); // no Heavy armor
    expect(s.pending.some((p) => p.kind === "fighting-style" && p.key === "fighter")).toBe(true);
    expect(s.pending.some((p) => p.kind === "class-skills" && p.key === "fighter")).toBe(false); // Fighter grants no skill
  });

  it("asks for the one skill a Rogue grants", () => {
    const fighter = make(scores(15, 14, 13, 10, 12, 8), { id: "soldier", inc: { str: 2, con: 1 } }, [{ id: "fighter", level: 3, skills: ["perception", "survival"] }]);
    const s = derive(levelUp(fighter, content, { classId: "rogue" }), content);
    expect(s.pending.find((p) => p.kind === "class-skills" && p.key === "rogue")?.count).toBe(1);
  });
});

describe("Hit Point Dice of different sizes", () => {
  const c = make(scores(15, 13, 14, 13, 10, 8), { id: "soldier", inc: { str: 2, con: 1 } }, [
    { id: "fighter", level: 2 },
    { id: "wizard", level: 2 },
  ]);
  it("spends the die rolled and regains all on a Long Rest", () => {
    const hurt: Character = { ...c, state: { ...c.state, hp: 5 } };
    const rested = shortRest(hurt, content, [{ die: 6, roll: 4 }, { die: 6, roll: 1 }, { die: 6, roll: 6 }]);
    expect(rested.state.hp).toBe(5 + (4 + 2) + (1 + 2)); // the third d6 isn't available
    const s = derive(rested, content);
    expect(s.hitDiceByDie).toEqual([
      { die: 10, total: 2, available: 2 },
      { die: 6, total: 2, available: 0 },
    ]);
    expect(derive(longRest(rested, content), content).hitDiceByDie.every((g) => g.available === g.total)).toBe(true);
  });
});
