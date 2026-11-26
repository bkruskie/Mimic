import { formatModifier } from "@mimicbox/dice";
import { ABILITY_NAMES, restoreSlot, spendSlot, type SpellDef } from "@mimicbox/ruleset-dnd5e";
import { useState } from "react";
import { ClassSpellsEditor, SpellDetail, spellTags, useSpells } from "../../components/spells";
import { Drawer, type SheetProps } from "../SheetScreen";

export function SpellsTab({ character, sheet, update, ask }: SheetProps) {
  const spells = useSpells();
  const [editing, setEditing] = useState(false);
  const sc = sheet.spellcasting;
  const byId = new Map((spells ?? []).map((s) => [s.id, s]));
  const known = [...new Set([...character.spells.cantrips, ...character.spells.prepared])].map((id) => byId.get(id)).filter((s): s is SpellDef => Boolean(s));
  const granted = sheet.grantedSpells
    .filter((g) => !known.some((k) => k.id === g.id))
    .map((g) => ({ g, spell: byId.get(g.id) }))
    .filter((x): x is { g: (typeof sheet.grantedSpells)[number]; spell: SpellDef } => Boolean(x.spell));

  if (!sc && sheet.grantedSpells.length === 0) {
    return (
      <section className="section empty">
        <h2>No spells</h2>
        <p className="muted">Your class doesn't cast spells at this level. Spells from your species or feats will appear here.</p>
      </section>
    );
  }

  const byLevel = new Map<number, SpellDef[]>();
  for (const s of known) byLevel.set(s.level, [...(byLevel.get(s.level) ?? []), s]);

  return (
    <>
      {sc && (
        <section className="section">
          <div className="ability-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="ability">
              <span className="abbr">Ability</span>
              <span className="mod" style={{ fontSize: "var(--t-xl)", padding: "8px 0" }}>
                {ABILITY_NAMES[sc.ability].slice(0, 3)}
              </span>
            </div>
            <div className="ability">
              <span className="abbr">Save DC</span>
              <span className="mod">{sc.saveDc.value}</span>
            </div>
            <button className="ability" onClick={() => ask({ label: "Spell attack", expression: "", d20Modifier: sc.attack.value })}>
              <span className="abbr">Attack</span>
              <span className="mod">{formatModifier(sc.attack.value)}</span>
            </button>
          </div>
        </section>
      )}

      {sc && (sc.slots.some((n) => n > 0) || sc.pact) && (
        <section className="section">
          <h2>Spell slots</h2>
          <ul className="rows">
            {sc.slots.map((total, i) => {
              if (!total) return null;
              const spent = Math.min(total, character.state.slotsSpent[i] ?? 0);
              const left = total - spent;
              return (
                <li key={i} className="resource">
                  <div className="spread">
                    <strong>Level {i + 1}</strong>
                    <span className="muted small">
                      {left} of {total} left
                    </span>
                  </div>
                  <div className="pips">
                    {Array.from({ length: total }, (_, p) => (
                      <button
                        key={p}
                        className="pip"
                        aria-pressed={p >= left}
                        aria-label={p >= left ? `Level ${i + 1} slot spent. Tap to restore.` : `Level ${i + 1} slot available. Tap to spend.`}
                        onClick={() => update((c) => (p >= left ? restoreSlot(c, i + 1) : spendSlot(c, i + 1)))}
                      />
                    ))}
                  </div>
                </li>
              );
            })}
            {sc.pact && (
              <li className="resource">
                <div className="spread">
                  <strong>Pact Magic, level {sc.pact.level}</strong>
                  <span className="muted small">
                    {sc.pact.count - Math.min(sc.pact.count, character.state.pactSlotsSpent)} of {sc.pact.count} left
                  </span>
                </div>
                <div className="pips">
                  {Array.from({ length: sc.pact.count }, (_, p) => {
                    const left = sc.pact!.count - Math.min(sc.pact!.count, character.state.pactSlotsSpent);
                    return (
                      <button
                        key={p}
                        className="pip"
                        aria-pressed={p >= left}
                        aria-label={p >= left ? "Pact slot spent. Tap to restore." : "Pact slot available. Tap to spend."}
                        onClick={() => update((c) => (p >= left ? restoreSlot(c, 0, true) : spendSlot(c, 0, true)))}
                      />
                    );
                  })}
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  Regain on a Short or Long Rest.
                </div>
              </li>
            )}
          </ul>
        </section>
      )}

      {!spells && <p className="muted">Loading spells…</p>}

      {[...byLevel.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([level, list]) => (
          <section className="section" key={level}>
            <h2>{level === 0 ? "Cantrips" : `Level ${level}`}</h2>
            {list
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => (
                <SpellRow key={s.id} spell={s} />
              ))}
          </section>
        ))}

      {granted.length > 0 && (
        <section className="section">
          <h2>Always prepared</h2>
          <p className="muted small" style={{ marginTop: -4 }}>
            From your species, subclass and feats. These don't count against your prepared spells.
          </p>
          {granted.map(({ g, spell }) => (
            <SpellRow key={g.id} spell={spell} note={`${g.source}${g.freeCast ? ". Cast once per Long Rest without a slot" : ""}`} />
          ))}
        </section>
      )}

      {sc && (
        <section className="section">
          <button className="btn" onClick={() => setEditing(true)}>
            Change cantrips and prepared spells
          </button>
        </section>
      )}
      {editing && (
        <Drawer title="Choose spells" onClose={() => setEditing(false)}>
          <ClassSpellsEditor character={character} sheet={sheet} update={update} />
        </Drawer>
      )}
    </>
  );
}

function SpellRow({ spell, note }: { spell: SpellDef; note?: string }) {
  return (
    <details className="feature">
      <summary>
        <span className="grow">
          {spell.name}
          <br />
          <span className="muted small">{note ?? spellTags(spell)}</span>
        </span>
        <span className="muted small">{spell.castingTime?.replace(/ or Ritual/, "")}</span>
      </summary>
      {note && <p className="muted small">{spellTags(spell)}</p>}
      <SpellDetail spell={spell} />
    </details>
  );
}
