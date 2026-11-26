import {
  ABILITY_NAMES,
  classSpellLists,
  findClass,
  setClassSpells,
  loadSpells,
  type Ability,
  type Character,
  type DerivedSheet,
  type SpellDef,
} from "@mimicbox/ruleset-dnd5e";
import { useEffect, useMemo, useState } from "react";
import { patchFeatAt, toggle } from "../lib/edit";
import { Markdown } from "../lib/markdown";
import { content } from "../lib/state";
import type { Update } from "./editors";

export function useSpells(): SpellDef[] | null {
  const [spells, setSpells] = useState<SpellDef[] | null>(content.spells ?? null);
  useEffect(() => {
    if (!spells) void loadSpells(content).then(setSpells);
  }, [spells]);
  return spells;
}

export function spellTags(s: SpellDef): string {
  const level = s.level === 0 ? `${cap(s.school)} cantrip` : `Level ${s.level} ${s.school}`;
  return [level, s.concentration ? "Concentration" : null, s.ritual ? "Ritual" : null].filter(Boolean).join(", ");
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function SpellDetail({ spell }: { spell: SpellDef }) {
  return (
    <div>
      <p className="small muted">
        <strong>Casting time</strong> {spell.castingTime} &nbsp; <strong>Range</strong> {spell.range}
        <br />
        <strong>Components</strong> {spell.components} &nbsp; <strong>Duration</strong> {spell.duration}
      </p>
      <Markdown text={spell.description} />
    </div>
  );
}

/** Pick spells from a list, with each spell's rules a tap away. */
export function SpellChooser({
  title,
  ids,
  selected,
  max,
  onToggle,
  locked = [],
  known = [],
}: {
  title: string;
  ids: string[];
  selected: string[];
  max: number;
  onToggle: (id: string) => void;
  /** Spells granted another way (always prepared): shown as "Always" and not pickable. */
  locked?: string[];
  /** Spells the character already knows from elsewhere: shown as "Known" so a pick isn't wasted. */
  known?: string[];
}) {
  const spells = useSpells();
  const [filter, setFilter] = useState("");
  const list = useMemo(() => {
    if (!spells) return [];
    const byId = new Map(spells.map((s) => [s.id, s]));
    return ids
      .map((id) => byId.get(id))
      .filter((s): s is SpellDef => Boolean(s))
      .filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  }, [spells, ids, filter]);
  if (!spells) return <p className="muted">Loading spells…</p>;
  const full = selected.length >= max;
  return (
    <section className="section">
      <div className="spread">
        <h3>{title}</h3>
        <span className={selected.length > max ? "notice" : "muted small"}>
          {selected.length} of {max}
        </span>
      </div>
      {ids.length > 8 && (
        <label className="field" style={{ margin: "8px 0" }}>
          <span className="visually-hidden">Filter {title.toLowerCase()}</span>
          <input className="input" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
      )}
      <div>
        {list.map((s) => {
          const on = selected.includes(s.id) || locked.includes(s.id);
          const elsewhere = !selected.includes(s.id) && known.includes(s.id);
          return (
            <details key={s.id} className="feature">
              <summary>
                <span className="grow">
                  {s.name}
                  <br />
                  <span className="muted small">{spellTags(s)}</span>
                </span>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  disabled={locked.includes(s.id) || elsewhere || (!on && full)}
                  onClick={(e) => {
                    e.preventDefault();
                    onToggle(s.id);
                  }}
                >
                  {locked.includes(s.id) ? "Always" : elsewhere ? "Known" : on ? "Chosen" : "Choose"}
                </button>
              </summary>
              <SpellDetail spell={s} />
            </details>
          );
        })}
      </div>
    </section>
  );
}

/** Cantrips and prepared spells for one spellcasting class (the first one unless `classId` says otherwise). */
export function ClassSpellsEditor({ character, sheet, update, classId }: { character: Character; sheet: DerivedSheet; update: Update; classId?: string }) {
  const sc = classId ? sheet.spellcastingClasses.find((x) => x.classId === classId) : sheet.spellcasting;
  if (!sc) return null;
  const cls = findClass(content, sc.classId);
  const own = classSpellLists(character, sc.classId);
  // Spells chosen for another class are shown as Known, so the same spell isn't prepared twice.
  const otherClasses = sheet.spellcastingClasses.filter((x) => x.classId !== sc.classId).map((x) => classSpellLists(character, x.classId));
  const granted = sheet.grantedSpells.map((g) => g.id);
  const levelled = Object.entries(sc.list)
    .filter(([l]) => Number(l) > 0)
    .flatMap(([, ids]) => ids);
  const set = (next: Partial<typeof own>) => update((c) => setClassSpells(c, sc.classId, { ...classSpellLists(c, sc.classId), ...next }));
  return (
    <>
      {sc.cantripLimit > 0 && (
        <SpellChooser
          title={`${cls.name} cantrips`}
          ids={sc.list[0] ?? []}
          selected={own.cantrips}
          max={sc.cantripLimit}
          locked={granted.filter((g) => (sc.list[0] ?? []).includes(g))}
          known={otherClasses.flatMap((o) => o.cantrips)}
          onToggle={(id) => set({ cantrips: toggle(own.cantrips, id, sc.cantripLimit) })}
        />
      )}
      {sc.preparedLimit > 0 && (
        <SpellChooser
          title={`Prepared ${cls.name} spells`}
          ids={levelled}
          selected={own.prepared}
          max={sc.preparedLimit}
          locked={granted.filter((g) => levelled.includes(g))}
          known={otherClasses.flatMap((o) => o.prepared)}
          onToggle={(id) => set({ prepared: toggle(own.prepared, id, sc.preparedLimit) })}
        />
      )}
    </>
  );
}

const MI_LISTS = ["cleric", "druid", "wizard"] as const;
const MI_ABILITIES: Ability[] = ["int", "wis", "cha"];

/** Magic Initiate: a spell list (when the source lets you choose), an ability, two cantrips and a level 1 spell. */
export function MagicInitiateEditor({ character, source, update, chooseList }: { character: Character; source: string; update: Update; chooseList?: boolean }) {
  const feat = character.build.feats.find((f) => f.source === source);
  const mi = feat?.magicInitiate;
  if (!feat || !mi) return null;
  const cls = findClass(content, mi.list);
  const patch = (next: Partial<typeof mi>) => update((c) => patchFeatAt(c, source, { magicInitiate: { ...mi, ...next } }));
  return (
    <section className="section panel">
      <h3>Magic Initiate ({cls.name})</h3>
      {chooseList && (
        <div className="row" style={{ marginTop: 8 }}>
          {MI_LISTS.map((l) => (
            <button key={l} type="button" className="chip" aria-pressed={mi.list === l} onClick={() => patch({ list: l, cantrips: [], spell: null })}>
              {findClass(content, l).name} list
            </button>
          ))}
        </div>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>Spellcasting ability for these spells</p>
      <div className="row">
        {MI_ABILITIES.map((a) => (
          <button key={a} type="button" className="chip" aria-pressed={mi.ability === a} onClick={() => patch({ ability: a })}>
            {ABILITY_NAMES[a]}
          </button>
        ))}
      </div>
      <SpellChooser
        title="Two cantrips"
        ids={cls.spellList["0"] ?? []}
        selected={mi.cantrips}
        max={2}
        known={character.spells.cantrips}
        onToggle={(id) => patch({ cantrips: toggle(mi.cantrips, id, 2) })}
      />
      <SpellChooser
        title="One level 1 spell"
        ids={cls.spellList["1"] ?? []}
        selected={mi.spell ? [mi.spell] : []}
        max={1}
        known={character.spells.prepared}
        onToggle={(id) => patch({ spell: mi.spell === id ? null : id })}
      />
    </section>
  );
}
