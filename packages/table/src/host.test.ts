/**
 * The host's rules: who may join, what each audience sees, and that resent commands apply once.
 * These mirror the security tests in docs/architecture.md that apply before the map exists.
 */
import { createCharacter, exportCharacter, srdContent as content, type Character } from "@mimicbox/ruleset-dnd5e";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  addDmRoll,
  createCampaign,
  decodeInvite,
  displayView,
  encodeInvite,
  handlePlayerMessage,
  parsePlayerMessage,
  playerView,
  removeMember,
  replaceInvite,
  type HostCampaign,
} from "./index.js";

let n = 0;
const newId = () => `id-${++n}`;
const v = PROTOCOL_VERSION;
const hero = (name: string): Character => {
  const c = createCharacter(content, { name, classId: "fighter", speciesId: "human", backgroundId: "soldier" });
  return { ...c, notes: { ...c.notes, backstory: "A secret only my DM knows." } };
};

function joined(): HostCampaign {
  let c = createCampaign({ id: "camp", name: "The Sunken Bell", room: "room-1", key: "key-1" });
  c = handlePlayerMessage(c, "alice", { t: "hello", v, invite: "key-1", playerName: "Alice" }, content, newId).campaign;
  c = handlePlayerMessage(c, "bob", { t: "hello", v, invite: "key-1", playerName: "Bob" }, content, newId).campaign;
  return c;
}

describe("joining", () => {
  it("welcomes a device with the right key", () => {
    const c = createCampaign({ id: "camp", name: "The Sunken Bell", room: "room-1", key: "key-1" });
    const r = handlePlayerMessage(c, "alice", { t: "hello", v, invite: "key-1", playerName: "Alice" }, content, newId);
    expect(r.replies).toEqual([{ to: "alice", msg: { t: "welcome", v, campaign: "The Sunken Bell", memberId: "alice" } }]);
    expect(r.campaign.members.alice?.playerName).toBe("Alice");
  });

  it("denies a wrong or replaced key", () => {
    let c = joined();
    c = replaceInvite(c, "room-2", "key-2");
    const r = handlePlayerMessage(c, "mallory", { t: "hello", v, invite: "key-1", playerName: "M" }, content, newId);
    expect(r.replies[0]!.msg.t).toBe("denied");
    expect(r.campaign.members.mallory).toBeUndefined();
  });

  it("ignores anything but hello from a device that hasn't joined", () => {
    const c = joined();
    const r = handlePlayerMessage(c, "mallory", { t: "roll", v, commandId: "c1", roll: { characterName: "X", label: "Hack", expression: "1d20", total: 20, breakdown: "20" } }, content, newId);
    expect(r).toEqual({ campaign: c, replies: [], changed: false });
  });

  it("asks the DM to update when a player's app is newer", () => {
    const r = handlePlayerMessage(joined(), "alice", { t: "hello", v: v + 1, invite: "key-1", playerName: "Alice" }, content, newId);
    expect(r.replies[0]!.msg).toMatchObject({ t: "denied", reason: expect.stringMatching(/update Mimic Box/) });
  });

  it("removing a member stops their commands", () => {
    const c = removeMember(joined(), "bob");
    const r = handlePlayerMessage(c, "bob", { t: "character", v, commandId: "c1", character: exportCharacter(hero("Bram"), content).character }, content, newId);
    expect(r.changed).toBe(false);
  });
});

describe("commands", () => {
  it("validates a shared character and stores the working copy", () => {
    const r = handlePlayerMessage(joined(), "alice", { t: "character", v, commandId: "c1", character: hero("Wren") }, content, newId);
    expect(r.changed).toBe(true);
    expect(r.campaign.members.alice?.character?.name).toBe("Wren");
    const bad = handlePlayerMessage(joined(), "alice", { t: "character", v, commandId: "c2", character: { ruleset: "dnd5e-2024", schemaVersion: 99 } }, content, newId);
    expect(bad.replies[0]!.msg).toMatchObject({ t: "denied", reason: expect.stringMatching(/newer version/) });
  });

  it("applies a command resent after a dropped connection only once", () => {
    let c = joined();
    const roll = { t: "roll", v, commandId: "r1", roll: { characterName: "Wren", label: "Stealth", expression: "1d20+7", total: 19, breakdown: "12 + 7" } };
    c = handlePlayerMessage(c, "alice", roll, content, newId).campaign;
    const again = handlePlayerMessage(c, "alice", roll, content, newId);
    expect(again.changed).toBe(false);
    expect(again.replies).toEqual([{ to: "alice", msg: { t: "ack", v, commandId: "r1" } }]);
    expect(again.campaign.rolls).toHaveLength(1);
  });

  it("rejects malformed and oversized messages without a crash", () => {
    expect(parsePlayerMessage(null)).toBeNull();
    expect(parsePlayerMessage({ t: "roll", v, commandId: "bad id with spaces", roll: {} })).toBeNull();
    expect(parsePlayerMessage({ t: "roll", v, commandId: "r", roll: { characterName: "A", label: "B", expression: "1d20", total: Infinity, breakdown: "" } })).toBeNull();
    expect(parsePlayerMessage({ t: "character", v, commandId: "c", character: { blob: "x".repeat(300 * 1024) } })).toBeNull();
    expect(parsePlayerMessage({ t: "teleport", v })).toBeNull();
    expect(handlePlayerMessage(joined(), "alice", "not json at all", content, newId).changed).toBe(false);
  });
});

describe("what each audience sees", () => {
  let c = joined();
  c = handlePlayerMessage(c, "alice", { t: "character", v, commandId: "c1", character: hero("Wren") }, content, newId).campaign;
  c = addDmRoll(c, { by: "DM", characterName: "Goblin boss", label: "Ambush", expression: "1d20+4", total: 22, breakdown: "18 + 4", visibility: "dm" }, newId);
  c = addDmRoll(c, { by: "DM", characterName: "Ogre", label: "Club", expression: "2d8+4", total: 13, breakdown: "9 + 4", visibility: "public" }, newId);
  const connected = new Set(["alice"]);

  it("players get summaries and public rolls, never DM-only rolls or private notes", () => {
    const [party, rolls] = playerView(c, connected, content);
    const wire = JSON.stringify([party, rolls]);
    expect(wire).not.toContain("Ambush");
    expect(wire).not.toContain("A secret only my DM knows");
    expect(wire).not.toContain("inventory");
    expect(rolls).toMatchObject({ t: "rolls", rolls: [{ label: "Club" }] });
    expect(party).toMatchObject({
      t: "party",
      members: [
        { userId: "alice", playerName: "Alice", connected: true, character: { name: "Wren", classSummary: "Fighter 1" } },
        { userId: "bob", playerName: "Bob", connected: false, character: null },
      ],
    });
  });

  it("the display gets the same player-safe view", () => {
    const d = displayView(c, connected, content);
    expect(JSON.stringify(d)).not.toContain("Ambush");
    expect(d.rolls.map((r) => r.label)).toEqual(["Club"]);
  });
});

describe("invite links", () => {
  it("round-trip and reject damaged codes", () => {
    const invite = { room: "r", key: "k", host: "host-id", campaign: "The Sunken Bell", relays: ["wss://relay.example"] };
    expect(decodeInvite(encodeInvite(invite))).toEqual(invite);
    expect(() => decodeInvite("not-a-code")).toThrow(/damaged/);
    expect(decodeInvite(encodeInvite({ ...invite, relays: ["javascript:alert(1)"] })).relays).toBeUndefined();
  });
});
