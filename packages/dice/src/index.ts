/**
 * Dice notation for Mimic Box.
 *
 * Supported, case-insensitive:
 *   NdS         N dice with S sides (N defaults to 1): "d20", "3d6", "d%" (= d100)
 *   khN / klN   keep highest / lowest N: "2d20kh1"
 *   dhN / dlN   drop highest / lowest N: "4d6dl1"
 *   !           explode on the maximum face (chained, capped): "1d6!"
 *   rN          reroll once any die showing N or less: "2d6r1"
 *   minN        treat any die below N as N: "2d6min3"
 *   + / -       add and subtract terms and whole numbers: "1d20+5-1"
 *
 * Rolls use crypto.getRandomValues with rejection sampling, so every face is equally likely.
 */

export type RandomInt = (sides: number) => number;

export interface DieResult {
  /** The face finally counted (after rerolls and minimums). */
  value: number;
  /** The face first rolled, when a reroll or minimum changed it. */
  original?: number;
  kept: boolean;
  /** True when this die was added by an explosion. */
  exploded?: boolean;
  rerolled?: boolean;
}

export interface DiceTerm {
  kind: "dice";
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { which: "highest" | "lowest"; count: number };
  drop?: { which: "highest" | "lowest"; count: number };
  explode?: boolean;
  rerollAtOrBelow?: number;
  minimum?: number;
}

export interface ConstantTerm {
  kind: "constant";
  sign: 1 | -1;
  value: number;
}

export type Term = DiceTerm | ConstantTerm;

export interface DiceExpression {
  source: string;
  terms: Term[];
}

export interface RolledDiceTerm extends DiceTerm {
  dice: DieResult[];
  subtotal: number;
}

export interface RolledConstantTerm extends ConstantTerm {
  subtotal: number;
}

export interface RollResult {
  expression: string;
  terms: (RolledDiceTerm | RolledConstantTerm)[];
  total: number;
  /** The natural face of the single kept d20, when the roll has exactly one. Used for critical hits and fumbles. */
  naturalD20?: number;
  rolledAt: string;
}

export class DiceSyntaxError extends Error {
  constructor(
    message: string,
    readonly source: string,
  ) {
    super(message);
    this.name = "DiceSyntaxError";
  }
}

const MAX_DICE = 100;
const MAX_SIDES = 1000;
const MAX_EXPLOSIONS = 100;
const MAX_TERMS = 20;

const TERM_PATTERN =
  /^(\d*)d(\d+|%)((?:kh\d+|kl\d+|dh\d+|dl\d+|k\d+|!|r\d+|min\d+)*)$/i;
const MODIFIER_PATTERN = /(kh|kl|dh|dl|k|r|min)(\d+)|(!)/gi;

export function parseDice(input: string): DiceExpression {
  const source = input.trim();
  if (source.length === 0) throw new DiceSyntaxError("Enter a roll, for example 1d20+5.", input);
  if (source.length > 200) throw new DiceSyntaxError("That roll is too long.", input);

  const compact = source.replace(/\s+/g, "");
  const parts = compact.match(/[+-]?[^+-]+/g);
  if (!parts || parts.join("") !== compact) {
    throw new DiceSyntaxError(`"${source}" is not a roll Mimic Box understands.`, input);
  }
  if (parts.length > MAX_TERMS) throw new DiceSyntaxError("That roll has too many parts.", input);

  const terms: Term[] = parts.map((raw) => {
    const sign: 1 | -1 = raw.startsWith("-") ? -1 : 1;
    const body = raw.replace(/^[+-]/, "");
    if (/^\d+$/.test(body)) {
      return { kind: "constant", sign, value: Number(body) };
    }
    const match = TERM_PATTERN.exec(body);
    if (!match) throw new DiceSyntaxError(`"${body}" is not a dice term Mimic Box understands.`, input);
    const count = match[1] === "" ? 1 : Number(match[1]);
    const sides = match[2] === "%" ? 100 : Number(match[2]);
    if (count < 1 || count > MAX_DICE) throw new DiceSyntaxError(`Roll between 1 and ${MAX_DICE} dice at a time.`, input);
    if (sides < 2 || sides > MAX_SIDES) throw new DiceSyntaxError(`Dice need between 2 and ${MAX_SIDES} sides.`, input);

    const term: DiceTerm = { kind: "dice", sign, count, sides };
    for (const mod of (match[3] ?? "").matchAll(MODIFIER_PATTERN)) {
      if (mod[3] === "!") {
        if (sides < 3) throw new DiceSyntaxError("Exploding dice need at least 3 sides.", input);
        term.explode = true;
        continue;
      }
      const kind = (mod[1] ?? "").toLowerCase();
      const n = Number(mod[2]);
      switch (kind) {
        case "kh":
        case "k":
          term.keep = { which: "highest", count: n };
          break;
        case "kl":
          term.keep = { which: "lowest", count: n };
          break;
        case "dh":
          term.drop = { which: "highest", count: n };
          break;
        case "dl":
          term.drop = { which: "lowest", count: n };
          break;
        case "r":
          if (n >= sides) throw new DiceSyntaxError("A reroll must leave some faces that stay.", input);
          term.rerollAtOrBelow = n;
          break;
        case "min":
          if (n > sides) throw new DiceSyntaxError("A minimum can't be higher than the die.", input);
          term.minimum = n;
          break;
      }
    }
    if (term.keep && term.drop) throw new DiceSyntaxError("Use keep or drop, not both.", input);
    const selected = term.keep?.count ?? term.drop?.count;
    if (selected !== undefined && (selected < 1 || selected > count)) {
      throw new DiceSyntaxError(`You can only keep or drop between 1 and ${count} of those dice.`, input);
    }
    if (term.drop && term.drop.count === count) throw new DiceSyntaxError("That would drop every die.", input);
    return term;
  });

  return { source, terms };
}

