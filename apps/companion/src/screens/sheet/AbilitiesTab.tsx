import { formatModifier } from "@mimicbox/dice";
import { ABILITIES, ABILITY_NAMES, SKILLS, SKILL_IDS } from "@mimicbox/ruleset-dnd5e";
import { Explain } from "../../components/Explain";
import type { SheetProps } from "../SheetScreen";

const profLabel = { none: "not proficient", half: "half proficiency", proficient: "proficient", expertise: "expertise" } as const;

export function AbilitiesTab({ sheet, ask }: SheetProps) {
  return (
    <>
      <section className="section">
        <h2>Abilities</h2>
        <div className="ability-grid">
          {ABILITIES.map((a) => {
            const ab = sheet.abilities[a];
            return (
              <button
                key={a}
                className="ability"
                aria-label={`${ABILITY_NAMES[a]} check, ${formatModifier(ab.mod)}`}
                onClick={() => ask({ label: `${ABILITY_NAMES[a]} check`, expression: "", d20Modifier: ab.mod })}
              >
                <span className="abbr">{ABILITY_NAMES[a]}</span>
                <span className="mod">{formatModifier(ab.mod)}</span>
                <span className="score">{ab.score.value}</span>
              </button>
            );
          })}
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Tap an ability to roll a check. Proficiency Bonus {formatModifier(sheet.proficiencyBonus)}.
        </p>
      </section>

      <section className="section">
        <h2>Saving throws</h2>
        <ul className="rows">
          {ABILITIES.map((a) => {
            const save = sheet.abilities[a].save;
            return (
              <li key={a}>
                <button className="roll-row" onClick={() => ask({ label: `${ABILITY_NAMES[a]} saving throw`, expression: "", d20Modifier: save.value })}>
                  <span className={`prof-mark ${sheet.abilities[a].saveProficient ? "proficient" : ""}`} aria-hidden />
                  <span className="grow">
                    {ABILITY_NAMES[a]}
                    <span className="visually-hidden">, {sheet.abilities[a].saveProficient ? "proficient" : "not proficient"}</span>
                  </span>
                  <span className="num">{formatModifier(save.value)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="section">
        <h2>Skills</h2>
        <ul className="rows">
          {SKILL_IDS.map((id) => {
            const s = sheet.skills[id];
            return (
              <li key={id}>
                <button className="roll-row" onClick={() => ask({ label: `${SKILLS[id].name} check`, expression: "", d20Modifier: s.total.value })}>
                  <span className={`prof-mark ${s.proficiency}`} aria-hidden />
                  <span className="grow">
                    {SKILLS[id].name} <span className="muted small">{ABILITY_NAMES[s.ability].slice(0, 3)}</span>
                    <span className="visually-hidden">, {profLabel[s.proficiency]}</span>
                  </span>
                  <span className="num">{formatModifier(s.total.value)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="muted small" style={{ marginTop: 8 }}>
          Filled circle: proficient. Ringed circle: Expertise. Half circle: half proficiency.
        </p>
      </section>

      <section className="section panel stack">
        <div className="spread">
          <span>Passive Perception</span>
          <strong>{sheet.passive.perception}</strong>
        </div>
        <div className="spread">
          <span>Passive Insight</span>
          <strong>{sheet.passive.insight}</strong>
        </div>
        <div className="spread">
          <span>Passive Investigation</span>
          <strong>{sheet.passive.investigation}</strong>
        </div>
        {sheet.darkvision && (
          <div className="spread">
            <span>Darkvision</span>
            <strong>{sheet.darkvision} ft.</strong>
          </div>
        )}
        {sheet.resistances.length > 0 && (
          <div className="spread">
            <span>Resistances</span>
            <strong style={{ textTransform: "capitalize" }}>{sheet.resistances.join(", ")}</strong>
          </div>
        )}
        <div className="spread">
          <span>Size</span>
          <strong>{sheet.size}</strong>
        </div>
      </section>

      <section className="section panel">
        <h3>Armor Class {sheet.ac.value}</h3>
        <Explain label="How it's worked out" value={sheet.ac} plain />
        <h3 style={{ marginTop: 14 }}>Initiative {formatModifier(sheet.initiative.value)}</h3>
        {sheet.initiativeAdvantage && <p className="small muted">Advantage on Initiative (Remarkable Athlete).</p>}
        <Explain label="How it's worked out" value={sheet.initiative} />
        <h3 style={{ marginTop: 14 }}>Speed {sheet.speed.value} ft.</h3>
        <Explain label="How it's worked out" value={sheet.speed} plain />
        <h3 style={{ marginTop: 14 }}>Hit point maximum {sheet.hp.max.value}</h3>
        <Explain label="How it's worked out" value={sheet.hp.max} plain />
      </section>

      <section className="section panel stack small">
        <div>
          <strong>Armor training</strong>
          <br />
          {sheet.proficiencies.armor}
        </div>
        <div>
          <strong>Weapons</strong>
          <br />
          {sheet.proficiencies.weapons}
        </div>
        <div>
          <strong>Tools</strong>
          <br />
          {sheet.proficiencies.tools}
        </div>
        <div>
          <strong>Languages</strong>
          <br />
          {sheet.proficiencies.languages}
        </div>
      </section>
    </>
  );
}
