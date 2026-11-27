/**
 * Battle maps: an image on a grid of squares or hexes (see grid.ts), tokens on cells, and fog of war. Secrecy rule: a player or display
 * never receives pixels or tokens from squares the DM hasn't revealed. The image is cut into tiles; a tile is sent
 * only if one of its squares is revealed, and every unrevealed square inside it is painted over before it leaves
 * the DM's device. These functions decide what is allowed; the app does the pixel work.
 */
import { cellAt, cellBounds, cellCentre, cellDistance, cellPolygon, columns, GRID_KINDS, isGridless, rows, tokenCell, type Grid, type GridKind, type Point, type Rect } from "./grid.js";
import type { HostCampaign } from "./host.js";

export { cellRect, columns, rows } from "./grid.js";

/** Tile edge in image pixels. */
export const TILE_SIZE = 512;
/** Longest image edge kept, in pixels: big enough for a table, small enough for phones. */
export const MAX_MAP_EDGE = 4096;

export interface Token {
  id: string;
  name: string;
  /** Square column and row. */
  x: number;
  y: number;
  /** A player's own token: they may move it. */
  memberId: string | null;
  /** Hidden tokens are on the DM's map only. */
  hidden: boolean;
  color: string;
  /** Light the token carries, as how far it reaches in squares (bright and dim together). 0 or absent: none. */
  light?: number;
  /** How far the token sees with no light, in squares. Party tokens only matter. */
  darkvision?: number;
}

/** A light on the map: a brazier, a lamp, a glowing pool. */
export interface Light {
  id: string;
  x: number;
  y: number;
  /** How far it reaches, in squares. */
  radius: number;
}

/** The longest reach of a light or of darkvision, in squares. */
export const LIGHT_MAX = 30;

export interface MapScene {
  id: string;
  name: string;
  /** Image size in pixels after scaling. */
  width: number;
  height: number;
  /** Cell size in pixels, where the first full cell starts, and the kind of grid. */
  grid: Grid;
  /** Revealed squares, as row-major indexes (row × columns + column). */
  revealed: number[];
  tokens: Token[];
  /** Squares that block sight, as row-major indexes. The DM's only: never sent. */
  walls?: number[];
  /** Doors block sight while closed. The DM's only: never sent. */
  doors?: { index: number; open: boolean }[];
  /** Reveal squares as the party's tokens come to see them. radius 0 means no limit. */
  explore?: { on: boolean; radius: number };
  /** Labelled pins, each on a layer: the DM's own, or the players' (shown once its cell is revealed). */
  pins?: Pin[];
  /**
   * A dark map: the party sees only squares that light reaches, or that are within a character's darkvision.
   * Squares seen before stay on players' maps, dimmed, and creatures on them aren't sent.
   */
  dark?: boolean;
  /** Lights placed on the map. Their positions are the DM's: players see only what they light. */
  lights?: Light[];
}

/** Map layers a pin can sit on. */
export const PIN_LAYERS = ["dm", "players"] as const;
export type PinLayer = (typeof PIN_LAYERS)[number];
export const PIN_TEXT_MAX = 40;

/** A labelled marker on a cell: a trap or an ambush on the DM's layer, an exit or a meeting point on the players'. */
export interface Pin {
  id: string;
  x: number;
  y: number;
  label: string;
  layer: PinLayer;
}

/** What a player or display receives about the map in play. */
export interface PublicMap {
  id: string;
  name: string;
  width: number;
  height: number;
  grid: MapScene["grid"];
  /** Tiles they may have, with a version that changes when the reveal inside the tile changes. */
  tiles: { tx: number; ty: number; version: string }[];
  tokens: Token[];
  /** Doors on revealed squares: players can see them, and open or close the ones next to their token. */
  doors: { x: number; y: number; open: boolean }[];
  /** The token whose turn it is in combat, if the audience can see it. */
  activeTokenId: string | null;
  /** Pins on the players' layer, on revealed cells. The DM's layer is never sent. */
  pins: { id: string; x: number; y: number; label: string }[];
  /** On a dark map, the revealed squares the party can see right now; the rest are drawn dimmed. null: not dark. */
  seen: number[] | null;
}

export const tileColumns = (m: Pick<MapScene, "width">) => Math.ceil(m.width / TILE_SIZE);
export const tileRows = (m: Pick<MapScene, "height">) => Math.ceil(m.height / TILE_SIZE);
const cellIndex = (m: MapScene, x: number, y: number) => y * columns(m) + x;

