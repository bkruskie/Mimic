/**
 * Campaign files: a DM's backup of a campaign, and the way to move it to another device. Everything in an
 * imported file is checked; characters go through the ruleset's own import checks.
 */
import { CharacterImportError, importCharacter, type Character, type Content } from "@mimicbox/ruleset-dnd5e";
import { HANDOUT_MAX_LENGTH, type Handout, type HostCampaign, type Member } from "./host.js";
import type { MapScene, Token } from "./map.js";
import { QUEST_STATUSES, WORLD_KINDS, WORLD_TEXT_MAX, type WorldEntry } from "./world.js";
import type { SharedRoll } from "./protocol.js";

export const CAMPAIGN_FORMAT = "mimicbox-campaign";
export const CAMPAIGN_FORMAT_VERSION = 1;

export interface CampaignFile {
  format: typeof CAMPAIGN_FORMAT;
  formatVersion: number;
  exportedAt: string;
  /** The campaign without its room and key: those are made fresh on import, so old invite links stay dead. */
  campaign: Omit<HostCampaign, "room" | "key" | "seen">;
  /** Map images, as tiles keyed by map id and then "tx:ty". */
  tiles?: Record<string, Record<string, string>>;
}

export class CampaignImportError extends Error {}

export function exportCampaign(c: HostCampaign, tiles?: Record<string, Record<string, string>>): CampaignFile {
  const { room: _room, key: _key, seen: _seen, ...rest } = c;
  return { format: CAMPAIGN_FORMAT, formatVersion: CAMPAIGN_FORMAT_VERSION, exportedAt: new Date().toISOString(), campaign: rest, ...(tiles ? { tiles } : {}) };
}

