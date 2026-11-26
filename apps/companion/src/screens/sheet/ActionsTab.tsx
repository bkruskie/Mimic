import { formatModifier } from "@mimicbox/dice";
import { longRest, setResourceSpent, shortRest, type ResourceDef } from "@mimicbox/ruleset-dnd5e";
import { roll } from "@mimicbox/dice";
import { useState } from "react";
import { Explain } from "../../components/Explain";
import { AttackForm } from "../../components/homebrew";
import { content } from "../../lib/state";
import { Drawer, type SheetProps } from "../SheetScreen";

const resetText: Record<ResourceDef["reset"], string> = {
  long: "Long Rest",
  short: "Short or Long Rest",
  shortOne: "one back on a Short Rest, all on a Long Rest",
};

export function ActionsTab({ character, sheet, update, ask }: SheetProps) {
  const [rest, setRest] = useState<"short" | "long" | null>(null);
  const [attackForm, setAttackForm] = useState<{ id: string | null } | null>(null);
  const customAttacks = character.homebrew?.attacks ?? [];
  return (
    <>
      <section className="section">
        <h2>Attacks</h2>
        {sheet.attacksPerAction.count > 1 && (
          <p className="muted small" style={{ margin: "4px 0 8px" }}>
            The Attack action makes {sheet.attacksPerAction.count} attacks ({sheet.attacksPerAction.source}).
          </p>
        )}
        <ul className="rows">
          {sheet.attacks.map((a) => (
            <li key={a.id} className="attack">
              <div className="attack-head">
                <span className="attack-name">{a.name}</span>
                <span className="muted small">{a.range}</span>
              </div>
              <div className="muted small">
                {[a.properties, a.mastery ? `Mastery: ${a.mastery}` : null].filter(Boolean).join(". ")}
              </div>
              <div className="attack-actions">
                <button
                  className="pill"
                  onClick={() =>
                    ask({
                      label: `${a.name} attack`,
                      expression: "",
                      d20Modifier: a.toHit.value,
                      damage: { label: `${a.name} damage`, expression: a.damage },
                    })
                  }
                >
                  <span className="muted small">Hit</span>
                  <strong>{formatModifier(a.toHit.value)}</strong>
                </button>
                <button className="pill" onClick={() => ask({ label: `${a.name} damage`, expression: a.damage })}>
                  <strong>{a.damage}</strong>
                  <span className="muted small">{a.damageType}</span>
                </button>
                {a.versatileDamage && (
                  <button className="pill" onClick={() => ask({ label: `${a.name} damage, two hands`, expression: a.versatileDamage! })}>
                    <strong>{a.versatileDamage}</strong>
                    <span className="muted small">two hands</span>
                  </button>
                )}
              </div>
              {a.notes.length > 0 && (
                <ul className="small muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {a.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              <Explain label="Where the attack bonus comes from" value={a.toHit} />
              {a.id.startsWith("custom:") && (
                <button className="btn btn-quiet small" style={{ marginTop: 4 }} onClick={() => setAttackForm({ id: a.id.slice("custom:".length) })}>
                  Edit {a.name}
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="muted small" style={{ marginTop: 8 }}>
          Equip weapons in Gear to see them here. Tap Hit to roll the attack, then roll damage from the result.
        </p>
        <button className="btn" style={{ marginTop: 10 }} onClick={() => setAttackForm({ id: null })}>
          Add an attack
        </button>
        {attackForm && <AttackForm attack={customAttacks.find((x) => x.id === attackForm.id) ?? null} update={update} onClose={() => setAttackForm(null)} />}
      </section>

      {sheet.resources.length > 0 && (
        <section className="section">
          <h2>Limited uses</h2>
          <ul className="rows">
            {sheet.resources.map((r) => {
              const spent = Math.min(r.max, character.state.resourcesSpent[r.id] ?? 0);
              const left = r.max - spent;
              return (
                <li key={r.id} className="resource">
                  <div className="spread">
                    <span>
                      <strong>{r.name}</strong>
                      {r.detail && <span className="muted"> {r.detail}</span>}
                    </span>
                    <span className="muted small">
                      {left} of {r.max} left
                    </span>
                  </div>
                  {r.unit === "points" || r.max > 10 ? (
                    <div className="stepper" style={{ marginTop: 6 }}>
                      <button aria-label={`Use 1 ${r.name}`} disabled={left === 0} onClick={() => update((c) => setResourceSpent(c, r.id, spent + 1))}>
                        −
                      </button>
                      <output>{left}</output>
                      <button aria-label={`Regain 1 ${r.name}`} disabled={spent === 0} onClick={() => update((c) => setResourceSpent(c, r.id, spent - 1))}>
                        +
                      </button>
                    </div>
                  ) : (
                    <div className="pips" role="group" aria-label={`${r.name} uses`}>
                      {Array.from({ length: r.max }, (_, i) => (
                        <button
                          key={i}
                          className="pip"
                          aria-pressed={i >= left}
                          aria-label={i >= left ? `Use ${i + 1} spent. Tap to regain.` : `Use ${i + 1} available. Tap to spend.`}
                          onClick={() => update((c) => setResourceSpent(c, r.id, i >= left ? r.max - i - 1 : r.max - i))}
                        />
                      ))}
                    </div>
                  )}
                  <div className="muted small" style={{ marginTop: 4 }}>
                    Regain: {resetText[r.reset]}.
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="section">
        <h2>Rest</h2>
        <p className="muted small" style={{ marginTop: -4 }}>
          Hit Point Dice: {sheet.hitDiceByDie.map((g) => `${g.available} of ${g.total} d${g.die}`).join(", ")} left.
        </p>
        <div className="row">
          <button className="btn" onClick={() => setRest("short")}>
            Short Rest
          </button>
          <button className="btn" onClick={() => setRest("long")}>
            Long Rest
          </button>
        </div>
      </section>

      {rest === "short" && <ShortRestDrawer {...{ character, sheet, update, ask }} onClose={() => setRest(null)} />}
      {rest === "long" && (
        <Drawer title="Long Rest" onClose={() => setRest(null)}>
          <p>
            Regain all Hit Points and Hit Point Dice, reset spell slots and limited uses, and remove one level of Exhaustion.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              update((c) => longRest(c, content));
              setRest(null);
            }}
          >
            Finish Long Rest
          </button>
        </Drawer>
      )}
    </>
  );
}

function ShortRestDrawer({ sheet, update, onClose }: SheetProps & { onClose: () => void }) {
  const [rolls, setRolls] = useState<{ die: number; roll: number }[]>([]);
  const con = sheet.abilities.con.mod;
  const healed = rolls.reduce((t, r) => t + Math.max(0, r.roll + con), 0);
  return (
    <Drawer title="Short Rest" onClose={onClose}>
      <p>Spend Hit Point Dice to heal. Each die heals its roll plus your Constitution modifier ({formatModifier(con)}).</p>
      {sheet.hitDiceByDie.map((g) => {
        const left = g.available - rolls.filter((r) => r.die === g.die).length;
        return (
          <div className="row" key={g.die} style={{ marginBottom: 6 }}>
            <button className="btn" disabled={left <= 0} onClick={() => setRolls((r) => [...r, { die: g.die, roll: roll(`1d${g.die}`).total }])}>
              Roll a d{g.die}
            </button>
            <span className="muted small">{left} left</span>
          </div>
        );
      })}
      {rolls.length > 0 && (
        <p style={{ marginTop: 10 }}>
          Rolled {rolls.map((r) => r.roll).join(", ")}: heal <strong>{healed}</strong>.
        </p>
      )}
      <button
        className="btn btn-primary"
        style={{ marginTop: 10 }}
        onClick={() => {
          update((c) => shortRest(c, content, rolls));
          onClose();
        }}
      >
        Finish Short Rest
      </button>
      <p className="muted small" style={{ marginTop: 10 }}>
        Finishing also regains Pact Magic slots and uses that come back on a Short Rest.
      </p>
    </Drawer>
  );
}
