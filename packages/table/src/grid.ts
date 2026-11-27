/**
 * Grid geometry for battle maps: squares, hexes in rows (pointy tops, odd rows shifted right) and hexes in columns
 * (flat tops, odd columns shifted down). Cells are addressed by column x and row y on every grid, so fog, walls,
 * doors and tokens are stored the same way whatever the grid.
 *
 * For squares, `size` is the side of a square. For hexes it is the distance between neighbouring hex centres
 * along a row (hexes in rows) or a column (hexes in columns), which is what a DM measures on the image.
 */

export type GridKind = "square" | "hex-rows" | "hex-columns";
export const GRID_KINDS: readonly GridKind[] = ["square", "hex-rows", "hex-columns"];

export interface Grid {
  size: number;
  offsetX: number;
  offsetY: number;
  /** Missing on maps saved before hex grids: square. */
  kind?: GridKind;
}

/** Just what geometry needs from a map. */
export interface GridMap {
  width: number;
  height: number;
  grid: Grid;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SQRT3 = Math.sqrt(3);
export const gridKind = (m: GridMap): GridKind => m.grid.kind ?? "square";
const isHex = (m: GridMap) => gridKind(m) !== "square";

/*
 * Hexes in columns are hexes in rows with x and y swapped, so the hex maths is written once, for rows, in a frame
 * where u runs along the row and v down the rows. `frame` converts a map into that frame.
 */
interface Frame {
  s: number;
  /** Hex radius: centre to corner. */
  r: number;
  ou: number;
  ov: number;
  lenU: number;
  lenV: number;
  swap: boolean;
}
function frame(m: GridMap): Frame {
  const swap = gridKind(m) === "hex-columns";
  const s = m.grid.size;
  return {
    s,
    r: s / SQRT3,
    ou: swap ? m.grid.offsetY : m.grid.offsetX,
    ov: swap ? m.grid.offsetX : m.grid.offsetY,
    lenU: swap ? m.height : m.width,
    lenV: swap ? m.width : m.height,
    swap,
  };
}
const toMap = (f: Frame, u: number, v: number): Point => (f.swap ? { x: v, y: u } : { x: u, y: v });
const fromMap = (f: Frame, p: Point): { u: number; v: number } => (f.swap ? { u: p.y, v: p.x } : { u: p.x, v: p.y });
const hexCentre = (f: Frame, cu: number, cv: number) => ({ u: f.ou + f.s / 2 + cu * f.s + (cv & 1 ? f.s / 2 : 0), v: f.ov + f.r + cv * 1.5 * f.r });

/** Columns of cells across the map. */
export function columns(m: GridMap): number {
  if (!isHex(m)) return Math.max(1, Math.ceil((m.width - m.grid.offsetX) / m.grid.size));
  const f = frame(m);
  return Math.max(1, f.swap ? Math.ceil((f.lenV - f.ov) / (1.5 * f.r)) : Math.ceil((f.lenU - f.ou) / f.s));
}

/** Rows of cells down the map. */
export function rows(m: GridMap): number {
  if (!isHex(m)) return Math.max(1, Math.ceil((m.height - m.grid.offsetY) / m.grid.size));
  const f = frame(m);
  return Math.max(1, f.swap ? Math.ceil((f.lenU - f.ou) / f.s) : Math.ceil((f.lenV - f.ov) / (1.5 * f.r)));
}

/** The pixel rectangle of a square. The edge squares include the margin before the grid offset. */
export function cellRect(m: GridMap, x: number, y: number): Rect {
  const { size, offsetX, offsetY } = m.grid;
  const left = x === 0 ? 0 : offsetX + x * size;
  const top = y === 0 ? 0 : offsetY + y * size;
  const right = Math.min(m.width, offsetX + (x + 1) * size);
  const bottom = Math.min(m.height, offsetY + (y + 1) * size);
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

/** The centre of a cell, in image pixels. */
export function cellCentre(m: GridMap, x: number, y: number): Point {
  if (!isHex(m)) return { x: m.grid.offsetX + (x + 0.5) * m.grid.size, y: m.grid.offsetY + (y + 0.5) * m.grid.size };
  const f = frame(m);
  const { u: cu, v: cv } = fromMap(f, { x, y });
  const c = hexCentre(f, cu, cv);
  return toMap(f, c.u, c.v);
}

/** The outline of a cell, in image pixels. Squares at the edges include the margin, as in `cellRect`. */
export function cellPolygon(m: GridMap, x: number, y: number): Point[] {
  if (!isHex(m)) {
    const r = cellRect(m, x, y);
    return [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ];
  }
  const f = frame(m);
  const { u: cu, v: cv } = fromMap(f, { x, y });
  const c = hexCentre(f, cu, cv);
  return [-90, -30, 30, 90, 150, 210].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return toMap(f, c.u + f.r * Math.cos(a), c.v + f.r * Math.sin(a));
  });
}

