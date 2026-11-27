import { describe, expect, it } from "vitest";
import { crValue, loadMonsters, rollSegments } from "./index.js";

describe("SRD monsters", () => {
  it("has the SRD's stat blocks, each complete", async () => {
    const monsters = await loadMonsters();
    expect(monsters.length).toBeGreaterThanOrEqual(320);
    for (const m of monsters) {
      expect(Object.keys(m.abilities), m.name).toHaveLength(6);
      expect(m.hp.average, m.name).toBeGreaterThan(0);
      expect(m.ac, m.name).toBeGreaterThan(0);
    }
    expect(new Set(monsters.map((m) => m.id)).size).toBe(monsters.length);
  });

  it("reads a goblin boss as printed", async () => {
    const g = (await loadMonsters()).find((m) => m.id === "goblin-boss")!;
    expect(g).toMatchObject({ size: "Small", type: "Fey (Goblinoid)", ac: 17, hp: { average: 21, formula: "6d6" }, initiative: { bonus: 2, score: 12 }, cr: "1", xp: 200 });
    expect(g.abilities.dex).toEqual({ score: 15, mod: 2, save: 2 });
    expect(g.sections.find((s) => s.title === "Actions")!.entries.map((e) => e.name)).toEqual(["Multiattack", "Scimitar", "Shortbow"]);
  });

  it("orders challenge ratings", () => {
    expect(["1", "1/4", "0", "1/2", "17", "1/8"].sort((a, b) => crValue(a) - crValue(b))).toEqual(["0", "1/8", "1/4", "1/2", "1", "17"]);
  });

  it("finds what to roll in an attack, keeping the text exactly", () => {
    const text = "*Melee Attack Roll:* +4, reach 5 ft. 5 (1d6 + 2) Slashing damage, plus 2 (1d4) Slashing damage if the attack roll had Advantage.";
    const segs = rollSegments(text);
    expect(segs.map((s) => (typeof s === "string" ? s : s.label)).join("")).toBe(text);
    expect(segs.filter((s) => typeof s !== "string")).toEqual([
      { roll: "1d20+4", label: "+4", kind: "attack" },
      { roll: "1d6+2", label: "5 (1d6 + 2)", kind: "damage" },
      { roll: "1d4", label: "2 (1d4)", kind: "damage" },
    ]);
    expect(rollSegments("*Ranged Attack Roll:* −1, range 30 ft.").find((s) => typeof s !== "string")).toEqual({ roll: "1d20-1", label: "−1", kind: "attack" });
  });
});
