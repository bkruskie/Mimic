/**
 * The DM's bestiary: SRD 5.2.1 monsters (CC-BY-4.0) to add to a fight, and their stat blocks with every attack
 * bonus and damage roll one tap away. Loaded only when the DM opens it.
 */
import { describeRoll, roll as rollDice } from "@mimicbox/dice";
import { crValue, loadMonsters, newId, rollSegments, type MonsterDef } from "@mimicbox/ruleset-dnd5e";
import type { SharedRoll } from "@mimicbox/table";
import { useEffect, useMemo, useState } from "react";
import { Markdown, InlineMarkdown } from "../lib/markdown";

export interface NewCombatant {
  id: string;
  name: string;
  initiative: number | null;
  hidden: boolean;
  hp: { current: number; max: number } | null;
  monsterId?: string | null;
  ac?: number | null;
}

/** The bestiary, loaded once and shared: the list, null while loading, or "unavailable" if it couldn't load. */
export function useMonsters(open: boolean): MonsterDef[] | null | "unavailable" {
  const [list, setList] = useState<MonsterDef[] | null | "unavailable">(null);
  useEffect(() => {
    if (!open || Array.isArray(list)) return;
    let live = true;
    loadMonsters().then(
      (m) => live && setList(m),
      () => live && setList("unavailable"),
    );
    return () => {
      live = false;
    };
  }, [open, list]);
  return list;
}

/** Fetches the bestiary in the background while online, so it's on this computer for play without internet. */
export function prefetchBestiary(): void {
  if (!navigator.onLine) return;
  const start = () => {
    if (navigator.onLine) void loadMonsters().catch(() => undefined);
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 10000 });
  else setTimeout(start, 3000);
}

const UNAVAILABLE = "The bestiary isn't on this computer yet. Open the studio once while online and it's kept for play without internet.";

