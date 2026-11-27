import { srdContent as content } from "@mimicbox/ruleset-dnd5e";
import { describe, expect, it } from "vitest";
import { campaignImageIds, createCampaign, exportCampaign, importCampaign, playerView, publicWorld, removeWorldEntry, saveWorldEntry, sharedImageIds, type HostCampaign } from "./index.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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

  it("share a picture only when both the entry and its picture are shown, and keep pictures in backups", () => {
    let c = world();
    const mara = c.world!.find((e) => e.id === "mara")!;
    c = saveWorldEntry(c, { ...mara, image: { id: "img-mara", revealed: false } });
    const vault = c.world!.find((e) => e.id === "vault")!;
    c = saveWorldEntry(c, { ...vault, image: { id: "img-vault", revealed: true } }); // the vault itself is hidden
    expect(sharedImageIds(c)).toEqual([]);
    expect(JSON.stringify(playerView(c, new Set(), content, "alice"))).not.toContain("img-");
    c = saveWorldEntry(c, { ...c.world!.find((e) => e.id === "mara")!, image: { id: "img-mara", revealed: true } });
    expect(sharedImageIds(c)).toEqual(["img-mara"]);
    expect(publicWorld(c).find((e) => e.id === "mara")!.imageId).toBe("img-mara");
    expect(campaignImageIds(c).sort()).toEqual(["img-mara", "img-vault"]);
    const file = JSON.parse(JSON.stringify(exportCampaign(c, {}, { "img-mara": PNG })));
    const back = importCampaign(file, content, { room: "r2", key: "k2" });
    expect(back.images).toEqual({ "img-mara": PNG });
    expect(back.campaign.world!.find((e) => e.id === "mara")!.image).toEqual({ id: "img-mara", revealed: true });
    expect(back.campaign.world!.find((e) => e.id === "vault")!.image).toBeNull();
  });
});
