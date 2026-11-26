/**
 * The messages that pass between a player's sheet, the DM's host and a table display. Everything arriving from
 * the network is untrusted: every message is parsed and checked here before anything acts on it.
 */

export const PROTOCOL_VERSION = 1 as const;

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

export interface PartyMember {
  userId: string;
  playerName: string;
  connected: boolean;
  character: CharacterSummary | null;
}

export type PlayerMessage =
  | { t: "hello"; v: number; invite: string; playerName: string }
  | { t: "character"; v: number; commandId: string; character: unknown }
  | { t: "roll"; v: number; commandId: string; roll: Pick<SharedRoll, "characterName" | "label" | "expression" | "total" | "breakdown" | "flag"> };

export type HostMessage =
  | { t: "welcome"; v: number; campaign: string; memberId: string }
  | { t: "denied"; v: number; reason: string }
  | { t: "party"; v: number; members: PartyMember[] }
  | { t: "rolls"; v: number; rolls: SharedRoll[] }
  | { t: "ack"; v: number; commandId: string };

/** What a table display receives. It never sends game commands. */
export interface DisplayView {
  t: "display";
  v: number;
  campaign: string;
  members: PartyMember[];
  rolls: SharedRoll[];
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
    case "ack":
      return id(raw.commandId) ? (raw as HostMessage) : null;
    default:
      return null;
  }
}