const ABILITY_NAMES = [
  ["str", "Str"],
  ["dex", "Dex"],
  ["con", "Con"],
  ["int", "Int"],
  ["wis", "Wis"],
  ["cha", "Cha"],
] as const;
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Searching the bestiary: a box and up to eight matches, each with a button that calls `onPick`. */
export function MonsterSearch({ open, count, onPick }: { open: boolean; count: number; onPick: (m: MonsterDef) => void }) {
  const monsters = useMonsters(open);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    if (!Array.isArray(monsters)) return [];
    const q = query.trim().toLowerCase();
    const list = q ? monsters.filter((m) => m.name.toLowerCase().includes(q) || m.type.toLowerCase().includes(q)) : monsters;
    return list
      .slice()
      .sort((a, b) => (q ? Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) : 0) || crValue(a.cr) - crValue(b.cr) || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [monsters, query]);
  return (
    <>
      <label className="field" style={{ flex: 1, minWidth: 160 }}>
        <span>Search the SRD monsters</span>
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Goblin, dragon, undead…" />
      </label>
      {monsters === "unavailable" ? (
        <p className="notice small">{UNAVAILABLE}</p>
      ) : !monsters ? (
        <p className="muted small">Loading the bestiary…</p>
      ) : matches.length === 0 ? (
        <p className="muted small">No SRD monster matches "{query}". Add it as your own creature instead.</p>
      ) : (
        <ul className="rows" aria-label="Monsters">
          {matches.map((m) => (
            <li key={m.id} className="resource spread">
              <span>
                {m.name}
                <br />
                <span className="muted small">
                  CR {m.cr}, AC {m.ac}, HP {m.hp.average}. {m.size} {m.type}
                </span>
              </span>
              <button
                type="button"
                className="btn"
                aria-label={`Add ${count === 1 ? "" : `${count} `}${m.name}`}
                onClick={() => {
                  onPick(m);
                  setQuery("");
                }}
              >
                Add{count > 1 ? ` ${count}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Search the bestiary and add one or more of a monster to the fight. Each gets its own number, initiative rolled
 * from its bonus, and hit points at the average or rolled from the stat block's formula.
 */
export function BestiaryAdd({ existing, canPlace, onAdd }: { existing: string[]; canPlace: boolean; onAdd: (list: NewCombatant[], placeOnMap: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState("1");
  const [rolledHp, setRolledHp] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [place, setPlace] = useState(true);
  const n = Math.max(1, Math.min(20, Number.parseInt(count, 10) || 1));

  const add = (m: MonsterDef) => {
    // Number them after any of the same monster already in the fight: Goblin Warrior 3, 4…
    const taken = existing.filter((x) => x === m.name || x.startsWith(`${m.name} `)).length;
    const list: NewCombatant[] = Array.from({ length: n }, (_, i) => {
      const hp = rolledHp ? rollHp(m.hp.formula, m.hp.average) : m.hp.average;
      return {
        id: newId(),
        name: n === 1 && taken === 0 ? m.name : `${m.name} ${taken + i + 1}`,
        initiative: rollInitiative(m.initiative.bonus),
        hidden,
        hp: { current: hp, max: hp },
        monsterId: m.id,
        ac: m.ac,
      };
    });
    onAdd(list, canPlace && place);
  };

  return (
    <details className="bestiary-add" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="btn">Add monsters</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <div className="row" style={{ alignItems: "end" }}>
          <label className="field" style={{ width: 80 }}>
            <span>How many</span>
            <input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
          </label>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="chip" aria-pressed={!rolledHp} onClick={() => setRolledHp(false)}>
              Average HP
            </button>
            <button type="button" className="chip" aria-pressed={rolledHp} onClick={() => setRolledHp(true)}>
              Roll HP
            </button>
            <button type="button" className="chip" aria-pressed={hidden} onClick={() => setHidden(!hidden)}>
              Hidden
            </button>
            {canPlace && (
              <button type="button" className="chip" aria-pressed={place} onClick={() => setPlace(!place)}>
                Place on the map
              </button>
            )}
          </div>
        </div>
        <MonsterSearch open={open} count={n} onPick={add} />
      </div>
    </details>
  );
}

/** Initiative for a creature: a d20 plus its bonus. */
export const rollInitiative = (bonus: number) => rollDice(`1d20${bonus >= 0 ? "+" : ""}${bonus}`).total;
/** Hit points rolled from a stat block's formula ("3d6", "19d12 + 133"), or the average if it can't be read. */
export function rollHp(formula: string | null, average: number): number {
  if (!formula) return average;
  try {
    return Math.max(1, rollDice(formula.replace(/\s+/g, "")).total);
  } catch {
    return average;
  }
}

/** A monster's stat block. Attack bonuses and damage rolls are buttons that roll in secret, labelled with `who`. */
export function StatBlock({ monster, who, hp, onRoll }: { monster: MonsterDef; who: string; hp: { current: number; max: number } | null; onRoll: (r: Omit<SharedRoll, "id" | "at">) => void }) {
  const [last, setLast] = useState<string | null>(null);
  const roll = (expression: string, label: string) => {
    const result = rollDice(expression);
    const flag = result.naturalD20 === 20 ? "crit" : result.naturalD20 === 1 ? "fumble" : undefined;
    onRoll({ by: "DM", characterName: who, label, expression, total: result.total, breakdown: describeRoll(result), visibility: "dm", ...(flag ? { flag } : {}) });
    setLast(`${label}: ${result.total}${flag === "crit" ? ", a natural 20" : flag === "fumble" ? ", a natural 1" : ""} (${describeRoll(result)})`);
  };
  const facts: [string, string | undefined][] = [
    ["Skills", monster.skills],
    ["Vulnerabilities", monster.vulnerabilities],
    ["Resistances", monster.resistances],
    ["Immunities", monster.immunities],
    ["Gear", monster.gear],
    ["Senses", monster.senses],
    ["Languages", monster.languages],
  ];
  return (
    <article className="stat-block" aria-label={`${monster.name} stat block`}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {monster.size} {monster.type}, {monster.alignment}
      </p>
      <dl className="stat-facts">
        <div>
          <dt>AC</dt>
          <dd>
            {monster.ac}
            {monster.acNote ? ` ${monster.acNote}` : ""}
          </dd>
        </div>
        <div>
          <dt>HP</dt>
          <dd>{hp ? `${hp.current} of ${hp.max}` : `${monster.hp.average} (${monster.hp.formula})`}</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{monster.speed}</dd>
        </div>
        <div>
          <dt>Initiative</dt>
          <dd>{signed(monster.initiative.bonus)}</dd>
        </div>
        <div>
          <dt>CR</dt>
          <dd>
            {monster.cr} ({monster.xp.toLocaleString()} XP)
          </dd>
        </div>
      </dl>
      <table className="stat-abilities">
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Ability</span>
            </th>
            {ABILITY_NAMES.map(([, n]) => (
              <th key={n} scope="col">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Score</th>
            {ABILITY_NAMES.map(([a]) => (
              <td key={a}>{monster.abilities[a].score}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">Check</th>
            {ABILITY_NAMES.map(([a, n]) => (
              <td key={a}>
                <button type="button" className="roll-link" aria-label={`Roll a ${n} check`} onClick={() => roll(`1d20${monster.abilities[a].mod >= 0 ? "+" : ""}${monster.abilities[a].mod}`, `${n} check`)}>
                  {signed(monster.abilities[a].mod)}
                </button>
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Save</th>
            {ABILITY_NAMES.map(([a, n]) => (
              <td key={a}>
                <button type="button" className="roll-link" aria-label={`Roll a ${n} save`} onClick={() => roll(`1d20${monster.abilities[a].save >= 0 ? "+" : ""}${monster.abilities[a].save}`, `${n} save`)}>
                  {signed(monster.abilities[a].save)}
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <dl className="stat-lines">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {last && (
        <p className="stat-last" role="status">
          {last}. Only you see this roll.
        </p>
      )}
      {monster.sections.map((s) => (
        <section key={s.title}>
          <h4>{s.title}</h4>
          {s.intro && <Markdown text={s.intro} />}
          {s.entries.map((e) =>
            e.text.includes("\n") ? (
              // Spell lists and other multi-line entries keep their Markdown layout.
              <div key={e.name} className="stat-entry">
                <Markdown text={`***${e.name}.*** ${e.text}`} />
              </div>
            ) : (
              <p key={e.name} className="stat-entry">
                <strong>
                  <em>{e.name}.</em>
                </strong>{" "}
                {rollSegments(e.text).map((seg, i) =>
                  typeof seg === "string" ? (
                    <InlineMarkdown key={i} text={seg} />
                  ) : (
                    <button
                      key={i}
                      type="button"
                      className="roll-link"
                      aria-label={`Roll ${e.name} ${seg.kind === "attack" ? "attack" : "damage"}, ${seg.roll}`}
                      onClick={() => roll(seg.roll, `${e.name} ${seg.kind === "attack" ? "attack" : "damage"}`)}
                    >
                      {seg.label}
                    </button>
                  ),
                )}
              </p>
            ),
          )}
        </section>
      ))}
      <p className="muted small">From the System Reference Document 5.2.1, CC-BY-4.0.</p>
    </article>
  );
}
