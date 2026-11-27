/**
 * The messages that pass between a player's sheet, the DM's host and a table display. Everything arriving from
 * the network is untrusted: every message is parsed and checked here before anything acts on it.
 */

export const PROTOCOL_VERSION = 1 as const;

import type { PublicCombat } from "./combat.js";
import { parseEffect, type Effect } from "./effects.js";
import type { PublicMap } from "./map.js";
import type { PublicWorldEntry } from "./world.js";

/** Largest message accepted from a player: a character file with a small portrait fits comfortably. */
export const MAX_MESSAGE_BYTES = 256 * 1024;

export interface SharedRoll {
  id: string;
  /** The player's or DM's display name. */
  by: string;
  characterName: string;
  label: string;
  expression: string;
  total: number;
  breakdown: string;
  flag?: "crit" | "fumble";
  at: string;
  /** "dm" rolls are seen by the DM only: they never reach players or displays. */
  visibility: "public" | "dm";
}

/** What players and displays may see of a character: no notes, inventory or private details. */
export interface CharacterSummary {
  name: string;
  classSummary: string;
  speciesName: string;
  level: number;
  hp: { current: number; max: number; temp: number };
  ac: number;
  passivePerception: number;
  conditions: string[];
  exhaustion: number;
  portrait: string | null;
}

/** A handout as players see it: only revealed ones are ever sent. */
export interface PublicHandout {
  id: string;
  title: string;
  /** Markdown text. */
  body: string;
  /** The handout's picture, sent separately in an "image" message; null when it has none. */
  imageId: string | null;
  revealedAt: string;
}

export interface PartyMember {
  userId: string;
  playerName: string;
  connected: boolean;
  character: CharacterSummary | null;
}

export type PlayerMessage =
  | { t: "hello"; v: number; invite: string; playerName: string }
  | { t: "character"; v: number; commandId: string; character: unknown }
  | { t: "roll"; v: number; commandId: string; roll: Pick<SharedRoll, "characterName" | "label" | "expression" | "total" | "breakdown" | "flag"> }
  | { t: "initiative"; v: number; commandId: string; total: number }
  | { t: "move"; v: number; commandId: string; tokenId: string; x: number; y: number }
  | { t: "door"; v: number; commandId: string; x: number; y: number };

export type HostMessage =
  | { t: "welcome"; v: number; campaign: string; memberId: string }
  | { t: "denied"; v: number; reason: string }
  | { t: "party"; v: number; members: PartyMember[] }
  | { t: "rolls"; v: number; rolls: SharedRoll[] }
  | { t: "handouts"; v: number; handouts: PublicHandout[] }
  | { t: "combat"; v: number; combat: PublicCombat | null }
  | { t: "effect"; v: number; effectId: string; effect: Effect }
  | { t: "map"; v: number; map: PublicMap | null }
  | { t: "world"; v: number; entries: PublicWorldEntry[] }
  /** One map tile, already painted over where the fog is. */
  /** A picture for a revealed handout, sent once per connection. */
  | { t: "image"; v: number; id: string; data: string }
  | { t: "tile"; v: number; mapId: string; tx: number; ty: number; version: string; data: string }
  | { t: "ack"; v: number; commandId: string };

/** What a table display receives. It never sends game commands. */
export interface DisplayView {
  t: "display";
  v: number;
  campaign: string;
  members: PartyMember[];
  rolls: SharedRoll[];
  /** The most recently revealed handout, shown large on the table. */
  spotlight: PublicHandout | null;
  combat: PublicCombat | null;
  map: PublicMap | null;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown, max = 200): x is string => typeof x === "string" && x.length <= max;
const id = (x: unknown): x is string => typeof x === "string" && /^[\w-]{1,64}$/.test(x);

export function messageSize(raw: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(raw)).length;
  } catch {
    return Infinity;
  }
}