export function isRevealed(m: MapScene, x: number, y: number): boolean {
  return m.revealed.includes(cellIndex(m, x, y));
}

const overlap = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bot = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bot > y ? { x, y, w: r - x, h: bot - y } : null;
};

/**
 * For one tile: whether it may be sent at all, and the outlines (in tile pixels) of the revealed cells in it.
 * Everything else in the tile is painted over before it is sent, including any margin outside every cell.
 * `version` lists the revealed cells inside the tile, so a reveal change means a fresh tile.
 */
export function tilePlan(m: MapScene, tx: number, ty: number): { send: boolean; keep: Point[][]; version: string } {
  const tile: Rect = { x: tx * TILE_SIZE, y: ty * TILE_SIZE, w: Math.min(TILE_SIZE, m.width - tx * TILE_SIZE), h: Math.min(TILE_SIZE, m.height - ty * TILE_SIZE) };
  const keep: Point[][] = [];
  const open: number[] = [];
  const shown = new Set(m.revealed);
  for (let y = 0; y < rows(m); y++) {
    for (let x = 0; x < columns(m); x++) {
      if (!shown.has(cellIndex(m, x, y)) || !overlap(cellBounds(m, x, y), tile)) continue;
      open.push(cellIndex(m, x, y));
      keep.push(cellPolygon(m, x, y).map((p) => ({ x: p.x - tile.x, y: p.y - tile.y })));
    }
  }
  return { send: open.length > 0, keep, version: open.join(".") };
}

export function publicMap(m: MapScene, viewer: string | null, activeTokenId: string | null = null): PublicMap {
  const tiles: PublicMap["tiles"] = [];
  for (let ty = 0; ty < tileRows(m); ty++) {
    for (let tx = 0; tx < tileColumns(m); tx++) {
      const plan = tilePlan(m, tx, ty);
      if (plan.send) tiles.push({ tx, ty, version: plan.version });
    }
  }
  // On a dark map, what the party sees now: revealed squares that light or darkvision reaches.
  const revealedSet = new Set(m.revealed);
  const seen = m.dark ? partyVision(m).filter((i) => revealedSet.has(i)).sort((a, b) => a - b) : null;
  const seenSet = seen ? new Set(seen) : null;
  // Tokens on revealed squares (on a dark map, squares seen now), never hidden ones; a player always sees their own
  // token, and the party sees each other.
  const tokens = m.tokens.filter((t) => {
    if (viewer !== null && t.memberId === viewer) return true;
    if (t.hidden) return false;
    const { x, y } = tokenCell(t);
    if (!isRevealed(m, x, y)) return false;
    return !seenSet || t.memberId !== null || seenSet.has(cellIndex(m, x, y));
  });
  const cols = columns(m);
  const doors = (m.doors ?? [])
    .map((d) => ({ x: d.index % cols, y: Math.floor(d.index / cols), open: d.open }))
    .filter((d) => isRevealed(m, d.x, d.y));
  return {
    id: m.id,
    name: m.name,
    width: m.width,
    height: m.height,
    grid: m.grid,
    tiles,
    tokens,
    doors,
    activeTokenId: activeTokenId && tokens.some((t) => t.id === activeTokenId) ? activeTokenId : null,
    pins: (m.pins ?? []).filter((p) => p.layer === "players" && isRevealed(m, p.x, p.y)).map(({ id, x, y, label }) => ({ id, x, y, label })),
    seen,
  };
}

// ---------- changes ----------

const touch = (c: HostCampaign): HostCampaign => ({ ...c, updatedAt: new Date().toISOString() });
const withMap = (c: HostCampaign, id: string, fn: (m: MapScene) => MapScene): HostCampaign =>
  touch({ ...c, maps: (c.maps ?? []).map((m) => (m.id === id ? fn(m) : m)) });

export function addMap(c: HostCampaign, m: MapScene): HostCampaign {
  return touch({ ...c, maps: [...(c.maps ?? []), m] });
}

export function removeMap(c: HostCampaign, id: string): HostCampaign {
  return touch({ ...c, maps: (c.maps ?? []).filter((m) => m.id !== id), activeMapId: c.activeMapId === id ? null : c.activeMapId ?? null });
}

/** Which map players and the display see; null shows none. */
export function setActiveMap(c: HostCampaign, id: string | null): HostCampaign {
  return touch({ ...c, activeMapId: id });
}

