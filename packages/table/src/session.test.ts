import { describe, expect, it } from "vitest";
import {
  addCombatant,
  addDmRoll,
  addLogNote,
  addMap,
  createCampaign,
  draftRecap,
  endCombat,
  endSession,
  exportCampaign,
  importCampaign,
  logChanges,
  nextTurn,
  playerView,
  removeSession,
  revealedHandouts,
  runningSession,
  saveHandout,
  saveRecap,
  saveWorldEntry,
  sessionLength,
  setHandoutRevealed,
  shareRecap,
  startCombat,
  startSession,
  updateCombatant,
  SESSION_LOG_LIMIT,
  type HostCampaign,
} from "./index.js";
import { srdContent as content } from "@mimicbox/ruleset-dnd5e";

let n = 0;
const newId = () => `id${++n}`;
const T0 = "2026-11-27T19:00:00.000Z";
const T1 = "2026-11-27T21:10:00.000Z";

function campaign(): HostCampaign {
  let c = createCampaign({ id: "c", name: "The Sunken Bell", room: "r", key: "k" });
  c = addMap(c, { id: "docks", name: "Docks", width: 1000, height: 600, grid: { size: 100, offsetX: 0, offsetY: 0 }, revealed: [], tokens: [] });
  c = saveHandout(c, { id: "h1", title: "A wet letter", body: "Meet me at the bell.", imageId: null });
  c = saveWorldEntry(c, { id: "w1", kind: "person", title: "Mother Ilse", parentId: null, revealed: false, questStatus: null, blocks: [{ id: "b1", text: "A priest.", revealed: true }, { id: "b2", text: "Secretly a smuggler.", revealed: false }] });
  return c;
}

/** Applies a change the way the studio does: through the log. */
const step = (c: HostCampaign, fn: (c: HostCampaign) => HostCampaign, at = T0) => logChanges(c, fn(c), at);
const texts = (c: HostCampaign) => runningSession(c)!.events.map((e) => e.text);

