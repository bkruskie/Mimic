/**
 * Initiative and turns: the order, rounds, players setting only their own initiative, and hidden creatures that
 * never reach players or the display.
 */
import { createCharacter, srdContent as content } from "@mimicbox/ruleset-dnd5e";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  addCombatant,
  createCampaign,
  displayView,
  endCombat,
  handlePlayerMessage,
  initiativeOrder,
  nextTurn,
  playerView,
  previousTurn,
  removeCombatant,
  startCombat,
  updateCombatant,
  type HostCampaign,
} from "./index.js";

const v = PROTOCOL_VERSION;
let n = 0;
const newId = () => `id-${++n}`;

function party(): HostCampaign {
  let c = createCampaign({ id: "camp", name: "The Sunken Bell", room: "r", key: "k" });
  for (const [who, name] of [
    ["alice", "Wren"],
    ["bob", "Bram"],
  ] as const) {
    c = handlePlayerMessage(c, who, { t: "hello", v, invite: "k", playerName: who }, content, newId).campaign;
    const ch = createCharacter(content, { name, classId: "fighter", speciesId: "human", backgroundId: "soldier" });
    c = handlePlayerMessage(c, who, { t: "character", v, commandId: `c-${who}`, character: ch }, content, newId).campaign;
  }
  return c;
}

function fight(): HostCampaign {
  let c = startCombat(party(), newId);
  c = addCombatant(c, { id: "ogre", name: "Ogre", initiative: 8, hidden: false, hp: { current: 59, max: 59 } });
  c = addCombatant(c, { id: "assassin", name: "Hidden assassin", initiative: 22, hidden: true, hp: { current: 30, max: 30 } });
  c = handlePlayerMessage(c, "alice", { t: "initiative", v, commandId: "i1", total: 15 }, content, newId).campaign;
  return handlePlayerMessage(c, "bob", { t: "initiative", v, commandId: "i2", total: 8 }, content, newId).campaign;
}

describe("combat", () => {
  it("starts with the party and orders by initiative, keeping ties in the order added", () => {
    const c = fight();
    expect(initiativeOrder(c.combat!.combatants).map((x) => x.name)).toEqual(["Hidden assassin", "Wren", "Bram", "Ogre"]);
  });

  it("lets a player set only their own initiative, once", () => {
    let c = fight();
    c = handlePlayerMessage(c, "alice", { t: "initiative", v, commandId: "i3", total: 20 }, content, newId).campaign;
    expect(c.combat!.combatants.find((x) => x.name === "Wren")!.initiative).toBe(15);
    const outsider = handlePlayerMessage(c, "mallory", { t: "initiative", v, commandId: "i4", total: 30 }, content, newId);
    expect(outsider.changed).toBe(false);
  });

  it("steps turns and rounds, forwards and back", () => {
    let c = nextTurn(fight());
    const name = () => c.combat!.combatants.find((x) => x.id === c.combat!.turnId)!.name;
    expect([c.combat!.round, name()]).toEqual([1, "Hidden assassin"]);
    for (let i = 0; i < 3; i++) c = nextTurn(c);
    expect([c.combat!.round, name()]).toEqual([1, "Ogre"]);
    c = nextTurn(c);
    expect([c.combat!.round, name()]).toEqual([2, "Hidden assassin"]);
    c = previousTurn(c);
    expect([c.combat!.round, name()]).toEqual([1, "Ogre"]);
  });

  it("hands the turn on when the acting combatant is removed", () => {
    let c = nextTurn(nextTurn(fight())); // Wren's turn
    c = removeCombatant(c, c.combat!.turnId!);
    expect(c.combat!.combatants.find((x) => x.id === c.combat!.turnId)!.name).toBe("Bram");
  });

  it("never shows hidden creatures, or their turns, to players or the display", () => {
    let c = nextTurn(fight()); // the hidden assassin acts first
    const [, , , combatMsg] = playerView(c, new Set(["alice"]), content);
    const wire = JSON.stringify([combatMsg, displayView(c, new Set(), content)]);
    expect(wire).not.toContain("assassin");
    expect(wire).not.toContain("59"); // creature HP is the DM's
    expect(combatMsg).toMatchObject({ t: "combat", combat: { round: 1, turnId: null } });
    expect(displayView(c, new Set(), content).combat!.order.map((x) => x.name)).toEqual(["Wren", "Bram", "Ogre"]);
    c = updateCombatant(c, "assassin", { hidden: false });
    expect(displayView(c, new Set(), content).combat!.turnId).toBe("assassin");
  });

  it("ending the combat clears it from every view", () => {
    const c = endCombat(fight());
    expect(playerView(c, new Set(["alice"]), content)[3]).toMatchObject({ t: "combat", combat: null });
  });
});