export function setGrid(c: HostCampaign, id: string, grid: Grid): HostCampaign {
  const size = Math.max(16, Math.min(400, Math.round(grid.size)));
  const kind: GridKind = GRID_KINDS.includes(grid.kind as GridKind) ? (grid.kind as GridKind) : "square";
  // A hex grid's pattern repeats every two cells across its shifted direction.
  const period = kind === "hex-rows" || kind === "hex-columns" ? size * 2 : size;
  const offset = (n: number) => Math.max(0, Math.round(n)) % period;
  // Changing the grid changes what every cell covers, so the fog, walls and doors start over; tokens are kept
  // on cells that still exist.
  return withMap(c, id, (m) => {
    const next = { ...m, grid: { size, offsetX: offset(grid.offsetX), offsetY: offset(grid.offsetY), kind }, revealed: [], walls: [], doors: [] };
    const fit = (t: Token) => ({ ...t, x: Math.min(t.x, columns(next) - 1), y: Math.min(t.y, rows(next) - 1) });
    return { ...next, tokens: next.tokens.map(fit) };
  });
}

export function setRevealed(c: HostCampaign, id: string, cells: { x: number; y: number }[], revealed: boolean): HostCampaign {
  return withMap(c, id, (m) => {
    const set = new Set(m.revealed);
    for (const { x, y } of cells) {
      if (x < 0 || y < 0 || x >= columns(m) || y >= rows(m)) continue;
      if (revealed) set.add(cellIndex(m, x, y));
      else set.delete(cellIndex(m, x, y));
    }
    return { ...m, revealed: [...set].sort((a, b) => a - b) };
  });
}

export function revealAll(c: HostCampaign, id: string, revealed: boolean): HostCampaign {
  return withMap(c, id, (m) => ({ ...m, revealed: revealed ? Array.from({ length: columns(m) * rows(m) }, (_, i) => i) : [] }));
}

export function saveToken(c: HostCampaign, mapId: string, t: Token): HostCampaign {
  return withMap(c, mapId, (m) => ({ ...m, tokens: m.tokens.some((x) => x.id === t.id) ? m.tokens.map((x) => (x.id === t.id ? t : x)) : [...m.tokens, t] }));
}

export function removeToken(c: HostCampaign, mapId: string, tokenId: string): HostCampaign {
  return withMap(c, mapId, (m) => ({ ...m, tokens: m.tokens.filter((t) => t.id !== tokenId) }));
}

/**
 * A player moves a token. Allowed only for their own token, on the map in play, to a square inside the map.
 * Returns null when the move is refused.
 */
export function movePlayerToken(c: HostCampaign, memberId: string, tokenId: string, x: number, y: number): HostCampaign | null {
  const m = (c.maps ?? []).find((s) => s.id === c.activeMapId);
  const token = m?.tokens.find((t) => t.id === tokenId);
  if (!m || !token || token.memberId !== memberId) return null;
  // Whole cells, except on a map with no grid, where a token stands anywhere (to 1/100 of a cell).
  const ok = (n: number) => (isGridless(m) ? Number.isFinite(n) && Math.round(n * 100) === n * 100 : Number.isInteger(n));
  if (!ok(x) || !ok(y) || x < 0 || y < 0 || x > columns(m) - 1 || y > rows(m) - 1) return null;
  return explore(saveToken(c, m.id, { ...token, x, y }), m.id);
}

/** The map players see, if any. */
export function activeMap(c: HostCampaign): MapScene | null {
  return (c.maps ?? []).find((m) => m.id === c.activeMapId) ?? null;
}

// ---------- walls, doors, measuring and exploration ----------

/** Feet per cell. On squares a diagonal step costs the same as a straight one (the SRD's rule). */
export const FEET_PER_SQUARE = 5;

/** Distance in feet between two cells. Without a map, the cells are squares. */
export function distanceFeet(a: Point, b: Point, m?: Pick<MapScene, "width" | "height" | "grid">): number {
  const steps = m ? cellDistance(m, a, b) : Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  return Math.round(steps * FEET_PER_SQUARE);
}

const blocks = (m: MapScene, i: number) => (m.walls ?? []).includes(i) || (m.doors ?? []).some((d) => d.index === i && !d.open);

/**
 * Whether square `to` can be seen from square `from`: a straight line between their centres, sampled finely, must
 * not pass through a wall square or a closed door. The squares at either end don't block (you see the wall itself).
 */
