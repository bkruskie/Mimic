/**
 * Campaign files: a DM's backup of a campaign, and the way to move it to another device. Everything in an
 * imported file is checked; characters go through the ruleset's own import checks.
 */
import { CharacterImportError, importCharacter, type Character, type Content } from "@mimicbox/ruleset-dnd5e";
import { HANDOUT_MAX_LENGTH, type Handout, type HostCampaign, type Member } from "./host.js";
import type { SharedRoll } from "./protocol.js";

export const CAMPAIGN_FORMAT = "mimicbox-campaign";
export const CAMPAIGN_FORMAT_VERSION = 1;

export interface CampaignFile {
  format: typeof CAMPAIGN_FORMAT;
  formatVersion: number;
  exportedAt: string;
  /** The campaign without its room and key: those are made fresh on import, so old invite links stay dead. */
  campaign: Omit<HostCampaign, "room" | "key" | "seen">;
}

export class CampaignImportError extends Error {}

export function exportCampaign(c: HostCampaign): CampaignFile {
  const { room: _room, key: _key, seen: _seen, ...rest } = c;
  return { format: CAMPAIGN_FORMAT, formatVersion: CAMPAIGN_FORMAT_VERSION, exportedAt: new Date().toISOString(), campaign: rest };
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Reads a campaign file. The result gets a new room and key (from `fresh`), so the DM sends players a new invite
 * link. Characters that can't be read are dropped from the party and listed in `problems`.
 */
export function importCampaign(raw: unknown, content: Content, fresh: { room: string; key: string }): { campaign: HostCampaign; problems: string[] } {
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
  const now = new Date().toISOString();
  return {
    campaign: {
      id: c.id,
      name: c.name.slice(0, 80),
      room: fresh.room,
      key: fresh.key,
      members,
      rolls,
      handouts,
      seen: {},
      createdAt: typeof c.createdAt === "string" ? c.createdAt : now,
      updatedAt: now,
    },
    problems,
  };
}