/** The bounding box of a cell, clipped to the image. */
export function cellBounds(m: GridMap, x: number, y: number): Rect {
  if (!isHex(m)) return cellRect(m, x, y);
  const pts = cellPolygon(m, x, y);
  const left = Math.max(0, Math.min(...pts.map((p) => p.x)));
  const top = Math.max(0, Math.min(...pts.map((p) => p.y)));
  const right = Math.min(m.width, Math.max(...pts.map((p) => p.x)));
  const bottom = Math.min(m.height, Math.max(...pts.map((p) => p.y)));
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

const clampCell = (m: GridMap, x: number, y: number): Point => ({ x: Math.max(0, Math.min(columns(m) - 1, x)), y: Math.max(0, Math.min(rows(m) - 1, y)) });

/** The cell under a point in image pixels, clamped to the map's cells. */
export function cellAt(m: GridMap, px: number, py: number): Point {
  if (!isHex(m)) {
    const { size, offsetX, offsetY } = m.grid;
    return clampCell(m, px < offsetX ? 0 : Math.floor((px - offsetX) / size), py < offsetY ? 0 : Math.floor((py - offsetY) / size));
  }
  const f = frame(m);
  const p = fromMap(f, { x: px, y: py });
  // Pixel to axial coordinates, rounded in cube coordinates, then back to offset rows.
  const du = p.u - f.ou - f.s / 2;
  const dv = p.v - f.ov - f.r;
  const q = ((SQRT3 / 3) * du - dv / 3) / f.r;
  const r = ((2 / 3) * dv) / f.r;
  let [rq, rr, rs] = [Math.round(q), Math.round(r), Math.round(-q - r)];
  const [eq, er, es] = [Math.abs(rq - q), Math.abs(rr - r), Math.abs(rs + q + r)];
  if (eq > er && eq > es) rq = -rr - rs;
  else if (er > es) rr = -rq - rs;
  const cu = rq + (rr - (rr & 1)) / 2;
  const cell = toMap(f, cu, rr);
  return clampCell(m, cell.x, cell.y);
}

const axial = (m: GridMap, c: Point) => {
  const f = frame(m);
  const { u, v } = fromMap(f, c);
  return { q: u - (v - (v & 1)) / 2, r: v };
};

/**
 * Steps between two cells. On squares a diagonal step counts as one (the SRD's rule); on hexes every neighbour
 * is one step.
 */
export function cellDistance(m: GridMap, a: Point, b: Point): number {
  if (!isHex(m)) return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const p = axial(m, a);
  const q = axial(m, b);
  const dq = p.q - q.q;
  const dr = p.r - q.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** An SVG path of every cell outline, for drawing hex grids in one element. */
export function gridPath(m: GridMap): string {
  const parts: string[] = [];
  for (let y = 0; y < rows(m); y++) {
    for (let x = 0; x < columns(m); x++) parts.push(polygonPath(cellPolygon(m, x, y)));
  }
  return parts.join("");
}

export const polygonPath = (pts: Point[]) => `M${pts.map((p) => `${round(p.x)} ${round(p.y)}`).join("L")}Z`;
const round = (n: number) => Math.round(n * 10) / 10;