export function canSee(m: MapScene, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const cols = columns(m);
  if ((m.grid.kind ?? "square") !== "square") {
    // Hexes: sample the line between the two centres in pixels, four samples per cell crossed.
    const a = cellCentre(m, from.x, from.y);
    const b = cellCentre(m, to.x, to.y);
    const n = Math.max(1, cellDistance(m, from, to) * 4);
    for (let s = 1; s < n; s++) {
      const c = cellAt(m, a.x + ((b.x - a.x) * s) / n, a.y + ((b.y - a.y) * s) / n);
      if ((c.x === from.x && c.y === from.y) || (c.x === to.x && c.y === to.y)) continue;
      if (blocks(m, c.y * cols + c.x)) return false;
    }
    return true;
  }
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * 4;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = Math.floor(from.x + 0.5 + (to.x - from.x) * t);
    const y = Math.floor(from.y + 0.5 + (to.y - from.y) * t);
    if ((x === from.x && y === from.y) || (x === to.x && y === to.y)) continue;
    if (blocks(m, y * cols + x)) return false;
  }
  return true;
}

/**
 * Squares that light reaches: within each light's reach, from the map's lights and from tokens carrying one, and
 * not behind a wall or closed door from it.
 */
export function litCells(m: MapScene): Set<number> {
  const cols = columns(m);
  const sources = [...(m.lights ?? []), ...m.tokens.filter((t) => (t.light ?? 0) > 0).map((t) => ({ ...tokenCell(t), radius: t.light! }))];
  const out = new Set<number>();
  for (const l of sources) {
    const r = Math.ceil(l.radius);
    for (let y = Math.max(0, l.y - r * 2); y <= Math.min(rows(m) - 1, l.y + r * 2); y++) {
      for (let x = Math.max(0, l.x - r * 2); x <= Math.min(cols - 1, l.x + r * 2); x++) {
        const i = y * cols + x;
        if (out.has(i) || cellDistance(m, l, { x, y }) > l.radius) continue;
        if (canSee(m, l, { x, y })) out.add(i);
      }
    }
  }
  return out;
}

/**
 * Squares the party's tokens can see, within `radius` squares (or the whole map when radius is 0). On a dark map a
 * square must also be lit, or within the token's darkvision.
 */
export function partyVision(m: MapScene): number[] {
  const cols = columns(m);
  const radius = m.explore?.radius ?? 0;
  const lit = m.dark ? litCells(m) : null;
  const out = new Set<number>();
  for (const token of m.tokens.filter((x) => x.memberId)) {
    const t = tokenCell(token);
    const dark = token.darkvision ?? 0;
    for (let y = 0; y < rows(m); y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (out.has(i)) continue;
        const d = cellDistance(m, t, { x, y });
        if (radius && d > radius) continue;
        if (lit && !lit.has(i) && d > dark) continue;
        if (canSee(m, t, { x, y })) out.add(i);
      }
    }
  }
  return [...out];
}

/** With exploration on, adds what the party can now see to the revealed squares. Nothing is hidden again. */
export function explore(c: HostCampaign, mapId: string): HostCampaign {
  const m = (c.maps ?? []).find((s) => s.id === mapId);
  if (!m?.explore?.on) return c;
  const seen = partyVision(m);
  if (seen.every((i) => m.revealed.includes(i))) return c;
  return withMap(c, mapId, (s) => ({ ...s, revealed: [...new Set([...s.revealed, ...seen])].sort((a, b) => a - b) }));
}

const reach = (n: number) => Math.max(0, Math.min(LIGHT_MAX, Math.round(n)));

/** Makes a map dark or lit. */
export function setDark(c: HostCampaign, mapId: string, dark: boolean): HostCampaign {
  return explore(withMap(c, mapId, (m) => ({ ...m, dark })), mapId);
}

/** Puts a light on a square, or takes away the one already there. */
export function toggleLight(c: HostCampaign, mapId: string, light: Light): HostCampaign {
  return explore(
    withMap(c, mapId, (m) => {
      const lights = m.lights ?? [];
      const here = lights.find((l) => l.x === light.x && l.y === light.y);
      return { ...m, lights: here ? lights.filter((l) => l !== here) : [...lights, { ...light, radius: reach(light.radius) || 1 }] };
    }),
    mapId,
  );
}

