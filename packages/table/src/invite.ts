/**
 * Invite links. Everything after "#" stays in the player's browser: it never reaches a web server or a relay.
 * It carries the room name, the room key that encrypts signalling, the DM's device identity (so the player can
 * refuse an impostor) and, for self-hosted relays, the relay address.
 */

export interface Invite {
  /** Room name on the signalling network. */
  room: string;
  /** Room key: encrypts signalling and is checked by the host when a player says hello. */
  key: string;
  /** The DM's device identity. Messages from anyone else are ignored. */
  host: string;
  campaign: string;
  /** WebSocket relay addresses, when the DM uses their own relay instead of the public networks. */
  relays?: string[];
}

const toBase64Url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

export function encodeInvite(invite: Invite): string {
  const { room, key, host, campaign, relays } = invite;
  return toBase64Url(JSON.stringify({ r: room, k: key, h: host, c: campaign, ...(relays?.length ? { w: relays } : {}) }));
}

export class InviteError extends Error {}

export function decodeInvite(code: string): Invite {
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(code.trim()));
  } catch {
    throw new InviteError("This invite link is damaged. Ask your DM to send it again.");
  }
  const r = raw as Record<string, unknown>;
  const ok = (x: unknown, max: number) => typeof x === "string" && x.length > 0 && x.length <= max;
  if (!ok(r.r, 80) || !ok(r.k, 100) || !ok(r.h, 200) || !ok(r.c, 120)) throw new InviteError("This invite link is incomplete. Ask your DM to send it again.");
  const relays = Array.isArray(r.w) ? r.w.filter((u): u is string => typeof u === "string" && /^wss?:\/\//.test(u)).slice(0, 4) : undefined;
  return { room: r.r as string, key: r.k as string, host: r.h as string, campaign: r.c as string, ...(relays?.length ? { relays } : {}) };
}

/** A random secret with 128 bits of entropy, for room names and keys. */
export function randomSecret(bytes = 16): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
