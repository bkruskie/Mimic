import { srdContent as content } from "@mimicbox/ruleset-dnd5e";
import { describe, expect, it } from "vitest";
import {
  addMap,
  beginScene,
  createCampaign,
  currentScene,
  displayView,
  exportCampaign,
  importCampaign,
  logChanges,
  moveScene,
  nextScene,
  playerView,
  removeMap,
  removeScene,
  runningSession,
  saveHandout,
  saveScene,
  setSceneDone,
  startSession,
  type HostCampaign,
  type Scene,
} from "./index.js";

const scene = (id: string, title: string, extra: Partial<Scene> = {}): Omit<Scene, "done"> => ({ id, title, notes: "", mapId: null, encounterId: null, handoutIds: [], entryIds: [], ...extra });

function campaign(): HostCampaign {
  let c = createCampaign({ id: "c", name: "The Sunken Bell", room: "r", key: "k" });
  for (const id of ["docks", "vault"]) c = addMap(c, { id, name: id, width: 500, height: 500, grid: { size: 100, offsetX: 0, offsetY: 0 }, revealed: [], tokens: [] });
  c = saveHandout(c, { id: "h1", title: "Letter", body: "Meet me.", imageId: null });
  c = saveScene(c, scene("s1", "Arrival at the docks", { mapId: "docks", handoutIds: ["h1", "h1"], notes: "Mara waits by the boat." }));
  c = saveScene(c, scene("s2", "The cult's ambush"));
  c = saveScene(c, scene("s3", "Into the vault", { mapId: "vault" }));
  return c;
}

describe("scenes", () => {
  it("keep their order, move, and clean their fields", () => {
    let c = campaign();
    expect(c.scenes!.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(c.scenes![0]!.handoutIds).toEqual(["h1"]);
    c = moveScene(c, "s3", -1);
    expect(c.scenes!.map((s) => s.id)).toEqual(["s1", "s3", "s2"]);
    expect(moveScene(c, "s1", -1)).toBe(c);
    c = saveScene(c, scene("s3", "   "));
    expect(c.scenes![1]).toMatchObject({ id: "s3", title: "Scene" });
  });

  it("play in order: beginning one shows its map and marks the last one done", () => {
    let c = campaign();
    expect(nextScene(c)!.id).toBe("s1");
    c = beginScene(c, "s1");
    expect(currentScene(c)!.id).toBe("s1");
    expect(c.activeMapId).toBe("docks");
    expect(nextScene(c)!.id).toBe("s2");
    c = beginScene(c, "s2");
    // No map on this scene: the party keeps seeing the docks.
    expect(c.activeMapId).toBe("docks");
    expect(c.scenes!.find((s) => s.id === "s1")!.done).toBe(true);
    c = removeMap(c, "vault");
    c = beginScene(c, "s3");
    expect(c.activeMapId).toBe("docks");
    c = setSceneDone(c, "s3", true);
    expect(currentScene(c)).toBeNull();
    expect(nextScene(c)).toBeNull();
    // Going back to a played scene plays it again.
    c = beginScene(c, "s1");
    expect(c.scenes!.find((s) => s.id === "s1")!.done).toBe(false);
    expect(removeScene(c, "s1").currentSceneId).toBeNull();
  });

  it("stay with the DM", () => {
    const c = beginScene(campaign(), "s2");
    const wire = JSON.stringify([playerView(c, new Set(), content), displayView(c, new Set(), content)]);
    expect(wire).not.toContain("ambush");
    expect(wire).not.toContain("Mara waits");
  });

  it("mark the session log, but stay out of the recap", () => {
    let c = startSession(campaign(), "x", "2026-11-27T19:00:00.000Z");
    c = logChanges(c, beginScene(c, "s2"), "2026-11-27T19:05:00.000Z");
    expect(runningSession(c)!.events.at(-1)).toMatchObject({ kind: "scene", text: "Scene: The cult's ambush." });
  });

  it("survive a backup, dropping links to things that aren't in it", () => {
    let c = beginScene(campaign(), "s1");
    const raw = JSON.parse(JSON.stringify(exportCampaign(c)));
    raw.campaign.scenes.push({ id: "s4", title: "Lost", mapId: "gone", encounterId: "gone", handoutIds: ["h1", "gone"], entryIds: ["gone"] }, { id: "s4", title: "Twin" }, { title: "No id" });
    c = importCampaign(raw, content, { room: "r2", key: "k2" }).campaign;
    expect(c.scenes!.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(c.scenes![3]).toMatchObject({ mapId: null, encounterId: null, handoutIds: ["h1"], entryIds: [] });
    expect(c.currentSceneId).toBe("s1");
  });
});