/** Uniform integer in 1..sides using the platform's secure random source. */
export const secureRandomInt: RandomInt = (sides) => {
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  const buffer = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buffer);
    const value = buffer[0]!;
    if (value < limit) return (value % sides) + 1;
  }
};

function rollTerm(term: DiceTerm, random: RandomInt): RolledDiceTerm {
  const dice: DieResult[] = [];
  const rollOne = (exploded: boolean): void => {
    let value = random(term.sides);
    const die: DieResult = { value, kept: true };
    if (exploded) die.exploded = true;
    if (term.rerollAtOrBelow !== undefined && value <= term.rerollAtOrBelow) {
      die.original = value;
      die.rerolled = true;
      value = random(term.sides);
      die.value = value;
    }
    if (term.minimum !== undefined && die.value < term.minimum) {
      die.original ??= die.value;
      die.value = term.minimum;
    }
    dice.push(die);
  };

  for (let i = 0; i < term.count; i++) {
    rollOne(false);
    if (term.explode) {
      let chain = 0;
      while (dice[dice.length - 1]!.value === term.sides && chain < MAX_EXPLOSIONS) {
        rollOne(true);
        chain++;
      }
    }
  }

  const ranked = dice.map((die, index) => ({ die, index })).sort((a, b) => a.die.value - b.die.value || a.index - b.index);
  if (term.keep) {
    const keepSet =
      term.keep.which === "highest" ? ranked.slice(ranked.length - term.keep.count) : ranked.slice(0, term.keep.count);
    const kept = new Set(keepSet.map((r) => r.index));
    dice.forEach((die, index) => (die.kept = kept.has(index)));
  } else if (term.drop) {
    const dropSet =
      term.drop.which === "highest" ? ranked.slice(ranked.length - term.drop.count) : ranked.slice(0, term.drop.count);
    const dropped = new Set(dropSet.map((r) => r.index));
    dice.forEach((die, index) => (die.kept = !dropped.has(index)));
  }

  const subtotal = term.sign * dice.filter((d) => d.kept).reduce((sum, d) => sum + d.value, 0);
  return { ...term, dice, subtotal };
}

export function rollExpression(expression: DiceExpression, random: RandomInt = secureRandomInt): RollResult {
  const terms = expression.terms.map((term) =>
    term.kind === "constant" ? { ...term, subtotal: term.sign * term.value } : rollTerm(term, random),
  );
  const total = terms.reduce((sum, t) => sum + t.subtotal, 0);
  const keptD20s = terms.flatMap((t) =>
    t.kind === "dice" && t.sides === 20 && t.sign === 1 ? t.dice.filter((d) => d.kept) : [],
  );
  const result: RollResult = { expression: expression.source, terms, total, rolledAt: new Date().toISOString() };
  if (keptD20s.length === 1) result.naturalD20 = keptD20s[0]!.value;
  return result;
}

export function roll(notation: string, random: RandomInt = secureRandomInt): RollResult {
  return rollExpression(parseDice(notation), random);
}

export type RollMode = "normal" | "advantage" | "disadvantage";

/** Builds the notation for a d20 test, such as an attack, check or save. */
export function d20Notation(modifier: number, mode: RollMode = "normal"): string {
  const die = mode === "advantage" ? "2d20kh1" : mode === "disadvantage" ? "2d20kl1" : "1d20";
  return modifier === 0 ? die : `${die}${modifier > 0 ? "+" : "-"}${Math.abs(modifier)}`;
}

/** Doubles the number of dice in every dice term, for critical-hit damage. Constants stay the same. */
export function criticalNotation(notation: string): string {
  const expression = parseDice(notation);
  return expression.terms
    .map((term, index) => {
      const sign = term.sign === -1 ? "-" : index === 0 ? "" : "+";
      if (term.kind === "constant") return `${sign}${term.value}`;
      return `${sign}${term.count * 2}d${term.sides}${modifierSuffix(term)}`;
    })
    .join("");
}

function modifierSuffix(term: DiceTerm): string {
  let suffix = "";
  if (term.keep) suffix += `${term.keep.which === "highest" ? "kh" : "kl"}${term.keep.count}`;
  if (term.drop) suffix += `${term.drop.which === "highest" ? "dh" : "dl"}${term.drop.count}`;
  if (term.explode) suffix += "!";
  if (term.rerollAtOrBelow !== undefined) suffix += `r${term.rerollAtOrBelow}`;
  if (term.minimum !== undefined) suffix += `min${term.minimum}`;
  return suffix;
}

/** A one-line, human-readable breakdown, such as "[14, 6] + 5 = 19". Dropped dice are shown struck with ~. */
export function describeRoll(result: RollResult): string {
  const parts = result.terms.map((term, index) => {
    const sign = term.sign === -1 ? "- " : index === 0 ? "" : "+ ";
    if (term.kind === "constant") return `${sign}${term.value}`;
    const faces = term.dice.map((d) => (d.kept ? String(d.value) : `~${d.value}~`)).join(", ");
    return `${sign}[${faces}]`;
  });
  return `${parts.join(" ")} = ${result.total}`;
}

export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}
