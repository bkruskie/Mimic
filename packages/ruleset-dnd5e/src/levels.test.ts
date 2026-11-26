/**
 * Levels 6 to 20. Expected numbers are worked out by hand from SRD 5.2.1 in the comments.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  createCharacter,
  derive,
  grantEquipment,
  loadSpells,
  srdContent as content,
  type AbilityScores,
  type Character,
  type ClassEntry,
  type FeatChoice,
} from "./index.js";

beforeAll(async () => {
  await loadSpells(content);
});

const scores = (str: number, dex: number, con: number, int: number, wis: number, cha: number): AbilityScores => ({ str, dex, con, int, wis, cha });

function make(classId: string, speciesId: string, backgroundId: string, base: AbilityScores, bg: Partial<AbilityScores>, entry: Partial<ClassEntry>, feats: FeatChoice[] = []): Character {
  const c = createCharacter(content, { name: "Test", classId, speciesId, backgroundId, baseAbilities: base });
  return {
    ...c,
    build: {
      ...c.build,
      background: { id: backgroundId, abilityIncreases: bg },
      classes: [{ ...c.build.classes[0]!, ...entry }],
      feats: [...c.build.feats, ...feats],
    },
  };
}

const asi = (classId: string, level: number, inc: Partial<AbilityScores>): FeatChoice => ({ id: "ability-score-improvement", source: `asi:${classId}:${level}`, abilityIncreases: inc });

describe("Goliath Barbarian 20 (Soldier)", () => {
  // Base Str 15, Dex 13, Con 14. Soldier +2 Str +1 Con -> Str 17, Con 15.
  // ASIs: 4 Str+2 (19); 8 Str+1 Con+1 (20, 16); 12 Con+2 (18); 16 Con+2 (20).
  // Then Primal Champion +4 each, max 25 -> 24, 24. Then Boon of Fate +1 Str, max 30 -> 25.
  const c = make(
    "barbarian",
    "goliath",
    "soldier",
    scores(15, 13, 14, 8, 12, 10),
    { str: 2, con: 1 },
    { level: 20, subclass: "path-of-the-berserker" },
    [
      asi("barbarian", 4, { str: 2 }),
      asi("barbarian", 8, { str: 1, con: 1 }),
      asi("barbarian", 12, { con: 2 }),
      asi("barbarian", 16, { con: 2 }),
      { id: "boon-of-fate", source: "boon:barbarian:19", abilityIncreases: { str: 1 } },
    ],
  );
  const s = derive(c, content);

  it("raises scores past 20 with Primal Champion and the Epic Boon", () => {
    expect(s.abilities.str.score.value).toBe(25);
    expect(s.abilities.con.score.value).toBe(24);
    expect(s.abilities.str.score.sources.map((x) => x.label)).toContain("Primal Champion");
    expect(s.pending.filter((p) => p.kind === "asi" || p.kind === "epic-boon" || p.kind === "feat-ability")).toEqual([]);
  });

  it("computes HP, AC, speed, saves and rage", () => {
    expect(s.proficiencyBonus).toBe(6);
    expect(s.hp.max.value).toBe(285); // 12 + 19 × 7 average + Con 7 × 20
    expect(s.ac.value).toBe(18); // 10 + Dex 1 + Con 7
    expect(s.speed.value).toBe(45); // Goliath 35 + Fast Movement 10
    expect(s.abilities.str.save.value).toBe(13); // +7 + PB 6
    expect(s.attacksPerAction.count).toBe(2);
    const rage = s.resources.find((r) => r.id === "rage")!;
    expect(rage.max).toBe(6);
    expect(rage.detail).toBe("+4 damage");
  });
});

describe("Human Fighter (Champion) at 11, 15 and 20", () => {
  const at = (level: number) =>
    derive(make("fighter", "human", "soldier", scores(15, 14, 13, 10, 12, 8), { str: 2, con: 1 }, { level, subclass: "champion" }), content);

  it("gains attacks and widens the critical range", () => {
    expect(at(11).attacksPerAction).toEqual({ count: 3, source: "Fighter: Two Extra Attacks" });
    expect(at(20).attacksPerAction.count).toBe(4);
    const unarmed = (lvl: number) => at(lvl);
    void unarmed;
    let c = make("fighter", "human", "soldier", scores(15, 14, 13, 10, 12, 8), { str: 2, con: 1 }, { level: 15, subclass: "champion" });
    c = grantEquipment(c, content, [{ name: "Longsword", quantity: 1 }], 0);
    const sword = derive(c, content).attacks.find((a) => a.name === "Longsword")!;
    expect(sword.notes.join(" ")).toContain("Critical hit on 18–20 (Superior Critical)");
  });

  it("counts Indomitable uses", () => {
    expect(at(13).resources.find((r) => r.id === "indomitable")!.max).toBe(2);
    expect(at(17).resources.find((r) => r.id === "action-surge")!.max).toBe(2);
  });
});

describe("Paladin 6 (Acolyte): Aura of Protection", () => {
  // Cha 13 + 2 = 15 (+2); Wis 12 + 1 = 13 (+1). PB 3. Saves: Wis and Cha proficient.
  const s = derive(make("paladin", "human", "acolyte", scores(15, 10, 14, 8, 12, 13), { cha: 2, wis: 1 }, { level: 6, subclass: "oath-of-devotion" }), content);
  it("adds Charisma to every saving throw", () => {
    expect(s.abilities.wis.save.value).toBe(6); // 1 + 3 + 2
    expect(s.abilities.cha.save.value).toBe(7); // 2 + 3 + 2
    expect(s.abilities.str.save.value).toBe(4); // 2 + aura 2
    expect(s.abilities.str.save.sources.at(-1)!.label).toMatch(/Aura of Protection/);
  });
});

describe("later saving throw proficiencies", () => {
  it("Monk 14 is proficient in every save", () => {
    const s = derive(make("monk", "human", "soldier", scores(10, 15, 13, 8, 14, 12), { dex: 2, con: 1 }, { level: 14, subclass: "warrior-of-the-open-hand" }), content);
    expect(Object.values(s.abilities).every((a) => a.saveProficient)).toBe(true);
    expect(s.abilities.int.save.value).toBe(-1 + 5);
  });
  it("Rogue 15 adds Wisdom and Charisma", () => {
    const s = derive(make("rogue", "human", "criminal", scores(8, 15, 14, 10, 13, 12), { dex: 2, con: 1 }, { level: 15, subclass: "thief" }), content);
    expect(s.abilities.wis.saveProficient).toBe(true);
    expect(s.abilities.cha.saveProficient).toBe(true);
    expect(s.abilities.str.saveProficient).toBe(false);
  });
});

describe("Warlock 11: invocations and Mystic Arcanum", () => {
  const base = make("warlock", "human", "sage", scores(8, 14, 13, 10, 12, 15), { cha: 2, con: 1 }, { level: 11, subclass: "fiend-patron" });
  it("asks for seven invocations and a level 6 arcanum", () => {
    const s = derive(base, content);
    expect(s.pending.find((p) => p.kind === "class-options")?.count).toBe(7);
    expect(s.pending.some((p) => p.kind === "mystic-arcanum" && p.level === 6)).toBe(true);
    expect(s.spellcasting!.pact).toEqual({ count: 3, level: 5 });
  });
  it("applies chosen invocations and grants the arcanum spell", () => {
    const c: Character = {
      ...base,
      build: { ...base.build, classes: [{ ...base.build.classes[0]!, options: ["armor-of-shadows", "pact-of-the-blade", "thirsting-blade", "agonizing-blast", "devils-sight", "eldritch-mind", "fiendish-vigor"] }] },
      spells: { ...base.spells, arcanum: { "6": "circle-of-death" } },
    };
    const s = derive(c, content);
    expect(s.pending.some((p) => p.kind === "class-options" || p.kind === "mystic-arcanum")).toBe(false);
    expect(s.ac.value).toBe(15); // Mage Armor 13 + Dex 2
    expect(s.attacksPerAction).toEqual({ count: 2, source: "Thirsting Blade, pact weapon only" });
    expect(s.grantedSpells.find((g) => g.id === "circle-of-death")?.freeCast).toBe(true);
    expect(s.resources.some((r) => r.id === "free-cast:circle-of-death")).toBe(true);
    expect(s.features.some((f) => f.name === "Thirsting Blade" && f.source === "Eldritch Invocation")).toBe(true);
    expect(s.warnings).toEqual([]);
  });
  it("warns when an invocation's prerequisites are missing", () => {
    const c: Character = { ...base, build: { ...base.build, classes: [{ ...base.build.classes[0]!, level: 3, options: ["thirsting-blade"] }] } };
    const s = derive(c, content);
    expect(s.warnings.join(" ")).toContain("Thirsting Blade needs Warlock level 5");
    expect(s.warnings.join(" ")).toContain("needs the Pact of the Blade invocation");
  });
});

describe("Sorcerer options", () => {
  it("Metamagic grows at 10 and 17; Draconic Elemental Affinity adds a resistance", () => {
    const c = make("sorcerer", "human", "sage", scores(8, 14, 13, 10, 12, 15), { cha: 2, con: 1 }, { level: 10, subclass: "draconic-sorcery", options: ["quickened-spell", "twinned-spell"], choices: { elementalAffinity: "fire" } });
    const s = derive(c, content);
    expect(s.pending.find((p) => p.kind === "class-options")?.count).toBe(2);
    expect(s.resistances).toContain("fire");
  });
});

describe("Epic Boon", () => {
  it("asks for a boon at 19 and for the boon's ability choice", () => {
    const c = make("wizard", "human", "sage", scores(8, 14, 13, 15, 12, 10), { int: 2, con: 1 }, { level: 19, subclass: "evoker" });
    expect(derive(c, content).pending.some((p) => p.kind === "epic-boon")).toBe(true);
    const withBoon: Character = { ...c, build: { ...c.build, feats: [...c.build.feats, { id: "boon-of-spell-recall", source: "boon:wizard:19" }] } };
    const s = derive(withBoon, content);
    expect(s.pending.some((p) => p.kind === "epic-boon")).toBe(false);
    expect(s.pending.find((p) => p.kind === "feat-ability")?.key).toBe("boon:wizard:19");
    expect(s.features.some((f) => f.source === "Epic Boon")).toBe(true);
  });
});

describe("every class and subclass derives cleanly at levels 1 to 20", () => {
  for (const cls of content.classes) {
    for (const sub of cls.subclasses) {
      it(`${cls.name} (${sub.name}) 1–20`, () => {
        const known = new Set(content.spells!.map((x) => x.id));
        for (let level = 1; level <= 20; level++) {
          let c = make(cls.id, "human", "soldier", scores(15, 14, 13, 12, 10, 8), { str: 2, con: 1 }, { level, subclass: level >= 3 ? sub.id : null, choices: { landType: "temperate", elementalAffinity: "fire" } });
          const opt = cls.startingEquipment[0]!;
          c = grantEquipment(c, content, opt.items, opt.gp);
          const s = derive(c, content);
          expect(s.level).toBe(level);
          expect(s.proficiencyBonus).toBe(2 + Math.floor((level - 1) / 4));
          expect(s.hp.max.value).toBeGreaterThanOrEqual(level);
          for (const g of s.grantedSpells) expect(known.has(g.id), `${level}: granted ${g.id}`).toBe(true);
          if (s.spellcasting) {
            for (const id of Object.values(s.spellcasting.list).flat()) expect(known.has(id), `${level}: ${id}`).toBe(true);
            expect(s.spellcasting.maxSpellLevel).toBeLessThanOrEqual(9);
          }
          for (const r of s.resources) expect(r.max, `${level}: ${r.id}`).toBeGreaterThan(0);
          expect(s.pending.some((p) => p.kind === "subclass")).toBe(false);
          expect(s.pending.some((p) => p.kind === "epic-boon")).toBe(level >= 19);
          expect(s.features.filter((f) => f.source === cls.name).every((f) => f.level! <= level)).toBe(true);
        }
      });
    }
  }
});
