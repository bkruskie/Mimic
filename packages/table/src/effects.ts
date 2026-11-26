/**
 * Changes the DM makes to a player's character during play: damage, healing, temporary hit points, conditions and
 * Exhaustion. The character still lives on the player's device; the DM sends an effect, the player's app applies
 * it with the ruleset's own operations, and the updated sheet comes back as usual.
 */
import { CONDITIONS, applyDamage, heal, setExhaustion, setTempHp, type Character, type Content } from "@mimicbox/ruleset-dnd5e";

export type Effect =
  | { kind: "damage"; amount: number }
  | { kind: "heal"; amount: number }
  | { kind: "temp"; amount: number }
  | { kind: "condition"; condition: string; on: boolean }
  | { kind: "exhaustion"; level: number };

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const amount = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 999;

export function parseEffect(raw: unknown): Effect | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case "damage":
    case "heal":
    case "temp":
      return amount(raw.amount) ? { kind: raw.kind, amount: raw.amount } : null;
    case "condition":
      return typeof raw.condition === "string" && (CONDITIONS as readonly string[]).includes(raw.condition) && typeof raw.on === "boolean"
        ? { kind: "condition", condition: raw.condition, on: raw.on }
        : null;
    case "exhaustion":
      return typeof raw.level === "number" && Number.isInteger(raw.level) && raw.level >= 0 && raw.level <= 6 ? { kind: "exhaustion", level: raw.level } : null;
    default:
      return null;
  }
}

export function applyEffect(c: Character, content: Content, e: Effect): Character {
  switch (e.kind) {
    case "damage":
      return applyDamage(c, content, e.amount);
    case "heal":
      return heal(c, content, e.amount);
    case "temp":
      return setTempHp(c, e.amount);
    case "condition": {
      const has = c.state.conditions.includes(e.condition);
      if (has === e.on) return c;
      const conditions = e.on ? [...c.state.conditions, e.condition] : c.state.conditions.filter((x) => x !== e.condition);
      return { ...c, updatedAt: new Date().toISOString(), state: { ...c.state, conditions } };
    }
    case "exhaustion":
      return setExhaustion(c, e.level);
  }
}

/** How the player is told, in plain words. */
export function describeEffect(e: Effect): string {
  switch (e.kind) {
    case "damage":
      return `The DM dealt you ${e.amount} damage.`;
    case "heal":
      return `The DM healed you for ${e.amount}.`;
    case "temp":
      return `The DM gave you ${e.amount} temporary hit points.`;
    case "condition":
      return e.on ? `The DM says you're ${e.condition}.` : `You're no longer ${e.condition}.`;
    case "exhaustion":
      return e.level ? `The DM set your Exhaustion to level ${e.level}.` : "The DM removed your Exhaustion.";
  }
}
