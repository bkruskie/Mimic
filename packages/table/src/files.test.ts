import { createCharacter, exportVaultBackup, importVaultBackup, srdContent as content } from "@mimicbox/ruleset-dnd5e";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, addDmRoll, createCampaign, exportCampaign, handlePlayerMessage, importCampaign } from "./index.js";

const v = PROTOCOL_VERSION;
let n = 0;
const newId = () => `id-${++n}`;

function played() {
  let c = createCampaign({ id: "camp", name: "The Sunken Bell", room: "old-room", key: "old-key" });
  c = handlePlayerMessage(c, "alice", { t: "hello", v, invite: "old-key", playerName: "Alice" }, content, newId).campaign;
  const wren = createCharacter(content, { name: "Wren", classId: "rogue", speciesId: "human", backgroundId: "criminal" });
  c = handlePlayerMessage(c, "alice", { t: "character", v, commandId: "c1", character: wren }, content, newId).campaign;
  return addDmRoll(c, { by: "DM", characterName: "DM", label: "Ambush", expression: "1d20", total: 9, breakdown: "9", visibility: "dm" }, newId);
}

describe("campaign files", () => {
  it("round-trip with a new room and key, so old invite links stay dead", () => {
    const file = JSON.parse(JSON.stringify(exportCampaign(played())));
    expect(JSON.stringify(file)).not.toContain("old-key");
    const { campaign, problems } = importCampaign(file, content, { room: "new-room", key: "new-key" });
    expect(problems).toEqual([]);
    expect(campaign).toMatchObject({ id: "camp", name: "The Sunken Bell", room: "new-room", key: "new-key", seen: {} });
    expect(campaign.members.alice?.character?.name).toBe("Wren");
    expect(campaign.rolls.map((r) => r.label)).toEqual(["Ambush"]);
  });

  it("refuses other files and newer versions", () => {
    const fresh = { room: "r", key: "k" };
    expect(() => importCampaign({ format: "mimicbox-character" }, content, fresh)).toThrow(/isn't a Mimic Box campaign/);
    expect(() => importCampaign({ ...exportCampaign(played()), formatVersion: 9 }, content, fresh)).toThrow(/newer version/);
  });

  it("keeps the party when one character can't be read", () => {
    const file = JSON.parse(JSON.stringify(exportCampaign(played())));
    file.campaign.members.alice.character.schemaVersion = 99;
    const { campaign, problems } = importCampaign(file, content, { room: "r", key: "k" });
    expect(campaign.members.alice).toMatchObject({ playerName: "Alice", character: null });
    expect(problems[0]).toMatch(/Alice's character couldn't be read/);
  });
});

describe("vault backups", () => {
  it("round-trip every character and skip damaged ones", () => {
    const a = createCharacter(content, { name: "Wren", classId: "rogue", speciesId: "human", backgroundId: "criminal" });
    const b = createCharacter(content, { name: "Oryn", classId: "wizard", speciesId: "elf", backgroundId: "sage" });
    const file = JSON.parse(JSON.stringify(exportVaultBackup([a, b], content)));
    expect(importVaultBackup(file, content).characters.map((c) => c.name)).toEqual(["Wren", "Oryn"]);
    file.characters[1].schemaVersion = 99;
    const partial = importVaultBackup(file, content);
    expect(partial.characters.map((c) => c.name)).toEqual(["Wren"]);
    expect(partial.problems[0]).toMatch(/^Oryn: .*newer version/);
  });
  it("also accepts a single character file", () => {
    const a = createCharacter(content, { name: "Wren", classId: "rogue", speciesId: "human", backgroundId: "criminal" });
    expect(importVaultBackup({ format: "mimicbox-character", formatVersion: 1, character: a }, content).characters).toHaveLength(1);
  });
});
