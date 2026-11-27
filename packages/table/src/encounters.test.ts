import { srdContent as content } from "@mimicbox/ruleset-dnd5e";
import { describe, expect, it } from "vitest";
import { addMap, createCampaign, encounterXp, exportCampaign, importCampaign, playerView, removeEncounter, runEncounter, saveEncounter, type EncounterGroup, type HostCampaign } from "./index.js";

let n = 0;
const newId = () => `id${++n}`;
const goblin: EncounterGroup = { id: "g1", name: "Goblin Warrior", count: 3, hidden: false, monsterId: "goblin-warrior", initiativeBonus: 2, hp: 10, hpFormula: "3d6", ac: 15, xp: 50 };
const boss: EncounterGroup = { id: "g2", name: "Goblin Boss", count: 1, hidden: true, monsterId: "goblin-boss", initiativeBonus: 2, hp: 21, hpFormula: "6d6", ac: 17, xp: 200 };

function campaign(): HostCampaign {
  let c = createCampaign({ id: "c", name: "The Sunken Bell", room: "r", key: "k" });
  c = addMap(c, { id: "docks", name: "Docks", width: 1000, height: 600, grid: { size: 100, offsetX: 0, offsetY: 0 }, revealed: [], tokens: [] });
  return saveEncounter(c, { id: "e1", name: "Docks ambush", notes: "They wait under the pier.", mapId: "docks", groups: [goblin, boss] });
}
const dice = { initiative: (b: number) => 10 + b, hp: (g: EncounterGroup) => g.hp };

describe("encounters", () => {
  it("total their XP and keep numbers in bounds", () => {
    const c = saveEncounter(campaign(), { id: "e2", name: "  ", notes: "", mapId: "nowhere", groups: [{ ...goblin, count: 99 }, { ...boss, name: " " }] });
    const e = c.encounters!.find((x) => x.id === "e2")!;
    expect(e).toMatchObject({ name: "Encounter", mapId: null });
    expect(e.groups).toHaveLength(1);
    expect(e.groups[0]!.count).toBe(20);
    expect(encounterXp(campaign().encounters![0]!)).toBe(350);
    expect(removeEncounter(c, "e2").encounters).toHaveLength(1);
  });

  it("run into a fight in one go: the map shown, the fight started, every creature added and placed", () => {
    const c = runEncounter(campaign(), "e1", dice, newId);
    expect(c.activeMapId).toBe("docks");
    const names = c.combat!.combatants.map((x) => x.name);
    expect(names).toEqual(["Goblin Warrior 1", "Goblin Warrior 2", "Goblin Warrior 3", "Goblin Boss"]);
    expect(c.combat!.combatants[0]).toMatchObject({ initiative: 12, hp: { current: 10, max: 10 }, ac: 15, monsterId: "goblin-warrior", hidden: false });
    expect(c.combat!.combatants[3]).toMatchObject({ hidden: true, hp: { current: 21, max: 21 } });
    const tokens = c.maps![0]!.tokens;
    expect(tokens).toHaveLength(4);
    expect(new Set(tokens.map((t) => `${t.x},${t.y}`)).size).toBe(4);
    expect(tokens.find((t) => t.name === "Goblin Boss")!.hidden).toBe(true);
    // Running it again numbers on from the goblins already fighting.
    const again = runEncounter(c, "e1", dice, newId);
    expect(again.combat!.combatants.map((x) => x.name)).toContain("Goblin Warrior 6");
  });

  it("stay the DM's: players never receive them", () => {
    const wire = JSON.stringify(playerView(campaign(), new Set(), content, "alice"));
    expect(wire).not.toContain("ambush");
    expect(wire).not.toContain("pier");
  });

  it("travel in campaign backups, cleaned on the way in", () => {
    const file = JSON.parse(JSON.stringify(exportCampaign(campaign())));
    file.campaign.encounters.push({ id: "bad" }, { id: "e3", name: "Odd", groups: [{ id: "x", name: "Rat", count: -4, hp: "lots" }], mapId: "gone" });
    const back = importCampaign(file, content, { room: "r2", key: "k2" }).campaign;
    expect(back.encounters!.map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(back.encounters![0]!.groups).toEqual(campaign().encounters![0]!.groups);
    expect(back.encounters![1]).toMatchObject({ mapId: null, groups: [{ name: "Rat", count: 1, hp: 1 }] });
  });
});
