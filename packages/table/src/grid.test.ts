import { describe, expect, it } from "vitest";
import { addMap, canSee, cellAt, cellCentre, cellDistance, cellPolygon, columns, createCampaign, distanceFeet, rows, setGrid, setRevealed, setWalls, tilePlan, type GridKind, type MapScene } from "./index.js";

const map = (kind: GridKind, size = 60): MapScene => ({
  id: "m",
  name: "Hexes",
  width: 1100,
  height: 600,
  grid: { size, offsetX: 0, offsetY: 0, kind },
  revealed: [],
  tokens: [],
});

describe.each(["square", "hex-rows", "hex-columns"] as GridKind[])("%s grid", (kind) => {
  it("finds every cell from its own centre, and from near its centre", () => {
    const m = map(kind);
    for (let y = 0; y < rows(m); y++) {
      for (let x = 0; x < columns(m); x++) {
        const c = cellCentre(m, x, y);
        expect(cellAt(m, c.x, c.y)).toEqual({ x, y });
        expect(cellAt(m, c.x + 10, c.y - 10)).toEqual({ x, y });
      }
    }
  });

  it("counts a neighbour as one step, 5 feet", () => {
    const m = map(kind);
    const centre = { x: 4, y: 4 };
    const c = cellCentre(m, 4, 4);
    // Every cell whose centre is one cell-width away is a neighbour.
    for (let deg = 0; deg < 360; deg += 60) {
      const a = ((deg + (kind === "hex-columns" ? 30 : 0)) * Math.PI) / 180;
      const n = cellAt(m, c.x + 60 * Math.cos(a), c.y + 60 * Math.sin(a));
      if (kind === "square") continue;
      expect(cellDistance(m, centre, n)).toBe(1);
      expect(distanceFeet(centre, n, m)).toBe(5);
    }
    expect(cellDistance(m, centre, centre)).toBe(0);
  });
});

describe("hex grids", () => {
  it("have six corners per cell, and fit the image", () => {
    const m = map("hex-rows");
    expect(cellPolygon(m, 3, 3)).toHaveLength(6);
    expect(columns(m)).toBe(Math.ceil(1100 / 60));
    expect(rows(m)).toBe(Math.ceil(600 / (1.5 * (60 / Math.sqrt(3)))));
  });

  it("measure straight lines along a row and across rows", () => {
    const m = map("hex-rows");
    expect(cellDistance(m, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(5);
    expect(cellDistance(m, { x: 0, y: 0 }, { x: 0, y: 4 })).toBe(4); // zig-zags down the rows
    // Odd rows sit half a hex to the right, so (2, 2) touches (1, 3) and (2, 3) below it.
    expect(cellDistance(m, { x: 2, y: 2 }, { x: 1, y: 3 })).toBe(1);
    expect(cellDistance(m, { x: 2, y: 2 }, { x: 2, y: 3 })).toBe(1);
    expect(cellDistance(m, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(2);
  });

  it("keep only revealed hex outlines in a tile, and paint the rest", () => {
    let c = addMap(createCampaign({ id: "c", name: "C", room: "r", key: "k" }), map("hex-rows"));
    c = setRevealed(c, "m", [{ x: 1, y: 1 }], true);
    const plan = tilePlan(c.maps![0]!, 0, 0);
    expect(plan.send).toBe(true);
    expect(plan.keep).toHaveLength(1);
    expect(plan.keep[0]).toHaveLength(6);
    expect(tilePlan(c.maps![0]!, 1, 0).send).toBe(false);
  });

  it("block sight through a wall hex", () => {
    let c = addMap(createCampaign({ id: "c", name: "C", room: "r", key: "k" }), map("hex-rows"));
    expect(canSee(c.maps![0]!, { x: 0, y: 2 }, { x: 6, y: 2 })).toBe(true);
    c = setWalls(c, "m", [{ x: 3, y: 2 }], true);
    expect(canSee(c.maps![0]!, { x: 0, y: 2 }, { x: 6, y: 2 })).toBe(false);
    expect(canSee(c.maps![0]!, { x: 0, y: 2 }, { x: 0, y: 5 })).toBe(true);
  });

  it("start the fog over when the grid changes, and keep tokens on the map", () => {
    let c = addMap(createCampaign({ id: "c", name: "C", room: "r", key: "k" }), { ...map("square"), tokens: [{ id: "t", name: "T", x: 17, y: 9, memberId: null, hidden: false, color: "#000000" }] });
    c = setRevealed(c, "m", [{ x: 1, y: 1 }], true);
    c = setGrid(c, "m", { size: 100, offsetX: 250, offsetY: 0, kind: "hex-columns" });
    const m = c.maps![0]!;
    expect(m.grid).toEqual({ size: 100, offsetX: 50, offsetY: 0, kind: "hex-columns" });
    expect(m.revealed).toEqual([]);
    expect(m.tokens[0]!.x).toBeLessThan(columns(m));
    expect(m.tokens[0]!.y).toBeLessThan(rows(m));
  });
});