const num = (x: unknown, min: number, max: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;

function readMap(m: unknown): MapScene | null {
  if (!isRecord(m) || typeof m.id !== "string" || typeof m.name !== "string" || !num(m.width, 1, 8192) || !num(m.height, 1, 8192)) return null;
  const g = m.grid;
  if (!isRecord(g) || !num(g.size, 16, 400) || !num(g.offsetX, 0, 400) || !num(g.offsetY, 0, 400)) return null;
  const tokens: Token[] = (Array.isArray(m.tokens) ? m.tokens : []).filter(
    (t): t is Token => isRecord(t) && typeof t.id === "string" && typeof t.name === "string" && num(t.x, 0, 1000) && num(t.y, 0, 1000) && typeof t.color === "string",
  );
  return {
    id: m.id,
    name: m.name.slice(0, 60),
    width: m.width,
    height: m.height,
    grid: { size: g.size, offsetX: g.offsetX, offsetY: g.offsetY },
    revealed: (Array.isArray(m.revealed) ? m.revealed : []).filter((i): i is number => Number.isInteger(i) && (i as number) >= 0),
    tokens: tokens.map((t) => ({ id: t.id, name: t.name.slice(0, 40), x: t.x, y: t.y, memberId: typeof t.memberId === "string" ? t.memberId : null, hidden: t.hidden === true, color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#C9973F" })),
    walls: (Array.isArray(m.walls) ? m.walls : []).filter((i): i is number => Number.isInteger(i) && (i as number) >= 0),
    doors: (Array.isArray(m.doors) ? m.doors : []).filter((d): d is { index: number; open: boolean } => isRecord(d) && Number.isInteger(d.index) && typeof d.open === "boolean"),
    explore: isRecord(m.explore) && typeof m.explore.on === "boolean" && num(m.explore.radius, 0, 60) ? { on: m.explore.on, radius: m.explore.radius } : { on: false, radius: 0 },
  };
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Reads a campaign file. The result gets a new room and key (from `fresh`), so the DM sends players a new invite
 * link. Characters that can't be read are dropped from the party and listed in `problems`.
 */
export function importCampaign(
  raw: unknown,
  content: Content,
  fresh: { room: string; key: string },
): { campaign: HostCampaign; problems: string[]; tiles: Record<string, Record<string, string>> } {
  if (!isRecord(raw) || raw.format !== CAMPAIGN_FORMAT) throw new CampaignImportError("That file isn't a Mimic Box campaign.");
  if (typeof raw.formatVersion !== "number" || raw.formatVersion < 1) throw new CampaignImportError("The campaign file has no valid version.");
  if (raw.formatVersion > CAMPAIGN_FORMAT_VERSION) throw new CampaignImportError("This campaign was saved by a newer version of Mimic Box. Update the app to open it.");
  const c = raw.campaign;
  if (!isRecord(c) || typeof c.id !== "string" || typeof c.name !== "string" || !isRecord(c.members) || !Array.isArray(c.rolls)) {
    throw new CampaignImportError("The campaign file is incomplete, so it wasn't imported.");
  }
  const problems: string[] = [];
  const members: Record<string, Member> = {};
  for (const [userId, m] of Object.entries(c.members)) {
    if (!isRecord(m) || typeof m.playerName !== "string") continue;
    let character: Character | null = null;
    if (m.character) {
      try {
        character = importCharacter(m.character, content);
      } catch (e) {
        problems.push(`${m.playerName}'s character couldn't be read (${e instanceof CharacterImportError ? e.message : "unknown error"}). They can share it again when they join.`);
      }
    }
    members[userId] = { userId, playerName: m.playerName.slice(0, 60), character, joinedAt: typeof m.joinedAt === "string" ? m.joinedAt : new Date().toISOString() };
  }
  const rolls = c.rolls.filter(
    (r): r is SharedRoll => isRecord(r) && typeof r.id === "string" && typeof r.label === "string" && typeof r.total === "number" && (r.visibility === "public" || r.visibility === "dm"),
  );
  const handouts: Handout[] = (Array.isArray(c.handouts) ? c.handouts : [])
    .filter((h): h is Record<string, unknown> => isRecord(h) && typeof h.id === "string" && typeof h.title === "string" && typeof h.body === "string")
    .map((h) => ({
      id: h.id as string,
      title: (h.title as string).slice(0, 120),
      body: (h.body as string).slice(0, HANDOUT_MAX_LENGTH),
      revealed: h.revealed === true && typeof h.revealedAt === "string",
      revealedAt: h.revealed === true && typeof h.revealedAt === "string" ? h.revealedAt : null,
      createdAt: typeof h.createdAt === "string" ? h.createdAt : new Date().toISOString(),
    }));
  const maps = (Array.isArray(c.maps) ? c.maps : []).map(readMap).filter((m): m is MapScene => m !== null);
  const tiles: Record<string, Record<string, string>> = {};
  if (isRecord(raw.tiles)) {
    for (const m of maps) {
      const t = raw.tiles[m.id];
      if (!isRecord(t)) continue;
      tiles[m.id] = Object.fromEntries(Object.entries(t).filter(([k, v]) => /^\d+:\d+$/.test(k) && typeof v === "string" && /^data:image\/(jpeg|webp|png);base64,/.test(v))) as Record<string, string>;
    }
  }
  const world: WorldEntry[] = (Array.isArray(c.world) ? c.world : [])
    .filter((e): e is Record<string, unknown> => isRecord(e) && typeof e.id === "string" && typeof e.title === "string" && (WORLD_KINDS as readonly unknown[]).includes(e.kind))
    .map((e) => ({
      id: e.id as string,
      kind: e.kind as WorldEntry["kind"],
      title: (e.title as string).slice(0, 120),
      parentId: typeof e.parentId === "string" ? e.parentId : null,
      revealed: e.revealed === true,
      blocks: (Array.isArray(e.blocks) ? e.blocks : [])
        .filter((b): b is Record<string, unknown> => isRecord(b) && typeof b.id === "string" && typeof b.text === "string")
        .map((b) => ({ id: b.id as string, text: (b.text as string).slice(0, WORLD_TEXT_MAX), revealed: b.revealed === true })),
      questStatus: e.kind === "quest" && (QUEST_STATUSES as readonly unknown[]).includes(e.questStatus) ? (e.questStatus as WorldEntry["questStatus"]) : e.kind === "quest" ? "active" : null,
      updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : new Date().toISOString(),
    }));
  const ids = new Set(world.map((e) => e.id));
  for (const e of world) if (e.parentId && !ids.has(e.parentId)) e.parentId = null;
  const now = new Date().toISOString();
  return {
    tiles,
    campaign: {
      id: c.id,
      name: c.name.slice(0, 80),
      room: fresh.room,
      key: fresh.key,
      members,
      rolls,
      handouts,
      maps,
      world,
      activeMapId: maps.some((m) => m.id === c.activeMapId) ? (c.activeMapId as string) : null,
      seen: {},
      createdAt: typeof c.createdAt === "string" ? c.createdAt : now,
      updatedAt: now,
    },
    problems,
  };
}