/** Returns the message if it is a well-formed player message, otherwise null. */
export function parsePlayerMessage(raw: unknown): PlayerMessage | null {
  if (!isRecord(raw) || typeof raw.v !== "number" || messageSize(raw) > MAX_MESSAGE_BYTES) return null;
  switch (raw.t) {
    case "hello":
      return str(raw.invite, 100) && str(raw.playerName, 60) ? { t: "hello", v: raw.v, invite: raw.invite, playerName: raw.playerName.trim() || "Player" } : null;
    case "character":
      return id(raw.commandId) && isRecord(raw.character) ? { t: "character", v: raw.v, commandId: raw.commandId, character: raw.character } : null;
    case "roll": {
      const r = raw.roll;
      if (!id(raw.commandId) || !isRecord(r)) return null;
      if (!str(r.characterName, 80) || !str(r.label, 120) || !str(r.expression, 80) || !str(r.breakdown, 400) || typeof r.total !== "number" || !Number.isFinite(r.total)) return null;
      const flag = r.flag === "crit" || r.flag === "fumble" ? r.flag : undefined;
      return {
        t: "roll",
        v: raw.v,
        commandId: raw.commandId,
        roll: { characterName: r.characterName, label: r.label, expression: r.expression, total: r.total, breakdown: r.breakdown, ...(flag ? { flag } : {}) },
      };
    }
    case "move":
      return id(raw.commandId) && id(raw.tokenId) && Number.isInteger(raw.x) && Number.isInteger(raw.y)
        ? { t: "move", v: raw.v, commandId: raw.commandId, tokenId: raw.tokenId, x: raw.x as number, y: raw.y as number }
        : null;
    case "door":
      return id(raw.commandId) && Number.isInteger(raw.x) && Number.isInteger(raw.y) ? { t: "door", v: raw.v, commandId: raw.commandId, x: raw.x as number, y: raw.y as number } : null;
    case "initiative":
      return id(raw.commandId) && typeof raw.total === "number" && Number.isInteger(raw.total) && Math.abs(raw.total) <= 100
        ? { t: "initiative", v: raw.v, commandId: raw.commandId, total: raw.total }
        : null;
    default:
      return null;
  }
}

/** Returns the message if it is a well-formed host message, otherwise null. */
export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isRecord(raw) || typeof raw.v !== "number") return null;
  switch (raw.t) {
    case "welcome":
      return str(raw.campaign) && str(raw.memberId) ? (raw as HostMessage) : null;
    case "denied":
      return str(raw.reason, 300) ? (raw as HostMessage) : null;
    case "party":
      return Array.isArray(raw.members) ? (raw as HostMessage) : null;
    case "rolls":
      return Array.isArray(raw.rolls) ? (raw as HostMessage) : null;
    case "handouts":
      return Array.isArray(raw.handouts) ? (raw as HostMessage) : null;
    case "world":
      return Array.isArray(raw.entries) ? (raw as HostMessage) : null;
    case "map":
      return raw.map === null || (isRecord(raw.map) && Array.isArray(raw.map.tiles) && Array.isArray(raw.map.tokens)) ? (raw as HostMessage) : null;
    case "image":
      return str(raw.id, 64) && typeof raw.data === "string" && raw.data.length <= 4_000_000 && /^data:image\/(jpeg|webp|png);base64,/.test(raw.data) ? (raw as HostMessage) : null;
    case "tile":
      return str(raw.mapId, 64) && Number.isInteger(raw.tx) && Number.isInteger(raw.ty) && typeof raw.version === "string" && typeof raw.data === "string" && /^data:image\/(jpeg|webp|png);base64,/.test(raw.data)
        ? (raw as HostMessage)
        : null;
    case "effect": {
      const effect = parseEffect(raw.effect);
      return id(raw.effectId) && effect ? { t: "effect", v: raw.v, effectId: raw.effectId, effect } : null;
    }
    case "combat":
      return raw.combat === null || (isRecord(raw.combat) && Array.isArray(raw.combat.order)) ? (raw as HostMessage) : null;
    case "ack":
      return id(raw.commandId) ? (raw as HostMessage) : null;
    default:
      return null;
  }
}
