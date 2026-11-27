import { srdContent as content } from "@mimicbox/ruleset-dnd5e";
import { describe, expect, it } from "vitest";
import { createCampaign, exportCampaign, importCampaign, playerView, publicWorld, removeWorldEntry, saveWorldEntry, type HostCampaign } from "./index.js";

function world(): HostCampaign {
  let c = createCampaign({ id: "camp", name: "The Sunken Bell", room: "r", key: "k" });
  c = saveWorldEntry(c, { id: "port", kind: "place", title: "Port Ashen", parentId: null, revealed: true, questStatus: null, blocks: [{ id: "b1", text: "A rain-soaked harbour town.", revealed: true }] });
  c = saveWorldEntry(c, { id: "vault", kind: "place", title: "The Drowned Vault", parentId: "port", revealed: false, questStatus: null, blocks: [{ id: "b2", text: "Under the lighthouse.", revealed: false }] });
  c = saveWorldEntry(c, {
    id: "mara",
    kind: "person",
    title: "Mara the ferrywoman",
    parentId: "vault",
    revealed: true,
    questStatus: null,
    blocks: [
      { id: "b3", text: "Grey cloak, kind eyes.", revealed: true },
      { id: "b4", text: "Secretly serves the drowned god.", revealed: false },
    ],
  });
  return saveWorldEntry(c, { id: "q", kind: "quest", title: "Ring the bell", parentId: null, revealed: true, questStatus: null, blocks: [] });
}

describe("world notes", () => {
  it("show players only revealed entries and paragraphs, and never name a hidden parent", () => {
    const view = publicWorld(world());
    expect(view.map((e) => e.title)).toEqual(["Port Ashen", "Mara the ferrywoman", "Ring the bell"]);
    const mara = view.find((e) => e.id === "mara")!;
    expect(mara).toMatchObject({ parentId: null, paragraphs: ["Grey cloak, kind eyes."] });
    const wire = JSON.stringify(playerView(world(), new Set(), content, "alice"));
    expect(wire).not.toContain("drowned god");
    expect(wire).not.toContain("Drowned Vault");
    expect(wire).not.toContain("lighthouse");
  });

  it("gives quests a status, and refuses parent loops", () => {
    let c = world();
    expect(publicWorld(c).find((e) => e.id === "q")!.questStatus).toBe("active");
    c = saveWorldEntry(c, { ...c.world!.find((e) => e.id === "port")!, parentId: "mara" }); // mara sits under port: a loop
    expect(c.world!.find((e) => e.id === "port")!.parentId).toBeNull();
  });

  it("moves children up when an entry is deleted", () => {
    const c = removeWorldEntry(world(), "vault");
    expect(c.world!.find((e) => e.id === "mara")!.parentId).toBe("port");
  });

  it("survive a backup", () => {
    const back = importCampaign(JSON.parse(JSON.stringify(exportCampaign(world()))), content, { room: "r2", key: "k2" });
    expect(publicWorld(back.campaign)).toEqual(publicWorld(world()));
    expect(back.campaign.world!.find((e) => e.id === "mara")!.blocks[1]!.text).toBe("Secretly serves the drowned god.");
  });
});
