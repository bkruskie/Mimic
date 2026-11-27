/**
 * Scenes: the DM's plan for the game, in order. A scene gathers what the DM needs at that point (notes, the map
 * to show, the fight to run, handouts to give and world pages to reveal) so in play it is one tap away instead of
 * scattered across tabs. Beginning a scene shows its map; everything else stays the DM's choice to reveal.
 *
 * Scenes are DM-only: they never reach players or the display.
 */
import type { HostCampaign } from "./host.js";

export interface Scene {
  id: string;
  title: string;
  /** The DM's notes, Markdown. */
  notes: string;
  mapId: string | null;
  encounterId: string | null;
  handoutIds: string[];
  entryIds: string[];
  done: boolean;
}

export const SCENE_TITLE_MAX = 80;
export const SCENE_NOTES_MAX = 8000;
/** Each scene links at most this many handouts and world pages. */
export const SCENE_LINKS_MAX = 20;

const scenesOf = (c: HostCampaign): Scene[] => c.scenes ?? [];
const touch = (c: HostCampaign): HostCampaign => ({ ...c, updatedAt: new Date().toISOString() });
const unique = (ids: string[]) => [...new Set(ids)].slice(0, SCENE_LINKS_MAX);

function clean(s: Omit<Scene, "done"> & { done?: boolean }): Scene {
  return {
    id: s.id,
    title: s.title.trim().slice(0, SCENE_TITLE_MAX) || "Scene",
    notes: s.notes.slice(0, SCENE_NOTES_MAX),
    mapId: s.mapId,
    encounterId: s.encounterId,
    handoutIds: unique(s.handoutIds),
    entryIds: unique(s.entryIds),
    done: s.done === true,
  };
}

/** Adds a scene at the end of the plan, or updates one in place (keeping whether it is done). */
export function saveScene(c: HostCampaign, s: Omit<Scene, "done">): HostCampaign {
  const list = scenesOf(c);
  const old = list.find((x) => x.id === s.id);
  const next = clean({ ...s, done: old?.done ?? false });
  return touch({ ...c, scenes: old ? list.map((x) => (x.id === s.id ? next : x)) : [...list, next] });
}

export function removeScene(c: HostCampaign, id: string): HostCampaign {
  return touch({ ...c, scenes: scenesOf(c).filter((s) => s.id !== id), currentSceneId: c.currentSceneId === id ? null : c.currentSceneId ?? null });
}

/** Moves a scene earlier (-1) or later (+1) in the plan. */
export function moveScene(c: HostCampaign, id: string, by: -1 | 1): HostCampaign {
  const list = [...scenesOf(c)];
  const i = list.findIndex((s) => s.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return c;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return touch({ ...c, scenes: list });
}

export function setSceneDone(c: HostCampaign, id: string, done: boolean): HostCampaign {
  return touch({
    ...c,
    scenes: scenesOf(c).map((s) => (s.id === id ? { ...s, done } : s)),
    currentSceneId: done && c.currentSceneId === id ? null : c.currentSceneId ?? null,
  });
}

/** The scene being played, if any. */
export function currentScene(c: HostCampaign): Scene | null {
  return scenesOf(c).find((s) => s.id === c.currentSceneId) ?? null;
}

/** The first scene not yet played, after the current one. */
export function nextScene(c: HostCampaign): Scene | null {
  return scenesOf(c).find((s) => !s.done && s.id !== c.currentSceneId) ?? null;
}

/**
 * Plays a scene: the scene before it is marked done, and its map, if it has one that still exists, is shown to the
 * party. Its handouts, pages and fight wait for the DM.
 */
export function beginScene(c: HostCampaign, id: string): HostCampaign {
  const scene = scenesOf(c).find((s) => s.id === id);
  if (!scene) return c;
  const scenes = scenesOf(c).map((s) => (s.id === id ? { ...s, done: false } : s.id === c.currentSceneId ? { ...s, done: true } : s));
  const showMap = scene.mapId && (c.maps ?? []).some((m) => m.id === scene.mapId);
  return touch({ ...c, scenes, currentSceneId: id, ...(showMap ? { activeMapId: scene.mapId } : {}) });
}

/** Scenes from a backup file. Links to things the file doesn't hold are dropped. */
export function readScenes(raw: unknown, have: { maps: readonly string[]; encounters: readonly string[]; handouts: readonly string[]; entries: readonly string[] }): Scene[] {
  if (!Array.isArray(raw)) return [];
  const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const ids = (v: unknown, known: readonly string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && known.includes(x)) : []);
  const ref = (v: unknown, known: readonly string[]) => (typeof v === "string" && known.includes(v) ? v : null);
  const seen = new Set<string>();
  return raw.filter(rec).flatMap((s) => {
    if (typeof s.id !== "string" || typeof s.title !== "string" || seen.has(s.id)) return [];
    seen.add(s.id);
    return [
      clean({
        id: s.id,
        title: s.title,
        notes: typeof s.notes === "string" ? s.notes : "",
        mapId: ref(s.mapId, have.maps),
        encounterId: ref(s.encounterId, have.encounters),
        handoutIds: ids(s.handoutIds, have.handouts),
        entryIds: ids(s.entryIds, have.entries),
        done: s.done === true,
      }),
    ];
  });
}
