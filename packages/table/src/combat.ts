/**
 * Initiative and turns. The DM's host keeps the whole order, including hidden creatures; players and the table
 * display get only what they may see. Pure functions over the campaign, like the rest of the host.
 */
import type { HostCampaign } from "./host.js";

export interface Combatant {
  id: string;
  name: string;
  /** null until rolled or entered. */
  initiative: number | null;
  /** Player characters point at the member who controls them. */
  memberId: string | null;
  /** Hidden creatures are in the DM's order only. */
  hidden: boolean;
  /** DM-only hit points for creatures; player characters' HP live on their sheets. */
  hp: { current: number; max: number } | null;
  /** The creature's token on the map, when it has one. Player characters use their own token. */
  tokenId?: string | null;
  /** The SRD monster it was added from, for its stat block. DM-only, like its AC. */
  monsterId?: string | null;
  ac?: number | null;
}

export interface Combat {
  round: number;
  /** The combatant whose turn it is, or null before the first turn. */
  turnId: string | null;
  combatants: Combatant[];
}

/** What players and the display see of a combat. */
export interface PublicCombat {
  round: number;
  /** null while a hidden creature is acting, so players can't tell it exists. */
  turnId: string | null;
  order: { id: string; name: string; initiative: number | null; memberId: string | null }[];
}

/** Highest initiative first; ties keep the order they were added; unrolled combatants wait at the end. */
export function initiativeOrder(combatants: Combatant[]): Combatant[] {
  return combatants
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (b.c.initiative ?? -Infinity) - (a.c.initiative ?? -Infinity) || a.i - b.i)
    .map((x) => x.c);
}

const touch = (c: HostCampaign): HostCampaign => ({ ...c, updatedAt: new Date().toISOString() });
const withCombat = (c: HostCampaign, combat: Combat | null): HostCampaign => touch({ ...c, combat });

/** Starts a combat with every party member who has shared a character. */
export function startCombat(campaign: HostCampaign, newId: () => string): HostCampaign {
  const combatants: Combatant[] = Object.values(campaign.members)
    .filter((m) => m.character)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map((m) => ({ id: newId(), name: m.character!.name, initiative: null, memberId: m.userId, hidden: false, hp: null }));
  return withCombat(campaign, { round: 1, turnId: null, combatants });
}

export function endCombat(campaign: HostCampaign): HostCampaign {
  return withCombat(campaign, null);
}

export function addCombatant(campaign: HostCampaign, c: Omit<Combatant, "memberId">): HostCampaign {
  if (!campaign.combat) return campaign;
  return withCombat(campaign, { ...campaign.combat, combatants: [...campaign.combat.combatants, { ...c, memberId: null }] });
}

export function updateCombatant(campaign: HostCampaign, id: string, patch: Partial<Omit<Combatant, "id" | "memberId">>): HostCampaign {
  if (!campaign.combat) return campaign;
  return withCombat(campaign, { ...campaign.combat, combatants: campaign.combat.combatants.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

export function removeCombatant(campaign: HostCampaign, id: string): HostCampaign {
  const combat = campaign.combat;
  if (!combat) return campaign;
  let turnId = combat.turnId;
  if (turnId === id) {
    // Hand the turn to whoever comes next.
    const order = initiativeOrder(combat.combatants);
    const i = order.findIndex((c) => c.id === id);
    turnId = order.length > 1 ? order[(i + 1) % order.length]!.id : null;
  }
  return withCombat(campaign, { ...combat, turnId, combatants: combat.combatants.filter((c) => c.id !== id) });
}

/** Moves to the next turn in initiative order, starting a new round after the last combatant. */
export function nextTurn(campaign: HostCampaign): HostCampaign {
  const combat = campaign.combat;
  if (!combat || combat.combatants.length === 0) return campaign;
  const order = initiativeOrder(combat.combatants);
  if (combat.turnId === null) return withCombat(campaign, { ...combat, turnId: order[0]!.id });
  const i = order.findIndex((c) => c.id === combat.turnId);
  const wraps = i === -1 || i === order.length - 1;
  return withCombat(campaign, { ...combat, round: wraps ? combat.round + 1 : combat.round, turnId: order[wraps ? 0 : i + 1]!.id });
}

export function previousTurn(campaign: HostCampaign): HostCampaign {
  const combat = campaign.combat;
  if (!combat || combat.turnId === null) return campaign;
  const order = initiativeOrder(combat.combatants);
  const i = order.findIndex((c) => c.id === combat.turnId);
  if (i <= 0) {
    if (combat.round <= 1) return withCombat(campaign, { ...combat, turnId: null });
    return withCombat(campaign, { ...combat, round: combat.round - 1, turnId: order.at(-1)!.id });
  }
  return withCombat(campaign, { ...combat, turnId: order[i - 1]!.id });
}

/** A player sets the initiative of their own character only. Returns null when there is nothing to set. */
export function setMemberInitiative(campaign: HostCampaign, memberId: string, initiative: number): HostCampaign | null {
  const combat = campaign.combat;
  const own = combat?.combatants.find((c) => c.memberId === memberId);
  if (!combat || !own || own.initiative !== null) return null;
  return updateCombatant(campaign, own.id, { initiative });
}

export function publicCombat(campaign: HostCampaign): PublicCombat | null {
  const combat = campaign.combat;
  if (!combat) return null;
  const visible = initiativeOrder(combat.combatants).filter((c) => !c.hidden);
  return {
    round: combat.round,
    turnId: visible.some((c) => c.id === combat.turnId) ? combat.turnId : null,
    order: visible.map((c) => ({ id: c.id, name: c.name, initiative: c.initiative, memberId: c.memberId })),
  };
}

/** The map token of whoever's turn it is: a player's own token, or the creature's linked token. */
export function actingTokenId(campaign: HostCampaign): string | null {
  const combat = campaign.combat;
  const acting = combat?.combatants.find((c) => c.id === combat.turnId);
  if (!acting) return null;
  const map = (campaign.maps ?? []).find((m) => m.id === campaign.activeMapId);
  if (!map) return null;
  if (acting.memberId) return map.tokens.find((t) => t.memberId === acting.memberId)?.id ?? null;
  return acting.tokenId && map.tokens.some((t) => t.id === acting.tokenId) ? acting.tokenId : null;
}
