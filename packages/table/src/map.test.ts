/**
 * Fog of war: what leaves the DM's device. Mirrors the architecture's tests "Fog reveal: tiles outside the revealed
 * area never sent" and "Token walks into fog: removed from player views, position not leaked".
 */
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  TILE_SIZE,
  addMap,
  createCampaign,
  displayView,
  handlePlayerMessage,
  movePlayerToken,
  playerView,
  publicMap,
  revealAll,
  saveToken,
  setActiveMap,
  setGrid,
  setRevealed,
  tilePlan,
  type HostCampaign,
  type MapScene,
} from "./index.js";
import { srdContent as content } from "@mimicbox/ruleset-dnd5e";

const v = PROTOCOL_VERSION;
// 1100 × 600 pixels with 100-pixel squares: 11 × 6 squares, 3 × 2 tiles of 512.
const scene = (): MapScene => ({
  id: "docks",
  name: "The docks",
  width: 1100,
  height: 600,
  grid: { size: 100, offsetX: 0, offsetY: 0 },
  revealed: [],
  tokens: [
    { id: "wren", name: "Wren", x: 0, y: 0, memberId: "alice", hidden: false, color: "#7FA66B" },
    { id: "ogre", name: "Ogre", x: 8, y: 1, memberId: null, hidden: false, color: "#D9476B" },
    { id: "spy", name: "Spy", x: 1, y: 1, memberId: null, hidden: true, color: "#D9476B" },
  ],
});

function campaign(): HostCampaign {
  let c = createCampaign({ id: "camp", name: "The Sunken Bell", room: "r", key: "k" });
  c = handlePlayerMessage(c, "alice", { t: "hello", v, invite: "k", playerName: "Alice" }, content, () => "x").campaign;
  return setActiveMap(addMap(c, scene()), "docks");
}

describe("fog of war", () => {
  it("sends no tiles and no tokens but the player's own before anything is revealed", () => {
    const m = publicMap(scene(), "alice");
    expect(m.tiles).toEqual([]);
    expect(m.tokens.map((t) => t.id)).toEqual(["wren"]);
  });

  it("sends only tiles that touch a revealed square, with every other square covered", () => {
    const c = setRevealed(campaign(), "docks", [{ x: 0, y: 0 }, { x: 1, y: 0 }], true);
    const m = c.maps![0]!;
    expect(publicMap(m, "alice").tiles.map((t) => [t.tx, t.ty])).toEqual([[0, 0]]);
    const plan = tilePlan(m, 0, 0);
    // The tile holds squares 0 to 5 across and 0 to 5 down (partly); everything but the two revealed is covered.
    expect(plan.cover).not.toContainEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(plan.cover).toContainEqual({ x: 200, y: 0, w: 100, h: 100 });
    expect(plan.cover).toContainEqual({ x: 500, y: 0, w: 12, h: 100 }); // the sliver of square 5 inside this tile
    expect(tilePlan(m, 1, 0).send).toBe(false);
  });

  it("changes a tile's version when its reveal changes, so players get a fresh one", () => {
    let c = setRevealed(campaign(), "docks", [{ x: 0, y: 0 }], true);
    const before = tilePlan(c.maps![0]!, 0, 0).version;
    c = setRevealed(c, "docks", [{ x: 2, y: 2 }], true);
    expect(tilePlan(c.maps![0]!, 0, 0).version).not.toBe(before);
  });

  it("shows tokens only on revealed squares, never hidden ones", () => {
    let c = revealAll(campaign(), "docks", true);
    expect(publicMap(c.maps![0]!, "alice").tokens.map((t) => t.id)).toEqual(["wren", "ogre"]);
    c = setRevealed(c, "docks", [{ x: 8, y: 1 }], false);
    const wire = JSON.stringify(publicMap(c.maps![0]!, "alice"));
    expect(wire).not.toContain("Ogre");
    expect(wire).not.toContain("Spy");
  });

  it("reaches players and the display only for the map in play", () => {
    const c = revealAll(campaign(), "docks", true);
    const views = playerView(c, new Set(["alice"]), content, "alice");
    expect(views.find((x) => x.t === "map")).toMatchObject({ map: { id: "docks" } });
    expect(displayView(c, new Set(), content).map?.tokens.map((t) => t.id)).toEqual(["wren", "ogre"]);
    expect(playerView(setActiveMap(c, null), new Set(["alice"]), content, "alice").find((x) => x.t === "map")).toMatchObject({ map: null });
  });

  it("starts the fog over when the grid changes", () => {
    const c = setGrid(revealAll(campaign(), "docks", true), "docks", { size: 50, offsetX: 10, offsetY: 0 });
    expect(c.maps![0]!.revealed).toEqual([]);
    expect(c.maps![0]!.grid).toEqual({ size: 50, offsetX: 10, offsetY: 0 });
  });
});

