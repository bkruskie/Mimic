/**
 * The DM's world: places, people, factions, quests and lore. An entry is a list of paragraphs, and each paragraph
 * has its own reveal switch, so an NPC can show players a public description while the motives stay hidden.
 * Players learn an entry exists only when the DM reveals it, and see only its revealed paragraphs.
 */
import type { HostCampaign } from "./host.js";

export const WORLD_KINDS = ["place", "person", "faction", "quest", "lore"] as const;
export type WorldKind = (typeof WORLD_KINDS)[number];
export const QUEST_STATUSES = ["active", "done", "failed"] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];
export const WORLD_TEXT_MAX = 8000;

export interface WorldBlock {
  id: string;
  text: string;
  revealed: boolean;
}

export interface WorldEntry {
  id: string;
  kind: WorldKind;
  title: string;
  /** A place this entry belongs to: a tavern in a town, a person in a city. */
  parentId: string | null;
  /** Whether players know this entry exists (its title and kind). */
  revealed: boolean;
  blocks: WorldBlock[];
  questStatus: QuestStatus | null;
  /** A portrait or picture kept on the DM's device, with its own reveal switch. */
  image?: { id: string; revealed: boolean } | null;
  updatedAt: string;
}

/** What players see of an entry. */
export interface PublicWorldEntry {
  id: string;
  kind: WorldKind;
  title: string;
  /** Only when the parent is revealed too, so a hidden place is never named. */
  parentId: string | null;
  paragraphs: string[];
  questStatus: QuestStatus | null;
  /** Sent separately in an "image" message; null unless the DM shows the picture. */
  imageId: string | null;
}

const touch = (c: HostCampaign): HostCampaign => ({ ...c, updatedAt: new Date().toISOString() });

export function saveWorldEntry(c: HostCampaign, e: Omit<WorldEntry, "updatedAt" | "image"> & { image?: WorldEntry["image"] }): HostCampaign {
  const list = c.world ?? [];
  const parentId = e.parentId && e.parentId !== e.id && list.some((x) => x.id === e.parentId) && !isDescendant(list, e.parentId, e.id) ? e.parentId : null;
  const clean: WorldEntry = {
    ...e,
    title: e.title.trim().slice(0, 120) || "Untitled",
    parentId,
    blocks: e.blocks.map((b) => ({ ...b, text: b.text.slice(0, WORLD_TEXT_MAX) })),
    questStatus: e.kind === "quest" ? e.questStatus ?? "active" : null,
    image: e.image ? { id: e.image.id, revealed: e.image.revealed === true } : null,
    updatedAt: new Date().toISOString(),
  };
  return touch({ ...c, world: list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? clean : x)) : [...list, clean] });
}

/** Deleting an entry moves its children up to its own parent. */
export function removeWorldEntry(c: HostCampaign, id: string): HostCampaign {
  const list = c.world ?? [];
  const gone = list.find((x) => x.id === id);
  return touch({ ...c, world: list.filter((x) => x.id !== id).map((x) => (x.parentId === id ? { ...x, parentId: gone?.parentId ?? null } : x)) });
}

/** True when `id` sits somewhere under `ancestor`, which would make a loop. */
function isDescendant(list: WorldEntry[], id: string, ancestor: string): boolean {
  let cur = list.find((x) => x.id === id);
  for (let guard = 0; cur && guard < 100; guard++) {
    if (cur.parentId === ancestor) return true;
    cur = list.find((x) => x.id === cur!.parentId);
  }
  return false;
}

export function publicWorld(c: HostCampaign): PublicWorldEntry[] {
  const list = c.world ?? [];
  const shown = new Set(list.filter((e) => e.revealed).map((e) => e.id));
  return list
    .filter((e) => e.revealed)
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      parentId: e.parentId && shown.has(e.parentId) ? e.parentId : null,
      paragraphs: e.blocks.filter((b) => b.revealed && b.text.trim()).map((b) => b.text),
      questStatus: e.questStatus,
      imageId: e.image?.revealed ? e.image.id : null,
    }));
}
