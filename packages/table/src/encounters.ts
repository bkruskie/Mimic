/**
 * Encounters the DM prepares ahead: groups of creatures, on a map, ready to run into a fight in one tap. Each group
 * keeps its creature's numbers (initiative bonus, hit points, AC), so an encounter runs without the bestiary loaded.
 * Pure functions over the campaign, like the rest of the host.
 */
import { addCombatant, startCombat, type Combatant } from "./combat.js";
import type { HostCampaign } from "./host.js";
import { columns, rows, saveToken, setActiveMap } from "./map.js";

export const ENCOUNTER_GROUP_MAX = 20;

export interface EncounterGroup {
  id: string;
  name: string;
  count: number;
  hidden: boolean;
  /** The SRD monster it came from, for its stat block; null for the DM's own creatures. */
  monsterId: string | null;
  initiativeBonus: number;
  /** Average hit points, and the formula to roll them ("3d6"), when known. */
  hp: number;
  hpFormula: string | null;
  ac: number | null;
  /** XP for one, when known. */
  xp: number;
}

export interface Encounter {
  id: string;
  name: string;
  notes: string;
  /** The map it happens on; null runs it on whatever map is on the table. */
  mapId: string | null;
  groups: EncounterGroup[];
  updatedAt: string;
}

const touch = (c: HostCampaign): HostCampaign => ({ ...c, updatedAt: new Date().toISOString() });

const cleanGroup = (g: EncounterGroup): EncounterGroup | null => {
  const name = g.name.trim().slice(0, 60);
  if (!name) return null;
  const whole = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));
  return {
    id: g.id,
    name,
    count: whole(g.count, 1, ENCOUNTER_GROUP_MAX),
    hidden: g.hidden === true,
    monsterId: g.monsterId || null,
    initiativeBonus: whole(g.initiativeBonus, -10, 30),
    hp: whole(g.hp, 1, 2000),
    hpFormula: g.hpFormula && /^[\dd+\-\s]{1,30}$/.test(g.hpFormula) ? g.hpFormula : null,
    ac: g.ac === null ? null : whole(g.ac, 0, 40),
    xp: whole(g.xp, 0, 1_000_000),
  };
};

/** Adds or replaces an encounter. Groups without a name are dropped; numbers are kept within sensible bounds. */
export function saveEncounter(c: HostCampaign, e: Omit<Encounter, "updatedAt">): HostCampaign {
  const list = c.encounters ?? [];
  const next: Encounter = {
    id: e.id,
    name: e.name.trim().slice(0, 80) || "Encounter",
    notes: e.notes.slice(0, 4000),
    mapId: e.mapId && (c.maps ?? []).some((m) => m.id === e.mapId) ? e.mapId : null,
    groups: e.groups.map(cleanGroup).filter((g): g is EncounterGroup => g !== null),
    updatedAt: new Date().toISOString(),
  };
  return touch({ ...c, encounters: list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? next : x)) : [...list, next] });
}

export function removeEncounter(c: HostCampaign, id: string): HostCampaign {
  return touch({ ...c, encounters: (c.encounters ?? []).filter((e) => e.id !== id) });
}

/** Total XP of an encounter. */
export const encounterXp = (e: Pick<Encounter, "groups">): number => e.groups.reduce((n, g) => n + g.xp * g.count, 0);

export interface EncounterDice {
  /** Rolls a d20 plus the bonus, for initiative. */
  initiative: (bonus: number) => number;
  /** Hit points for one creature of the group: rolled from its formula, or its average. */
  hp: (g: EncounterGroup) => number;
}

/**
 * Runs an encounter: shows its map if it has one, starts a fight with the party if none is running, and adds
 * every creature, numbered after any of the same name already fighting, with its token on the map.
 */
export function runEncounter(c: HostCampaign, encounterId: string, dice: EncounterDice, newId: () => string): HostCampaign {
  const e = (c.encounters ?? []).find((x) => x.id === encounterId);
  if (!e) return c;
  let next = c;
  if (e.mapId && next.activeMapId !== e.mapId) next = setActiveMap(next, e.mapId);
  if (!next.combat) next = startCombat(next, newId);
  const map = (next.maps ?? []).find((m) => m.id === next.activeMapId) ?? null;
  const names = next.combat!.combatants.map((x) => x.name);
  let slot = 0;
  for (const g of e.groups) {
    const taken = names.filter((x) => x === g.name || x.startsWith(`${g.name} `)).length;
    for (let i = 0; i < g.count; i++) {
      const name = g.count === 1 && taken === 0 ? g.name : `${g.name} ${taken + i + 1}`;
      names.push(name);
      const hp = Math.max(1, dice.hp(g));
      const combatant: Omit<Combatant, "memberId"> = {
        id: newId(),
        name,
        initiative: dice.initiative(g.initiativeBonus),
        hidden: g.hidden,
        hp: { current: hp, max: hp },
        monsterId: g.monsterId,
        ac: g.ac,
        tokenId: null,
      };
      if (map) {
        // Side by side from the middle of the map, five to a row.
        const tokenId = newId();
        const x = Math.min(columns(map) - 1, Math.floor(columns(map) / 2) + (slot % 5));
        const y = Math.min(rows(map) - 1, Math.floor(rows(map) / 2) + Math.floor(slot / 5));
        next = saveToken(next, map.id, { id: tokenId, name, x, y, memberId: null, hidden: g.hidden, color: "#D9476B" });
        combatant.tokenId = tokenId;
      }
      next = addCombatant(next, combatant);
      slot++;
    }
  }
  return next;
}

/** Encounters from a campaign file: well-formed ones only, with groups cleaned as when saved. */
export function readEncounters(raw: unknown, mapIds: readonly string[]): Encounter[] {
  if (!Array.isArray(raw)) return [];
  const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  return raw.filter(rec).flatMap((e) => {
    if (typeof e.id !== "string" || typeof e.name !== "string" || !Array.isArray(e.groups)) return [];
    const groups = e.groups.filter(rec).flatMap((g) => {
      if (typeof g.id !== "string" || typeof g.name !== "string") return [];
      const n = (v: unknown, d: number) => (typeof v === "number" ? v : d);
      const clean = cleanGroup({
        id: g.id,
        name: g.name,
        count: n(g.count, 1),
        hidden: g.hidden === true,
        monsterId: typeof g.monsterId === "string" ? g.monsterId : null,
        initiativeBonus: n(g.initiativeBonus, 0),
        hp: n(g.hp, 1),
        hpFormula: typeof g.hpFormula === "string" ? g.hpFormula : null,
        ac: typeof g.ac === "number" ? g.ac : null,
        xp: n(g.xp, 0),
      });
      return clean ? [clean] : [];
    });
    return [
      {
        id: e.id,
        name: e.name.slice(0, 80),
        notes: typeof e.notes === "string" ? e.notes.slice(0, 4000) : "",
        mapId: typeof e.mapId === "string" && mapIds.includes(e.mapId) ? e.mapId : null,
        groups,
        updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : new Date().toISOString(),
      },
    ];
  });
}
