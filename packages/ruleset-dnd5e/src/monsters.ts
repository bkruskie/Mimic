/**
 * Monsters from the SRD 5.2.1 (CC-BY-4.0): stat blocks for the DM's bestiary. The list is about 600 KB, so it is
 * loaded only when the DM's studio asks for it; players' sheets never download it.
 */
import type { Ability } from "./types.js";

export interface MonsterEntry {
  name: string;
  /** SRD Markdown: italics, bold, and lists for spellcasting. */
  text: string;
}

export interface MonsterSection {
  /** Traits, Actions, Bonus Actions, Reactions or Legendary Actions. */
  title: string;
  intro?: string;
  entries: MonsterEntry[];
}

export interface MonsterDef {
  id: string;
  name: string;
  size: string;
  type: string;
  alignment: string;
  ac: number;
  acNote?: string;
  hp: { average: number; formula: string };
  speed: string;
  initiative: { bonus: number; score: number };
  abilities: Record<Ability, { score: number; mod: number; save: number }>;
  skills?: string;
  vulnerabilities?: string;
  resistances?: string;
  immunities?: string;
  gear?: string;
  senses: string;
  languages: string;
  /** "1/4", "1", "17"… */
  cr: string;
  xp: number;
  pb: number;
  sections: MonsterSection[];
}

let monstersPromise: Promise<MonsterDef[]> | null = null;
/** Loads the bestiary on demand. */
export function loadMonsters(): Promise<MonsterDef[]> {
  monstersPromise ??= import("../content/srd-5.2.1/monsters.json").then((m) => (m.default ?? m) as unknown as MonsterDef[]);
  return monstersPromise;
}

/** A challenge rating as a number, for sorting and filtering: "1/4" is 0.25. */
export function crValue(cr: string): number {
  const [a, b] = cr.split("/");
  return b ? Number(a) / Number(b) : Number(a);
}

/** Dice notation the dice package reads, from the SRD's "1d6 + 2" or "19d12 + 133". */
const dice = (s: string) => s.replace(/\s+/g, "").replace(/−|–/g, "-");

/** A piece of stat block text: plain text, or something to roll. */
export type RollSegment = string | { roll: string; label: string; kind: "attack" | "damage" };

/**
 * Splits stat block text into plain text and rollable parts: an attack's bonus ("Attack Roll:* +4" rolls 1d20+4)
 * and each damage expression ("5 (1d6 + 2)" rolls 1d6+2). The text itself is kept exactly.
 */
export function rollSegments(text: string): RollSegment[] {
  const out: RollSegment[] = [];
  const re = /(Attack Roll:\*?\s*)([+−–-]\d+)|(\d+) \((\d+d\d+(?:\s*[+−–-]\s*\d+)?)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) {
      const start = m.index! + m[1].length;
      if (start > last) out.push(text.slice(last, start));
      out.push({ roll: `1d20${dice(m[2]!).replace(/^([^-+])/, "+$1")}`, label: m[2]!, kind: "attack" });
      last = start + m[2]!.length;
    } else {
      if (m.index! > last) out.push(text.slice(last, m.index));
      out.push({ roll: dice(m[4]!), label: m[0], kind: "damage" });
      last = m.index! + m[0].length;
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
