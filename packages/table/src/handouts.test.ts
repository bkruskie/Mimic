import { srdContent as content } from "@mimicbox/ruleset-dnd5e";
import { describe, expect, it } from "vitest";
import { createCampaign, exportCampaign, importCampaign, parseHostMessage, playerView, revealedHandouts, saveHandout, setHandoutRevealed } from "./index.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function campaign() {
  let c = createCampaign({ id: "camp", name: "The Sunken Bell", room: "r", key: "k" });
  c = saveHandout(c, { id: "letter", title: "The ferryman's letter", body: "Meet me at the docks.", imageId: "img-letter" });
  c = saveHandout(c, { id: "chart", title: "Smuggler's chart", body: "X marks the vault.", imageId: "img-chart" });
  return setHandoutRevealed(c, "letter", true);
}

describe("handout pictures", () => {
  it("name only the pictures of shown handouts", () => {
    const c = campaign();
    expect(revealedHandouts(c).map((h) => h.imageId)).toEqual(["img-letter"]);
    const wire = JSON.stringify(playerView(c, new Set(), content, "alice"));
    expect(wire).toContain("img-letter");
    expect(wire).not.toContain("img-chart");
  });

  it("keep a handout's picture when its text is edited, and drop it when asked", () => {
    let c = saveHandout(campaign(), { id: "letter", title: "The ferryman's letter", body: "Meet me at dawn.", imageId: "img-letter" });
    expect(c.handouts!.find((h) => h.id === "letter")).toMatchObject({ imageId: "img-letter", revealed: true });
    c = saveHandout(c, { id: "letter", title: "The ferryman's letter", body: "Meet me at dawn.", imageId: null });
    expect(revealedHandouts(c)[0]!.imageId).toBeNull();
  });

  it("travel in campaign backups, and a missing or broken picture leaves the text", () => {
    const file = JSON.parse(JSON.stringify(exportCampaign(campaign(), {}, { "img-letter": PNG, "img-chart": "data:text/html;base64,PGI+" })));
    const back = importCampaign(file, content, { room: "r2", key: "k2" });
    expect(back.images).toEqual({ "img-letter": PNG });
    expect(back.campaign.handouts!.find((h) => h.id === "letter")!.imageId).toBe("img-letter");
    expect(back.campaign.handouts!.find((h) => h.id === "chart")).toMatchObject({ imageId: null, body: "X marks the vault." });
  });

  it("accept only image data over the wire", () => {
    expect(parseHostMessage({ t: "image", v: 1, id: "img-letter", data: PNG })).not.toBeNull();
    expect(parseHostMessage({ t: "image", v: 1, id: "img-letter", data: "javascript:alert(1)" })).toBeNull();
  });
});
