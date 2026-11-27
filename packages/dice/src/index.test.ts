import { describe, expect, it } from "vitest";
import {
  DiceSyntaxError,
  criticalNotation,
  d20Notation,
  describeRoll,
  parseDice,
  roll,
  secureRandomInt,
  type RandomInt,
} from "./index.js";

/** Returns the given faces in order, then repeats the last one. */
function scripted(...faces: number[]): RandomInt {
  let i = 0;
  return () => faces[Math.min(i++, faces.length - 1)]!;
}

describe("parseDice", () => {
  it("parses dice, modifiers and constants", () => {
    const expr = parseDice("2d20kh1 + 5 - 1d4");
    expect(expr.terms).toEqual([
      { kind: "dice", sign: 1, count: 2, sides: 20, keep: { which: "highest", count: 1 } },
      { kind: "constant", sign: 1, value: 5 },
      { kind: "dice", sign: -1, count: 1, sides: 4 },
    ]);
  });

  it("treats d% as d100 and a bare d as one die", () => {
    expect(parseDice("d%").terms[0]).toMatchObject({ count: 1, sides: 100 });
    expect(parseDice("D6").terms[0]).toMatchObject({ count: 1, sides: 6 });
  });

  it.each([
    ["", "Enter a roll"],
    ["2d20kh3", "keep or drop"],
    ["4d6dl4", "drop every die"],
    ["1d1", "sides"],
    ["101d6", "1 and 100 dice"],
    ["1d6r6", "reroll"],
    ["hello", "not a dice term"],
    ["1d6+", "not a roll"],
    ["2d6kh1dl1", "keep or drop, not both"],
  ])("rejects %j with a readable message", (input, message) => {
    expect(() => parseDice(input)).toThrow(DiceSyntaxError);
    expect(() => parseDice(input)).toThrow(new RegExp(message, "i"));
  });
});

describe("roll", () => {
  it("adds kept dice and constants", () => {
    const result = roll("2d6+3", scripted(4, 5));
    expect(result.total).toBe(12);
    expect(describeRoll(result)).toBe("[4, 5] + 3 = 12");
  });

  it("keeps the highest die for advantage and reports the natural d20", () => {
    const result = roll(d20Notation(5, "advantage"), scripted(7, 18));
    expect(result.total).toBe(23);
    expect(result.naturalD20).toBe(18);
    expect(describeRoll(result)).toBe("[~7~, 18] + 5 = 23");
  });

  it("keeps the lowest die for disadvantage", () => {
    const result = roll(d20Notation(-1, "disadvantage"), scripted(7, 18));
    expect(result.total).toBe(6);
    expect(result.naturalD20).toBe(7);
  });

  it("drops the lowest of 4d6 for ability scores", () => {
    const result = roll("4d6dl1", scripted(1, 6, 3, 5));
    expect(result.total).toBe(14);
  });

  it("explodes on the maximum face", () => {
    const result = roll("1d6!", scripted(6, 6, 2));
    expect(result.total).toBe(14);
    const term = result.terms[0];
    expect(term?.kind === "dice" && term.dice.map((d) => Boolean(d.exploded))).toEqual([false, true, true]);
  });

  it("rerolls once at or below the threshold and keeps the new face", () => {
    const result = roll("2d6r2", scripted(1, 1, 5));
    // First die: 1 -> reroll -> 1 (kept even though low). Second die: 5.
    expect(result.total).toBe(6);
  });

  it("raises faces below a minimum", () => {
    const result = roll("2d6min3", scripted(1, 5));
    expect(result.total).toBe(8);
  });

  it("subtracts negative dice terms", () => {
    expect(roll("10-1d4", scripted(3)).total).toBe(7);
  });

  it("does not report a natural d20 when there is none or more than one", () => {
    expect(roll("1d8").naturalD20).toBeUndefined();
    expect(roll("2d20", scripted(3, 4)).naturalD20).toBeUndefined();
  });
});

describe("helpers", () => {
  it("formats d20 notation", () => {
    expect(d20Notation(0)).toBe("1d20");
    expect(d20Notation(3)).toBe("1d20+3");
    expect(d20Notation(-2, "advantage")).toBe("2d20kh1-2");
  });

  it("doubles dice for critical hits but not constants", () => {
    expect(criticalNotation("1d8+3")).toBe("2d8+3");
    expect(criticalNotation("2d6+1d4-1")).toBe("4d6+2d4-1");
  });
});

describe("secureRandomInt", () => {
  it("stays in range and reaches every face", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const face = secureRandomInt(6);
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(6);
      seen.add(face);
    }
    expect(seen.size).toBe(6);
  });

  it("is roughly uniform on a d20 (chi-squared, 19 degrees of freedom)", () => {
    const n = 40000;
    const counts = new Array<number>(20).fill(0);
    for (let i = 0; i < n; i++) counts[secureRandomInt(20) - 1]!++;
    const expected = n / 20;
    const chi = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    // 64.4 is about the 0.999999 quantile for 19 degrees of freedom, so a fair die fails about once in a million runs
    // (0.999, used before, failed one run in a thousand: often enough to break CI now and then). A real bias, such as
    // one face never coming up, scores in the thousands.
    expect(chi).toBeLessThan(64.4);
  });
});
