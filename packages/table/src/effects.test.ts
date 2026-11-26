import { createCharacter, srdContent as content } from "@mimicbox/ruleset-dnd5e";
import { describe, expect, it } from "vitest";
import { applyEffect, parseHostMessage, PROTOCOL_VERSION } from "./index.js";

const v = PROTOCOL_VERSION;
const wren = () => createCharacter(content, { name: "Wren", classId: "fighter", speciesId: "human", backgroundId: "soldier" });

describe("DM effects", () => {
  it("apply damage through temporary hit points, then heal", () => {
    let c = applyEffect(wren(), content, { kind: "temp", amount: 3 });
    const max = c.state.hp;
    c = applyEffect(c, content, { kind: "damage", amount: 5 });
    expect([c.state.tempHp, c.state.hp]).toEqual([0, max - 2]);
    c = applyEffect(c, content, { kind: "heal", amount: 50 });
    expect(c.state.hp).toBe(max);
  });

  it("set conditions on and off without toggling twice", () => {
    let c = applyEffect(wren(), content, { kind: "condition", condition: "Prone", on: true });
    c = applyEffect(c, content, { kind: "condition", condition: "Prone", on: true });
    expect(c.state.conditions).toEqual(["Prone"]);
    c = applyEffect(c, content, { kind: "condition", condition: "Prone", on: false });
    expect(c.state.conditions).toEqual([]);
    expect(applyEffect(c, content, { kind: "exhaustion", level: 2 }).state.exhaustion).toBe(2);
  });

  it("accept only well-formed effects from the DM", () => {
    const ok = { t: "effect", v, effectId: "e1", effect: { kind: "damage", amount: 7 } };
    expect(parseHostMessage(ok)).toEqual(ok);
    for (const effect of [
      { kind: "damage", amount: -5 },
      { kind: "damage", amount: 1e9 },
      { kind: "condition", condition: "On fire forever", on: true },
      { kind: "exhaustion", level: 9 },
      { kind: "delete-character" },
    ]) {
      expect(parseHostMessage({ t: "effect", v, effectId: "e2", effect })).toBeNull();
    }
  });
});
