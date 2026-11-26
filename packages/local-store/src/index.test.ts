import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { Vault, type RollEntry } from "./index.js";

let n = 0;
const open = () => Vault.open(indexedDB, `test-${++n}`);
const doc = (id: string, name: string, updatedAt: string) => ({ id, ruleset: "dnd5e-2024", name, updatedAt, payload: { hp: 10 } });

let vault: Vault | null = null;
afterEach(() => vault?.close());

describe("Vault", () => {
  it("saves, lists newest first and reloads documents", async () => {
    vault = await open();
    await vault.put(doc("a", "Wren", "2026-01-01T00:00:00Z"), "Rogue 1");
    await vault.put(doc("b", "Oryn", "2026-02-01T00:00:00Z"), "Fighter 2");
    const list = await vault.list();
    expect(list.map((e) => e.name)).toEqual(["Oryn", "Wren"]);
    expect((await vault.get("a"))?.doc).toEqual(doc("a", "Wren", "2026-01-01T00:00:00Z"));
  });

  it("overwrites on save", async () => {
    vault = await open();
    await vault.put(doc("a", "Wren", "2026-01-01T00:00:00Z"), "Rogue 1");
    await vault.put(doc("a", "Wren Ashdown", "2026-01-02T00:00:00Z"), "Rogue 2");
    const list = await vault.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.summary).toBe("Rogue 2");
  });

  it("moves deleted characters to the trash and restores them", async () => {
    vault = await open();
    await vault.put(doc("a", "Wren", "2026-01-01T00:00:00Z"), "Rogue 1");
    await vault.remove("a");
    expect(await vault.list()).toEqual([]);
    expect((await vault.trash()).map((t) => t.id)).toEqual(["a"]);
    await vault.restore("a");
    expect((await vault.list()).map((e) => e.id)).toEqual(["a"]);
    expect(await vault.trash()).toEqual([]);
  });

  it("keeps a capped roll history per character, newest first", async () => {
    vault = await open();
    const roll = (i: number, characterId = "a"): RollEntry => ({
      id: `${characterId}-${i}`,
      characterId,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      label: `Roll ${i}`,
      expression: "1d20",
      total: i,
      breakdown: `[${i}] = ${i}`,
    });
    for (let i = 0; i < 205; i++) await vault.addRoll(roll(i));
    await vault.addRoll(roll(1, "b"));
    const rolls = await vault.rolls("a", 500);
    expect(rolls).toHaveLength(200);
    expect(rolls[0]?.label).toBe("Roll 204");
    expect(await vault.rolls("b")).toHaveLength(1);
    await vault.clearRolls("a");
    expect(await vault.rolls("a")).toEqual([]);
  });

  it("stores settings", async () => {
    vault = await open();
    await vault.setSetting("theme", "dark");
    expect(await vault.getSetting("theme")).toBe("dark");
  });

  it("purges a trashed character with its rolls", async () => {
    vault = await open();
    await vault.put(doc("a", "Wren", "2026-01-01T00:00:00Z"), "Rogue 1");
    await vault.addRoll({ id: "r1", characterId: "a", at: "2026-01-01T00:00:00Z", label: "x", expression: "1d20", total: 3, breakdown: "" });
    await vault.remove("a");
    await vault.purge("a");
    expect(await vault.trash()).toEqual([]);
    expect(await vault.rolls("a")).toEqual([]);
  });
});