describe("moving tokens", () => {
  it("lets a player move only their own token, inside the map", () => {
    const c = campaign();
    expect(movePlayerToken(c, "alice", "wren", 3, 2)?.maps![0]!.tokens[0]).toMatchObject({ x: 3, y: 2 });
    expect(movePlayerToken(c, "alice", "ogre", 3, 2)).toBeNull();
    expect(movePlayerToken(c, "alice", "wren", 11, 0)).toBeNull();
    expect(movePlayerToken(c, "alice", "wren", -1, 0)).toBeNull();
    expect(movePlayerToken(setActiveMap(c, null), "alice", "wren", 1, 1)).toBeNull();
  });

  it("goes through the host as a command, once", () => {
    let c = campaign();
    const move = { t: "move", v, commandId: "m1", tokenId: "wren", x: 2, y: 3 };
    c = handlePlayerMessage(c, "alice", move, content, () => "x").campaign;
    c = saveToken(c, "docks", { ...c.maps![0]!.tokens[0]!, x: 5, y: 5 }); // the DM moves it afterwards
    c = handlePlayerMessage(c, "alice", move, content, () => "x").campaign; // a resend
    expect(c.maps![0]!.tokens[0]).toMatchObject({ x: 5, y: 5 });
    expect(TILE_SIZE).toBe(512);
  });
});

describe("measuring, walls and exploration", async () => {
  const { canSee, cycleDoor, distanceFeet, explore, partyVision, setExplore, setWalls } = await import("./index.js");
  // A wall runs down column 4, rows 0 to 5, with a door square at row 2.
  const walled = () => {
    let c = campaign();
    c = setWalls(c, "docks", [0, 1, 3, 4, 5].map((y) => ({ x: 4, y })), true);
    return cycleDoor(c, "docks", 4, 2);
  };

  it("measures 5 feet a square, diagonals included", () => {
    expect(distanceFeet({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(15);
    expect(distanceFeet({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(15);
  });

  it("walls and closed doors block sight; an opened door lets it through", () => {
    let c = walled();
    const m = () => c.maps![0]!;
    expect(canSee(m(), { x: 0, y: 2 }, { x: 3, y: 2 })).toBe(true);
    expect(canSee(m(), { x: 0, y: 2 }, { x: 8, y: 2 })).toBe(false);
    expect(canSee(m(), { x: 0, y: 2 }, { x: 4, y: 2 })).toBe(true); // you can see the door itself
    c = cycleDoor(c, "docks", 4, 2); // open it
    expect(canSee(m(), { x: 0, y: 2 }, { x: 8, y: 2 })).toBe(true);
  });

  it("reveals what the party sees as they move, and never hides it again", () => {
    let c = setExplore(walled(), "docks", { on: true, radius: 0 });
    const revealed = () => new Set(c.maps![0]!.revealed);
    const cols = 11;
    expect(revealed().has(0 * cols + 3)).toBe(true); // Wren at 0,0 sees across the room
    expect(revealed().has(2 * cols + 8)).toBe(false); // but not past the wall
    c = movePlayerToken(c, "alice", "wren", 3, 2)!;
    c = cycleDoor(c, "docks", 4, 2); // the door opens
    expect(revealed().has(2 * cols + 8)).toBe(true);
    c = cycleDoor(c, "docks", 4, 2); // closed again: what was seen stays revealed
    expect(revealed().has(2 * cols + 8)).toBe(true);
    expect(explore(c, "docks")).toBe(c);
  });

  it("limits vision to a radius when set", () => {
    const c = setExplore(campaign(), "docks", { on: true, radius: 2 });
    expect(Math.max(...partyVision(c.maps![0]!).map((i) => i % 11))).toBe(2);
  });

  it("never sends walls or doors to players", () => {
    const wire = JSON.stringify(publicMap(revealAll(walled(), "docks", true).maps![0]!, "alice"));
    expect(wire).not.toContain("walls");
    expect(wire).not.toContain("doors");
  });
});