describe("sessions", () => {
  it("start numbered, one at a time, and log nothing when none is running", () => {
    let c = campaign();
    expect(step(c, (x) => ({ ...x, activeMapId: "docks" })).sessions ?? []).toEqual([]);
    c = startSession(c, "s1", T0);
    expect(runningSession(c)).toMatchObject({ id: "s1", number: 1, endedAt: null });
    expect(startSession(c, "s2", T0)).toBe(c);
    c = endSession(c, T1);
    expect(runningSession(c)).toBeNull();
    c = startSession(c, "s2", T1);
    expect(runningSession(c)!.number).toBe(2);
  });

  it("log what players saw: the map, a fight, creatures falling, handouts and pages", () => {
    let c = startSession(campaign(), "s1", T0);
    c = step(c, (x) => ({ ...x, activeMapId: "docks" }));
    c = step(c, (x) => startCombat(x, newId));
    c = step(c, (x) => addCombatant(x, { id: "g1", name: "Goblin 1", initiative: 12, hidden: false, hp: { current: 7, max: 7 } }));
    c = step(c, (x) => addCombatant(x, { id: "boss", name: "Goblin Boss", initiative: 14, hidden: true, hp: { current: 21, max: 21 } }));
    for (let i = 0; i < 3; i++) c = step(c, nextTurn);
    c = step(c, (x) => updateCombatant(x, "g1", { hp: { current: 0, max: 7 } }));
    c = step(c, (x) => updateCombatant(x, "boss", { hp: { current: 0, max: 21 } }));
    c = step(c, endCombat);
    c = step(c, (x) => setHandoutRevealed(x, "h1", true));
    c = step(c, (x) => saveWorldEntry(x, { ...x.world![0]!, revealed: true }));
    c = step(c, (x) => saveWorldEntry(x, { ...x.world![0]!, blocks: x.world![0]!.blocks.map((b) => ({ ...b, revealed: true })) }));
    const log = texts(c);
    expect(log).toContain("The party moved to Docks.");
    expect(log).toContain("Goblin 1 joined the fight.");
    expect(log).toContain("Goblin 1 fell.");
    expect(log).toContain("The party received “A wet letter”.");
    expect(log).toContain("The party learned of Mother Ilse.");
    expect(log).toContain("The party learned more about Mother Ilse.");
    expect(log.some((t) => /^The fight ended/.test(t))).toBe(true);
    // The hidden boss never appears.
    expect(log.join(" ")).not.toContain("Boss");
  });

  it("log public rolls and keep the DM's secret rolls out", () => {
    let c = startSession(campaign(), "s1", T0);
    const roll = { by: "DM", characterName: "", label: "Stealth", expression: "1d20+2", total: 22, breakdown: "20+2", flag: "crit" as const };
    c = step(c, (x) => addDmRoll(x, { ...roll, visibility: "public" }, newId));
    c = step(c, (x) => addDmRoll(x, { ...roll, label: "Ambush check", visibility: "dm" }, newId));
    expect(texts(c)).toContain("DM rolled Stealth: 22 (natural 20).");
    expect(texts(c).join(" ")).not.toContain("Ambush");
    expect(runningSession(c)!.events.at(-1)).toMatchObject({ kind: "roll", flag: "crit" });
  });

  it("log a player joining", () => {
    let c = startSession(campaign(), "s1", T0);
    c = step(c, (x) => ({ ...x, members: { ...x.members, u1: { userId: "u1", playerName: "Sam", character: null, joinedAt: T0 } } }));
    expect(texts(c)).toEqual(["Session 1 started."]);
    const character = { name: "Bram Hollis" } as NonNullable<HostCampaign["members"][string]["character"]>;
    c = step(c, (x) => ({ ...x, members: { ...x.members, u1: { ...x.members.u1!, character } } }));
    c = step(c, (x) => ({ ...x, members: { ...x.members, u1: { ...x.members.u1!, character: { ...character } } } }));
    expect(texts(c)).toEqual(["Session 1 started.", "Sam joined as Bram Hollis."]);
  });

  it("keep the log to its limit", () => {
    let c = startSession(campaign(), "s1", T0);
    for (let i = 0; i < SESSION_LOG_LIMIT + 20; i++) c = addLogNote(c, `Note ${i}`, T0);
    expect(runningSession(c)!.events).toHaveLength(SESSION_LOG_LIMIT);
    expect(texts(c).at(-1)).toBe(`Note ${SESSION_LOG_LIMIT + 19}`);
    expect(addLogNote(c, "   ", T0)).toBe(c);
  });

  it("draft a recap on ending, without the routine lines, and keep one the DM wrote", () => {
    let c = startSession(campaign(), "s1", T0);
    c = step(c, (x) => ({ ...x, activeMapId: "docks" }));
    c = step(c, (x) => startCombat(x, newId));
    c = step(c, (x) => addCombatant(x, { id: "g1", name: "Goblin 1", initiative: 12, hidden: false, hp: { current: 7, max: 7 } }));
    c = step(c, nextTurn);
    c = step(c, nextTurn);
    c = step(c, (x) => addDmRoll(x, { by: "DM", characterName: "", label: "Attack", expression: "1d20", total: 1, breakdown: "1", flag: "fumble", visibility: "public" }, newId));
    c = step(c, (x) => addDmRoll(x, { by: "DM", characterName: "", label: "Damage", expression: "1d6", total: 4, breakdown: "4", visibility: "public" }, newId));
    c = addLogNote(c, "Ilse gave them a key.", T0);
    c = endSession(c, T1);
    const recap = c.sessions![0]!.recap;
    expect(recap).toContain("Played for 2 h 10 min.");
    expect(recap).toContain("- The party moved to Docks.");
    expect(recap).toContain("- Ilse gave them a key.");
    expect(recap).toContain("## Rolls to remember\n\n- DM rolled Attack: 1 (natural 1).");
    expect(recap).not.toContain("Damage");
    expect(recap).not.toContain("Round");
    // The goblin added after the fight began is folded into its opening line.
    expect(recap).toContain("- A fight began: Goblin 1.");
    expect(recap).not.toContain("joined the fight");
    expect(recap).not.toContain("Session 1 started");

    let d = saveRecap(startSession(campaign(), "s1", T0), "s1", "My own words.");
    d = endSession(d, T1);
    expect(d.sessions![0]!.recap).toBe("My own words.");
  });

  it("say when nothing was logged, and measure length", () => {
    const c = endSession(startSession(campaign(), "s1", T0), "2026-11-27T19:45:00.000Z");
    expect(draftRecap(c.sessions![0]!)).toContain("Nothing was logged");
    expect(sessionLength(c.sessions![0]!)).toBe("45 min");
    expect(sessionLength({ ...c.sessions![0]!, endedAt: "2026-11-27T21:00:00.000Z" })).toBe("2 h");
  });

  it("share the recap as a handout, and update the same handout when shared again", () => {
    let c = endSession(startSession(campaign(), "s1", T0), T1);
    c = saveRecap(c, "s1", "They found the bell.");
    c = shareRecap(c, "s1", "rh");
    expect(revealedHandouts(c).find((h) => h.id === "rh")).toMatchObject({ title: "Session 1 recap", body: "They found the bell." });
    c = saveRecap(c, "s1", "They found the bell, and rang it.");
    c = shareRecap(c, "s1", "other");
    expect(c.handouts!.filter((h) => h.title === "Session 1 recap")).toHaveLength(1);
    expect(c.handouts!.find((h) => h.id === "rh")!.body).toContain("rang it");
    expect(shareRecap(saveRecap(c, "s1", "  "), "s1", "x").handouts!.some((h) => h.id === "x")).toBe(false);
  });

  it("stay off the wire until shared", () => {
    let c = endSession(startSession(campaign(), "s1", T0), T1);
    c = saveRecap(c, "s1", "A secret summary.");
    expect(JSON.stringify(playerView(c, new Set(), content))).not.toContain("secret summary");
    expect(removeSession(c, "s1").sessions).toEqual([]);
  });

  it("survive a backup, dropping malformed entries and extra running sessions", () => {
    let c = startSession(campaign(), "s1", T0);
    c = addLogNote(c, "A note.", T0);
    c = endSession(c, T1);
    c = startSession(c, "s2", T1);
    const file = exportCampaign(c);
    const raw = JSON.parse(JSON.stringify(file));
    raw.campaign.sessions.push({ id: "bad", number: 0, startedAt: T0 }, { id: "s3", number: 3, startedAt: T1, endedAt: null, events: [{ at: T1, kind: "nonsense", text: "x" }], handoutId: "missing" });
    const back = importCampaign(raw, content, { room: "r2", key: "k2" }).campaign;
    expect(back.sessions!.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(back.sessions![0]!.events.map((e) => e.text)).toContain("A note.");
    expect(back.sessions!.filter((s) => s.endedAt === null)).toHaveLength(1);
    expect(back.sessions![2]).toMatchObject({ events: [], handoutId: null });
  });
});
