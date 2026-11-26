/**
 * The DM's host: the one authority for a game. These are pure functions over the host's state, so the rules that
 * keep secrets and stop repeated actions can be tested without a network. The app wires them to a live link.
 */
import { CharacterImportError, derive, importCharacter, type Character, type Content } from "@mimicbox/ruleset-dnd5e";
import {
  PROTOCOL_VERSION,
  parsePlayerMessage,
  type CharacterSummary,
  type DisplayView,
  type HostMessage,
  type PartyMember,
  type PublicHandout,
  type SharedRoll,
} from "./protocol.js";

/** Rolls the host keeps; older ones drop off. */
export const ROLL_LOG_LIMIT = 100;
/** Command ids remembered per member to recognise a resent command after a reconnect. */
export const SEEN_COMMANDS_LIMIT = 500;

export interface Member {
  userId: string;
  playerName: string;
  /** The working copy of the character the player brought, as they last shared it. */
  character: Character | null;
  joinedAt: string;
}

/** A handout or note the DM writes. Hidden until revealed; hiding it again removes it from players' views. */
export interface Handout {
  id: string;
  title: string;
  body: string;
  revealed: boolean;
  revealedAt: string | null;
  createdAt: string;
}

/** Longest handout text accepted, in characters. */
export const HANDOUT_MAX_LENGTH = 20000;

/** A campaign as the DM's device stores it. */
export interface HostCampaign {
  id: string;
  name: string;
  /** Signalling room name and room key; replacing them invalidates every earlier invite link. */
  room: string;
  key: string;
  members: Record<string, Member>;
  rolls: SharedRoll[];
  /** Missing on campaigns saved before handouts. */
  handouts?: Handout[];
  /** Recently applied command ids, per member. */
  seen: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
}

export interface HostReply {
  to: string;
  msg: HostMessage;
}

export interface HostResult {
  campaign: HostCampaign;
  replies: HostReply[];
  /** True when the party or roll log changed, so every audience needs a fresh view. */
  changed: boolean;
}

const now = () => new Date().toISOString();
type WithoutVersion<T> = T extends unknown ? Omit<T, "v"> : never;
const msg = (m: WithoutVersion<HostMessage>): HostMessage => ({ ...m, v: PROTOCOL_VERSION }) as HostMessage;

export function createCampaign(input: { id: string; name: string; room: string; key: string }): HostCampaign {
  const t = now();
  return { ...input, members: {}, rolls: [], seen: {}, createdAt: t, updatedAt: t };
}

/**
 * Applies one message from a connected device. `from` is the sender's verified device identity from the link,
 * never anything inside the message. Unknown senders may only say hello with the right invite key.
 */
export function handlePlayerMessage(campaign: HostCampaign, from: string, raw: unknown, content: Content, newId: () => string): HostResult {
  const nothing: HostResult = { campaign, replies: [], changed: false };
  const m = parsePlayerMessage(raw);
  if (!m) return nothing;
  if (m.v > PROTOCOL_VERSION) {
    return { ...nothing, replies: [{ to: from, msg: msg({ t: "denied", reason: "Your app is newer than the DM's. Ask the DM to update Mimic Box." }) }] };
  }
  const member = campaign.members[from];

  if (m.t === "hello") {
    if (m.invite !== campaign.key) {
      return { ...nothing, replies: [{ to: from, msg: msg({ t: "denied", reason: "That invite link has been replaced. Ask the DM for the new one." }) }] };
    }
    const next: Member = member ? { ...member, playerName: m.playerName } : { userId: from, playerName: m.playerName, character: null, joinedAt: now() };
    return {
      campaign: touch({ ...campaign, members: { ...campaign.members, [from]: next } }),
      replies: [{ to: from, msg: msg({ t: "welcome", campaign: campaign.name, memberId: from }) }],
      changed: true,
    };
  }

  if (!member) return nothing;
  if (wasSeen(campaign, from, m.commandId)) {
    // A resend after a dropped connection: confirm it again, change nothing.
    return { ...nothing, replies: [{ to: from, msg: msg({ t: "ack", commandId: m.commandId }) }] };
  }

  if (m.t === "character") {
    let character: Character;
    try {
      character = importCharacter(m.character, content);
    } catch (e) {
      const reason = e instanceof CharacterImportError ? e.message : "The DM's app couldn't read that character.";
      return { ...nothing, replies: [{ to: from, msg: msg({ t: "denied", reason }) }] };
    }
    const next = { ...campaign, members: { ...campaign.members, [from]: { ...member, character } } };
    return { campaign: touch(remember(next, from, m.commandId)), replies: [{ to: from, msg: msg({ t: "ack", commandId: m.commandId }) }], changed: true };
  }

  // A shared roll: players' shared rolls are public at the table.
  const roll: SharedRoll = { ...m.roll, id: newId(), by: member.playerName, at: now(), visibility: "public" };
  const next = { ...campaign, rolls: [...campaign.rolls, roll].slice(-ROLL_LOG_LIMIT) };
  return { campaign: touch(remember(next, from, m.commandId)), replies: [{ to: from, msg: msg({ t: "ack", commandId: m.commandId }) }], changed: true };
}