/** Sets the light a token carries and how far it sees in the dark. */
export function setTokenSight(c: HostCampaign, mapId: string, tokenId: string, sight: { light?: number; darkvision?: number }): HostCampaign {
  return explore(
    withMap(c, mapId, (m) => ({
      ...m,
      tokens: m.tokens.map((t) => {
        if (t.id !== tokenId) return t;
        const next = { ...t, ...(sight.light !== undefined ? { light: reach(sight.light) } : {}), ...(sight.darkvision !== undefined ? { darkvision: reach(sight.darkvision) } : {}) };
        if (!next.light) delete next.light;
        if (!next.darkvision) delete next.darkvision;
        return next;
      }),
    })),
    mapId,
  );
}

export function setExplore(c: HostCampaign, mapId: string, settings: { on: boolean; radius: number }): HostCampaign {
  const next = withMap(c, mapId, (m) => ({ ...m, explore: { on: settings.on, radius: Math.max(0, Math.min(60, Math.round(settings.radius))) } }));
  return explore(next, mapId);
}

/** Adds or removes wall squares. A wall replaces any door on the same square. */
export function setWalls(c: HostCampaign, mapId: string, cells: { x: number; y: number }[], wall: boolean): HostCampaign {
  return withMap(c, mapId, (m) => {
    const cols = columns(m);
    const idx = cells.filter(({ x, y }) => x >= 0 && y >= 0 && x < cols && y < rows(m)).map(({ x, y }) => y * cols + x);
    const walls = new Set(m.walls ?? []);
    for (const i of idx) wall ? walls.add(i) : walls.delete(i);
    // Painting walls or erasing both clear any door on those squares.
    const doors = (m.doors ?? []).filter((d) => !idx.includes(d.index));
    return { ...m, walls: [...walls].sort((a, b) => a - b), doors };
  });
}

/** Clicking a square with the door tool: adds a closed door, then opens and closes it. */
export function cycleDoor(c: HostCampaign, mapId: string, x: number, y: number): HostCampaign {
  const next = withMap(c, mapId, (m) => {
    const i = y * columns(m) + x;
    const doors = m.doors ?? [];
    const door = doors.find((d) => d.index === i);
    return {
      ...m,
      walls: (m.walls ?? []).filter((w) => w !== i),
      doors: door ? doors.map((d) => (d.index === i ? { ...d, open: !d.open } : d)) : [...doors, { index: i, open: false }],
    };
  });
  return explore(next, mapId);
}

/**
 * A player opens or closes a door. Allowed only on the map in play, for a door on a revealed square that is next to
 * (or under) the player's own token. Returns null when refused.
 */
export function togglePlayerDoor(c: HostCampaign, memberId: string, x: number, y: number): HostCampaign | null {
  const m = activeMap(c);
  if (!m || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  const i = y * columns(m) + x;
  const door = (m.doors ?? []).find((d) => d.index === i);
  const own = m.tokens.find((t) => t.memberId === memberId);
  // Next to the token: one step, or with no grid within a cell and a half (a diagonal neighbour).
  if (!door || !own || !isRevealed(m, x, y) || cellDistance(m, own, { x, y }) > (isGridless(m) ? 1.5 : 1)) return null;
  return explore(withMap(c, m.id, (s) => ({ ...s, doors: (s.doors ?? []).map((d) => (d.index === i ? { ...d, open: !d.open } : d)) })), m.id);
}

// ---------- pins ----------

/** Adds a pin, or replaces the one already on that cell and layer. Empty labels are refused. */
export function placePin(c: HostCampaign, mapId: string, pin: Pin): HostCampaign {
  const label = pin.label.trim().slice(0, PIN_TEXT_MAX);
  if (!label || !PIN_LAYERS.includes(pin.layer)) return c;
  return withMap(c, mapId, (m) => {
    if (!Number.isInteger(pin.x) || !Number.isInteger(pin.y) || pin.x < 0 || pin.y < 0 || pin.x >= columns(m) || pin.y >= rows(m)) return m;
    const others = (m.pins ?? []).filter((p) => !(p.x === pin.x && p.y === pin.y && p.layer === pin.layer));
    return { ...m, pins: [...others, { ...pin, label }] };
  });
}

export function removePin(c: HostCampaign, mapId: string, pinId: string): HostCampaign {
  return withMap(c, mapId, (m) => ({ ...m, pins: (m.pins ?? []).filter((p) => p.id !== pinId) }));
}
