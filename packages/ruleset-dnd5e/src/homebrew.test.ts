/**
 * Homebrew features, attacks and bonuses. Expected numbers are worked out by hand in the comments.
 */
import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  createCharacter,
  derive,
  exportCharacter,
  grantEquipment,
  importCharacter,
  longRest,
  removeHomebrew,
  saveHomebrew,
  setResourceSpent,
  shortRest,
  srdContent as content,
  type Character,
} from "./index.js";

// Human Fighter 1 (Soldier): base Str 15 Dex 14 Con 13 Int 10 Wis 12 Cha 8; Soldier +2 Str +1 Con -> Str 17 (+3), Dex 14 (+2), Con 14 (+2).
function fighter(): Character {
  let c = createCharacter(content, { name: "Hb", classId: "fighter", speciesId: "human", backgroundId: "soldier", baseAbilities: { str: 15, dex: 14, con: 13, int: 10, wis: 12, cha: 8 } });
  c = { ...c, build: { ...c.build, background: { id: "soldier", abilityIncreases: { str: 2, con: 1 } } } };
  return grantEquipment(c, content, [{ name: "Chain Mail", quantity: 1 }, { name: "Longsword", quantity: 1 }], 0);
}

describe("homebrew bonuses", () => {
  const base = fighter();
  const ring = { id: "ring", name: "Ring of Protection", ref: null, quantity: 1, equipped: true };
  let c: Character = { ...base, inventory: [...base.inventory, ring] };
  c = saveHomebrew(c, "bonuses", { id: "b1", label: "Ring of Protection", target: "ac", value: 1, itemId: "ring" });
  c = saveHomebrew(c, "bonuses", { id: "b2", label: "Ring of Protection", target: "saves", value: 1, itemId: "ring" });
  c = saveHomebrew(c, "bonuses", { id: "b3", label: "Gauntlets of Ogre Power", target: "ability:str", value: 19, setMinimum: true });
  c = saveHomebrew(c, "bonuses", { id: "b4", label: "Boots of Speed (resting)", target: "speed", value: 5 });
  c = saveHomebrew(c, "bonuses", { id: "b5", label: "Blessing", target: "skill:perception", value: 2 });

  it("adds to AC and saves while the item is equipped", () => {
    const s = derive(c, content);
    expect(s.ac.value).toBe(17); // Chain Mail 16 + ring 1
    expect(s.ac.sources.at(-1)).toEqual({ label: "Ring of Protection", value: 1 });
    expect(s.abilities.wis.save.value).toBe(2); // Wis +1, not proficient, ring +1
  });

  it("stops counting when the item is unequipped", () => {
    const off = { ...c, inventory: c.inventory.map((i) => (i.id === "ring" ? { ...i, equipped: false } : i)) };
    expect(derive(off, content).ac.value).toBe(16);
  });

  it("raises a score to a minimum and flows into everything that uses it", () => {
    const s = derive(c, content);
    expect(s.abilities.str.score.value).toBe(19); // 17 -> at least 19
    expect(s.abilities.str.score.sources.at(-1)!.label).toBe("Gauntlets of Ogre Power (score becomes 19)");
    expect(s.attacks.find((a) => a.name === "Longsword")!.toHit.value).toBe(6); // Str +4, PB 2
    expect(s.speed.value).toBe(35);
    expect(s.skills.perception.total.value).toBe(3); // Wis +1 + 2
    expect(s.passive.perception).toBe(13);
  });

  it("does nothing when the score is already higher", () => {
    const low = saveHomebrew(c, "bonuses", { id: "b3", label: "Gauntlets of Ogre Power", target: "ability:str", value: 15, setMinimum: true });
    expect(derive(low, content).abilities.str.score.value).toBe(17);
  });

  it("warns when the linked item is gone", () => {
    const gone = { ...c, inventory: c.inventory.filter((i) => i.id !== "ring") };
    expect(derive(gone, content).warnings.join(" ")).toContain("no longer in your inventory");
  });
});

describe("homebrew attacks", () => {
  it("computes to-hit and damage from the chosen ability", () => {
    let c = saveHomebrew(fighter(), "attacks", { id: "a1", name: "Flame Tongue", ability: "str", proficient: true, toHitBonus: 1, damage: "1d8", addModifier: true, damageType: "slashing", range: "5 ft.", notes: "+2d6 Fire while ablaze" });
    const atk = derive(c, content).attacks.find((a) => a.id === "custom:a1")!;
    expect(atk.toHit.value).toBe(6); // Str 3 + PB 2 + 1
    expect(atk.damage).toBe("1d8+3");
    expect(atk.notes).toEqual(["+2d6 Fire while ablaze"]);
    c = saveHomebrew(c, "attacks", { id: "a1", name: "Flame Tongue", ability: "str", proficient: true, toHitBonus: 1, damage: "one d8", addModifier: true, damageType: "slashing", range: "5 ft.", notes: "" });
    const s = derive(c, content);
    expect(s.warnings.join(" ")).toContain("isn't a dice roll Mimic Box can read");
    expect(s.attacks.find((a) => a.id === "custom:a1")!.damage).toBe("0+3");
  });
});

describe("homebrew features", () => {
  it("lists the feature and tracks its uses through rests", () => {
    let c = saveHomebrew(fighter(), "features", { id: "f1", name: "Lucky Charm", kind: "Magic item", text: "Reroll one d20.", uses: { max: 2, reset: "short" } });
    let s = derive(c, content);
    expect(s.features.some((f) => f.name === "Lucky Charm" && f.source === "Magic item")).toBe(true);
    expect(s.resources.find((r) => r.id === "custom:f1")).toMatchObject({ max: 2, reset: "short" });
    c = setResourceSpent(c, "custom:f1", 2);
    c = shortRest(c, content, []);
    expect(c.state.resourcesSpent["custom:f1"] ?? 0).toBe(0);
    c = setResourceSpent(c, "custom:f1", 1);
    c = removeHomebrew(c, "features", "f1");
    s = derive(c, content);
    expect(s.features.some((f) => f.name === "Lucky Charm")).toBe(false);
    expect(c.state.resourcesSpent["custom:f1"]).toBeUndefined();
    void longRest;
  });
});

describe("schema version 2", () => {
  it("round-trips homebrew and upgrades version 1 files", () => {
    const c = saveHomebrew(fighter(), "bonuses", { id: "b", label: "Cloak", target: "saves", value: 1 });
    expect(c.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const back = importCharacter(JSON.parse(JSON.stringify(exportCharacter(c, content))), content);
    expect(back.homebrew).toEqual(c.homebrew);
    const v1 = { ...fighter(), schemaVersion: 1 };
    delete (v1 as Partial<Character>).homebrew;
    expect(importCharacter(v1, content).schemaVersion).toBe(2);
  });

  it("rejects a malformed homebrew section", () => {
    const bad = { ...fighter(), homebrew: { features: [], attacks: [], bonuses: [{ id: "x", label: "x", target: "flying", value: 1 }] } };
    expect(() => importCharacter(bad, content)).toThrow(/homebrew bonus list isn't valid/);
  });
});