/** The DM's own roll, public or seen by the DM only. */
export function addDmRoll(campaign: HostCampaign, roll: Omit<SharedRoll, "id" | "at">, newId: () => string): HostCampaign {
  return touch({ ...campaign, rolls: [...campaign.rolls, { ...roll, id: newId(), at: now() }].slice(-ROLL_LOG_LIMIT) });
}

/** Adds or updates a handout. New handouts start hidden. */
export function saveHandout(campaign: HostCampaign, h: Pick<Handout, "id" | "title" | "body">): HostCampaign {
  const list = campaign.handouts ?? [];
  const existing = list.find((x) => x.id === h.id);
  const next: Handout = existing
    ? { ...existing, title: h.title.slice(0, 120), body: h.body.slice(0, HANDOUT_MAX_LENGTH) }
    : { id: h.id, title: h.title.slice(0, 120), body: h.body.slice(0, HANDOUT_MAX_LENGTH), revealed: false, revealedAt: null, createdAt: now() };
  return touch({ ...campaign, handouts: existing ? list.map((x) => (x.id === h.id ? next : x)) : [...list, next] });
}

/** Shows a handout to the party and the table display, or hides it again. */
export function setHandoutRevealed(campaign: HostCampaign, id: string, revealed: boolean): HostCampaign {
  return touch({ ...campaign, handouts: (campaign.handouts ?? []).map((h) => (h.id === id ? { ...h, revealed, revealedAt: revealed ? now() : null } : h)) });
}

export function removeHandout(campaign: HostCampaign, id: string): HostCampaign {
  return touch({ ...campaign, handouts: (campaign.handouts ?? []).filter((h) => h.id !== id) });
}

/** Revealed handouts, newest reveal last. Hidden ones are never part of any view. */
export function revealedHandouts(campaign: HostCampaign): PublicHandout[] {
  return (campaign.handouts ?? [])
    .filter((h) => h.revealed && h.revealedAt)
    .sort((a, b) => a.revealedAt!.localeCompare(b.revealedAt!))
    .map((h) => ({ id: h.id, title: h.title, body: h.body, revealedAt: h.revealedAt! }));
}

/** Removes a player from the campaign. Their invite key still works until the DM replaces the link. */
export function removeMember(campaign: HostCampaign, userId: string): HostCampaign {
  const members = { ...campaign.members };
  delete members[userId];
  const seen = { ...campaign.seen };
  delete seen[userId];
  return touch({ ...campaign, members, seen });
}

/** A new room and key: every earlier invite link stops working, and members need the new link. */
export function replaceInvite(campaign: HostCampaign, room: string, key: string): HostCampaign {
  return touch({ ...campaign, room, key });
}

// ---------- what each audience sees ----------

export function summarize(character: Character, content: Content): CharacterSummary {
  const s = derive(character, content);
  return {
    name: character.name,
    classSummary: s.classSummary,
    speciesName: s.speciesName,
    level: s.level,
    hp: { current: s.hp.current, max: s.hp.max.value, temp: s.hp.temp },
    ac: s.ac.value,
    passivePerception: s.passive.perception,
    conditions: [...character.state.conditions],
    exhaustion: character.state.exhaustion,
    portrait: character.portrait,
  };
}

function party(campaign: HostCampaign, connected: ReadonlySet<string>, content: Content): PartyMember[] {
  return Object.values(campaign.members)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map((m) => ({ userId: m.userId, playerName: m.playerName, connected: connected.has(m.userId), character: m.character ? summarize(m.character, content) : null }));
}

/** Players see the party's summaries and public rolls only: never DM-only rolls or other players' full sheets. */
export function playerView(campaign: HostCampaign, connected: ReadonlySet<string>, content: Content): HostMessage[] {
  return [
    msg({ t: "party", members: party(campaign, connected, content) }),
    msg({ t: "rolls", rolls: campaign.rolls.filter((r) => r.visibility === "public").slice(-30) }),
    msg({ t: "handouts", handouts: revealedHandouts(campaign) }),
  ];
}

/** A table display sees the same as a player, and nothing it could act on. */
export function displayView(campaign: HostCampaign, connected: ReadonlySet<string>, content: Content): DisplayView {
  return {
    t: "display",
    v: PROTOCOL_VERSION,
    campaign: campaign.name,
    members: party(campaign, connected, content),
    rolls: campaign.rolls.filter((r) => r.visibility === "public").slice(-12),
    spotlight: revealedHandouts(campaign).at(-1) ?? null,
  };
}

function touch(c: HostCampaign): HostCampaign {
  return { ...c, updatedAt: now() };
}

function wasSeen(c: HostCampaign, from: string, commandId: string): boolean {
  return c.seen[from]?.includes(commandId) ?? false;
}

function remember(c: HostCampaign, from: string, commandId: string): HostCampaign {
  return { ...c, seen: { ...c.seen, [from]: [...(c.seen[from] ?? []), commandId].slice(-SEEN_COMMANDS_LIMIT) } };
}
