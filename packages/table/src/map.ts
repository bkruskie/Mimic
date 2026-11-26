/**
 * Battle maps: an image on a square grid, tokens on squares, and fog of war. Secrecy rule: a player or display
 * never receives pixels or tokens from squares the DM hasn't revealed. The image is cut into tiles; a tile is sent
 * only if one of its squares is revealed, and every unrevealed square inside it is painted over before it leaves
 * the DM's device. These functions decide what is allowed; the app does the pixel work.
 */
import type { HostCampaign } from "./host.js";

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
}

export interface MapScene {
  id: string;
  name: string;
  /** Image size in pixels after scaling. */
  width: number;
  height: number;
  /** Square size in pixels, and where the first full square starts. */
  grid: { size: number; offsetX: number; offsetY: number };
  /** Revealed squares, as row-major indexes (row × columns + column). */
  revealed: number[];
  tokens: Token[];
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
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const columns = (m: MapScene) => Math.max(1, Math.ceil((m.width - m.grid.offsetX) / m.grid.size));
export const rows = (m: MapScene) => Math.max(1, Math.ceil((m.height - m.grid.offsetY) / m.grid.size));
export const tileColumns = (m: Pick<MapScene, "width">) => Math.ceil(m.width / TILE_SIZE);
export const tileRows = (m: Pick<MapScene, "height">) => Math.ceil(m.height / TILE_SIZE);
const cellIndex = (m: MapScene, x: number, y: number) => y * columns(m) + x;

export function isRevealed(m: MapScene, x: number, y: number): boolean {
  return m.revealed.includes(cellIndex(m, x, y));
}

/** The pixel rectangle of a square. The edge squares include the margin before the grid offset. */
export function cellRect(m: MapScene, x: number, y: number): Rect {
  const { size, offsetX, offsetY } = m.grid;
  const left = x === 0 ? 0 : offsetX + x * size;
  const top = y === 0 ? 0 : offsetY + y * size;
  const right = Math.min(m.width, offsetX + (x + 1) * size);
  const bottom = Math.min(m.height, offsetY + (y + 1) * size);
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

const overlap = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bot = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bot > y ? { x, y, w: r - x, h: bot - y } : null;
};

/**
 * For one tile: whether it may be sent at all, and the rectangles (in tile pixels) to paint over first.
 * `version` lists the revealed squares inside the tile, so a reveal change means a fresh tile.
 */
export function tilePlan(m: MapScene, tx: number, ty: number): { send: boolean; cover: Rect[]; version: string } {
  const tile: Rect = { x: tx * TILE_SIZE, y: ty * TILE_SIZE, w: Math.min(TILE_SIZE, m.width - tx * TILE_SIZE), h: Math.min(TILE_SIZE, m.height - ty * TILE_SIZE) };
  const cover: Rect[] = [];
  const open: number[] = [];
  for (let y = 0; y < rows(m); y++) {
    for (let x = 0; x < columns(m); x++) {
      const part = overlap(cellRect(m, x, y), tile);
      if (!part) continue;
      if (isRevealed(m, x, y)) open.push(cellIndex(m, x, y));
      else cover.push({ x: part.x - tile.x, y: part.y - tile.y, w: part.w, h: part.h });
    }
  }
  return { send: open.length > 0, cover, version: open.join(".") };
}

export function publicMap(m: MapScene, viewer: string | null): PublicMap {
  const tiles: PublicMap["tiles"] = [];
  for (let ty = 0; ty < tileRows(m); ty++) {
    for (let tx = 0; tx < tileColumns(m); tx++) {
      const plan = tilePlan(m, tx, ty);
      if (plan.send) tiles.push({ tx, ty, version: plan.version });
    }
  }
  // Tokens on revealed squares, never hidden ones; a player always sees their own token.
  const tokens = m.tokens.filter((t) => (viewer !== null && t.memberId === viewer) || (!t.hidden && isRevealed(m, t.x, t.y)));
  return { id: m.id, name: m.name, width: m.width, height: m.height, grid: m.grid, tiles, tokens };
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

export function setGrid(c: HostCampaign, id: string, grid: MapScene["grid"]): HostCampaign {
  const size = Math.max(16, Math.min(400, Math.round(grid.size)));
  // Changing the grid changes what every square covers, so the fog starts over.
  return withMap(c, id, (m) => ({ ...m, grid: { size, offsetX: Math.max(0, Math.round(grid.offsetX)) % size, offsetY: Math.max(0, Math.round(grid.offsetY)) % size }, revealed: [] }));
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
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= columns(m) || y >= rows(m)) return null;
  return saveToken(c, m.id, { ...token, x, y });
}

/** The map players see, if any. */
export function activeMap(c: HostCampaign): MapScene | null {
  return (c.maps ?? []).find((m) => m.id === c.activeMapId) ?? null;
}
