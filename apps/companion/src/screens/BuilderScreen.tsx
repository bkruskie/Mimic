import { roll } from "@mimicbox/dice";
import {
  ABILITIES,
  ABILITY_NAMES,
  FIGHTING_STYLE_LEVEL,
  POINT_BUY_BUDGET,
  POINT_BUY_COST,
  SPELLCASTING_ABILITY,
  STANDARD_ARRAY,
  createCharacter,
  derive,
  findBackground,
  findClass,
  findSpecies,
  fullHeal,
  grantEquipment,
  type Ability,
  type AbilityScores,
  type Character,
} from "@mimicbox/ruleset-dnd5e";
import { useEffect, useMemo, useState } from "react";
import { go } from "../App";
import {
  BackgroundAbilityEditor,
  ClassChoicesEditor,
  ClassSkillsEditor,
  ExpertiseEditor,
  FightingStyleEditor,
  SpeciesEditor,
  WeaponMasteryEditor,
} from "../components/editors";
import { ClassSpellsEditor, MagicInitiateEditor } from "../components/spells";
import { setBackground, setClass, setSpecies } from "../lib/edit";
import { BackIcon } from "../lib/icons";
import { Markdown } from "../lib/markdown";
import { content, summaryFor, useApp } from "../lib/state";
import { Portrait } from "./VaultScreen";
import { portraitFromFile } from "../lib/edit";

type StepId = "class" | "species" | "background" | "abilities" | "skills" | "equipment" | "spells" | "details";
const STEP_NAMES: Record<StepId, string> = {
  class: "Class",
  species: "Species",
  background: "Background",
  abilities: "Abilities",
  skills: "Class options",
  equipment: "Equipment",
  spells: "Spells",
  details: "Name and finish",
};

export function BuilderScreen() {
  const { vault, refresh, toast } = useApp();
  const [draft, setDraft] = useState<Character>(() =>
    createCharacter(content, { name: "", classId: "fighter", speciesId: "human", backgroundId: "soldier" }),
  );
  const [picked, setPicked] = useState({ class: false, species: false, background: false });
  const [step, setStep] = useState<StepId>("class");
  const [equipment, setEquipment] = useState<{ cls: string | null; bg: string | null }>({ cls: null, bg: null });
  const [saving, setSaving] = useState(false);

  const sheet = useMemo(() => derive(draft, content), [draft]);
  const update = (fn: (c: Character) => Character) => setDraft((c) => fn(c));
  const hasSpells = Boolean(sheet.spellcasting) || draft.build.feats.some((f) => f.id === "magic-initiate");
  const steps: StepId[] = ["class", "species", "background", "abilities", "skills", "equipment", ...(hasSpells ? (["spells"] as StepId[]) : []), "details"];
  const index = steps.indexOf(step);

  useEffect(() => {
    document.querySelector('.steps [aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "center" });
    window.scrollTo(0, 0);
  }, [step]);

  const canContinue =
    (step === "class" && picked.class) ||
    (step === "species" && picked.species) ||
    (step === "background" && picked.background) ||
    (step === "equipment" && equipment.cls !== null && equipment.bg !== null) ||
    !["class", "species", "background", "equipment"].includes(step);

  async function finish() {
    if (!vault) return;
    setSaving(true);
    let c: Character = { ...draft, name: draft.name.trim() || "Unnamed adventurer" };
    const cls = findClass(content, c.build.classes[0]!.id);
    const bg = findBackground(content, c.build.background.id);
    const clsOpt = cls.startingEquipment.find((o) => o.label === equipment.cls);
    const bgOpt = bg.equipment.find((o) => o.label === equipment.bg);
    if (clsOpt) c = grantEquipment(c, content, clsOpt.items, clsOpt.gp);
    if (bgOpt) c = grantEquipment(c, content, bgOpt.items, bgOpt.gp);
    c = fullHeal(c, content);
    await vault.put(c, summaryFor(c));
    await refresh();
    toast(`${c.name} is in your vault`);
    go({ name: "sheet", id: c.id });
  }

  return (
    <main className="screen">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn btn-quiet" onClick={() => go({ name: "vault" })}>
          <BackIcon width={18} height={18} style={{ verticalAlign: "-3px" }} /> Vault
        </button>
      </div>
      <h1>Build a character</h1>
      <ol className="steps" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              aria-current={s === step ? "step" : undefined}
              className={i < index ? "done" : ""}
              disabled={i > index && !canContinue}
              onClick={() => setStep(s)}
            >
              {i + 1}. {STEP_NAMES[s]}
            </button>
          </li>
        ))}
      </ol>

      {step === "class" && (
        <ClassStep
          selected={picked.class ? draft.build.classes[0]!.id : null}
          onPick={(id) => {
            setDraft((c) => setClass(c, id));
            setPicked((p) => ({ ...p, class: true }));
            setEquipment((e) => ({ ...e, cls: null }));
          }}
        />
      )}
      {step === "species" && (
        <>
          <PickGrid
            items={content.species.map((s) => ({ id: s.id, name: s.name, detail: `${s.sizeText.replace(/ \(.*/, "")}, speed ${s.speed} ft.` }))}
            selected={picked.species ? draft.build.species.id : null}
            onPick={(id) => {
              setDraft((c) => setSpecies(c, content, id));
              setPicked((p) => ({ ...p, species: true }));
            }}
          />
          {picked.species && (
            <>
              <SpeciesEditor character={draft} sheet={sheet} update={update} />
              <section className="section">
                <h3>{findSpecies(content, draft.build.species.id).name} traits</h3>
                {findSpecies(content, draft.build.species.id).traits.map((t) => (
                  <details key={t.name} className="feature">
                    <summary>{t.name}</summary>
                    <Markdown text={t.text} />
                  </details>
                ))}
              </section>
            </>
          )}
        </>
      )}
      {step === "background" && (
        <>
          <PickGrid
            items={content.backgrounds.map((b) => ({ id: b.id, name: b.name, detail: `${b.feat.name}${b.feat.option ? ` (${b.feat.option})` : ""}` }))}
            selected={picked.background ? draft.build.background.id : null}
            onPick={(id) => {
              setDraft((c) => setBackground(c, content, id));
              setPicked((p) => ({ ...p, background: true }));
              setEquipment((e) => ({ ...e, bg: null }));
            }}
          />
          {picked.background && <BackgroundSummary character={draft} />}
          {picked.background && <BackgroundAbilityEditor character={draft} sheet={sheet} update={update} />}
        </>
      )}
      {step === "abilities" && <AbilitiesStep character={draft} update={update} />}
      {step === "skills" && (
        <>
          <ClassSkillsEditor character={draft} sheet={sheet} update={update} />
          <ExpertiseEditor character={draft} sheet={sheet} update={update} />
          <ClassChoicesEditor character={draft} sheet={sheet} update={update} />
          {FIGHTING_STYLE_LEVEL[draft.build.classes[0]!.id] === 1 && <FightingStyleEditor character={draft} sheet={sheet} update={update} />}
          <WeaponMasteryEditor character={draft} sheet={sheet} update={update} />
        </>
      )}
      {step === "equipment" && <EquipmentStep character={draft} value={equipment} onChange={setEquipment} />}
      {step === "spells" && (
        <>
          {SPELLCASTING_ABILITY[draft.build.classes[0]!.id] && <ClassSpellsEditor character={draft} sheet={sheet} update={update} />}
          {draft.build.feats
            .filter((f) => f.id === "magic-initiate")
            .map((f) => (
              <MagicInitiateEditor key={f.source} character={draft} source={f.source} update={update} chooseList={f.source === "species"} />
            ))}
        </>
      )}
      {step === "details" && <DetailsStep character={draft} update={update} />}

      <div className="builder-footer">
        <div className="inner">
          <button className="btn" disabled={index === 0} onClick={() => setStep(steps[index - 1]!)}>
            Back
          </button>
          {step === "details" ? (
            <button className="btn btn-primary" disabled={saving || !vault} onClick={() => void finish()}>
              Save to vault
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!canContinue} onClick={() => setStep(steps[index + 1]!)}>
              Next: {STEP_NAMES[steps[index + 1]!]}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function PickGrid({ items, selected, onPick }: { items: { id: string; name: string; detail: string }[]; selected: string | null; onPick: (id: string) => void }) {
  return (
    <div className="choice-grid">
      {items.map((i) => (
        <button key={i.id} type="button" className="choice" aria-pressed={selected === i.id} onClick={() => onPick(i.id)}>
          <strong>{i.name}</strong>
          <small>{i.detail}</small>
        </button>
      ))}
    </div>
  );
}

function ClassStep({ selected, onPick }: { selected: string | null; onPick: (id: string) => void }) {
  const cls = selected ? findClass(content, selected) : null;
  return (
    <>
      <PickGrid items={content.classes.map((c) => ({ id: c.id, name: c.name, detail: `${c.primaryAbility}, d${c.hitDie} hit die` }))} selected={selected} onPick={onPick} />
      {cls && (
        <section className="section">
          <h2>{cls.name}</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            Saves: {cls.savingThrows.map((a) => ABILITY_NAMES[a]).join(" and ")}. Armor: {cls.armorText}. Weapons: {cls.weaponText}.
          </p>
          {cls.features
            .filter((f) => f.level === 1)
            .map((f) => (
              <details key={f.id} className="feature">
                <summary>{f.name}</summary>
                <Markdown text={f.text} />
              </details>
            ))}
        </section>
      )}
    </>
  );
}

function BackgroundSummary({ character }: { character: Character }) {
  const bg = findBackground(content, character.build.background.id);
  const feat = content.feats.find((f) => f.id === bg.feat.id);
  return (
    <section className="section panel">
      <h3>{bg.name}</h3>
      <p className="small" style={{ marginTop: 6 }}>
        Skills: {bg.skills.map((s) => s.replace(/([A-Z])/g, " $1").replace(/^./, (x) => x.toUpperCase())).join(" and ")}. Tool: {bg.tool.replace(/\*|\(see "Equipment"\)/g, "").trim()}.
      </p>
      {feat && (
        <details className="feature" style={{ background: "var(--hollow)" }}>
          <summary>Feat: {feat.name}{bg.feat.option ? ` (${bg.feat.option})` : ""}</summary>
          <Markdown text={feat.text} />
        </details>
      )}
    </section>
  );
}

function AbilitiesStep({ character, update }: { character: Character; update: (fn: (c: Character) => Character) => void }) {
  const method = character.build.abilityMethod;
  const base = character.build.baseAbilities;
  const sheet = derive(character, content);
  const [pool, setPool] = useState<number[] | null>(null);
  const setBase = (next: AbilityScores, m = method) => update((c) => ({ ...c, build: { ...c.build, baseAbilities: next, abilityMethod: m } }));
  const spent = ABILITIES.reduce((t, a) => t + (POINT_BUY_COST[base[a]] ?? 99), 0);
  const assignPool = method === "standard" ? STANDARD_ARRAY : method === "rolled" ? pool ?? [] : [];

  function choose(m: typeof method) {
    if (m === "standard") setBase(Object.fromEntries(ABILITIES.map((a, i) => [a, STANDARD_ARRAY[i]])) as AbilityScores, m);
    if (m === "pointBuy") setBase(Object.fromEntries(ABILITIES.map((a) => [a, 8])) as AbilityScores, m);
    if (m === "rolled") {
      const rolled = ABILITIES.map(() => roll("4d6dl1").total).sort((x, y) => y - x);
      setPool(rolled);
      setBase(Object.fromEntries(ABILITIES.map((a, i) => [a, rolled[i]])) as AbilityScores, m);
    }
    if (m === "manual") setBase(base, m);
  }

  function swapAssign(a: Ability, value: number) {
    // Assigning a value from the pool swaps it with whichever ability held it.
    const holder = ABILITIES.find((x) => x !== a && base[x] === value);
    const next = { ...base, [a]: value };
    if (holder) next[holder] = base[a];
    setBase(next);
  }

  return (
    <section className="section">
      <div className="row" style={{ marginBottom: 14 }}>
        {(
          [
            ["standard", "Standard array"],
            ["pointBuy", "Point buy"],
            ["rolled", "Roll 4d6"],
            ["manual", "Enter my own"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" className="chip" aria-pressed={method === m} onClick={() => choose(m)}>
            {label}
          </button>
        ))}
      </div>
      {method === "pointBuy" && (
        <p className={spent > POINT_BUY_BUDGET ? "notice" : "muted small"}>
          {POINT_BUY_BUDGET - spent} of {POINT_BUY_BUDGET} points left. Scores run from 8 to 15 before your background.
        </p>
      )}
      {method === "rolled" && pool && <p className="muted small">You rolled {pool.join(", ")}. Assign them below; picking a number swaps it with the ability that had it.</p>}
      <div className="score-table" style={{ marginTop: 10 }}>
        {ABILITIES.map((a) => (
          <div key={a} style={{ display: "contents" }}>
            <label htmlFor={`score-${a}`}>{ABILITY_NAMES[a]}</label>
            {method === "pointBuy" ? (
              <span className="stepper">
                <button type="button" aria-label={`Lower ${ABILITY_NAMES[a]}`} disabled={base[a] <= 8} onClick={() => setBase({ ...base, [a]: base[a] - 1 })}>
                  −
                </button>
                <output id={`score-${a}`}>{base[a]}</output>
                <button
                  type="button"
                  aria-label={`Raise ${ABILITY_NAMES[a]}`}
                  disabled={base[a] >= 15 || spent - POINT_BUY_COST[base[a]]! + POINT_BUY_COST[base[a] + 1]! > POINT_BUY_BUDGET}
                  onClick={() => setBase({ ...base, [a]: base[a] + 1 })}
                >
                  +
                </button>
              </span>
            ) : method === "manual" ? (
              <input
                id={`score-${a}`}
                className="input"
                style={{ width: 90 }}
                type="number"
                inputMode="numeric"
                min={3}
                max={20}
                value={base[a]}
                onChange={(e) => setBase({ ...base, [a]: Math.max(3, Math.min(20, Number(e.target.value) || 3)) })}
              />
            ) : (
              <select id={`score-${a}`} className="input" style={{ width: 90 }} value={base[a]} onChange={(e) => swapAssign(a, Number(e.target.value))}>
                {[...new Set(assignPool)].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            <span className="score-total" aria-label={`${ABILITY_NAMES[a]} with background`}>
              {sheet.abilities[a].score.value}
            </span>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        The number on the right includes your background's increases.
      </p>
    </section>
  );
}

function EquipmentStep({ character, value, onChange }: { character: Character; value: { cls: string | null; bg: string | null }; onChange: (v: { cls: string | null; bg: string | null }) => void }) {
  const cls = findClass(content, character.build.classes[0]!.id);
  const bg = findBackground(content, character.build.background.id);
  const describe = (o: { items: { name: string; quantity: number }[]; gp: number }) =>
    [...o.items.map((i) => (i.quantity > 1 ? `${i.quantity} ${i.name}` : i.name)), o.gp ? `${o.gp} GP` : null].filter(Boolean).join(", ");
  return (
    <>
      <section className="section">
        <h3>{cls.name} equipment</h3>
        <div className="stack" style={{ marginTop: 8 }}>
          {cls.startingEquipment.map((o) => (
            <button key={o.label} type="button" className="choice" style={{ width: "100%" }} aria-pressed={value.cls === o.label} onClick={() => onChange({ ...value, cls: o.label })}>
              <strong>Option {o.label}</strong>
              <small>{describe(o)}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="section">
        <h3>{bg.name} equipment</h3>
        <div className="stack" style={{ marginTop: 8 }}>
          {bg.equipment.map((o) => (
            <button key={o.label} type="button" className="choice" style={{ width: "100%" }} aria-pressed={value.bg === o.label} onClick={() => onChange({ ...value, bg: o.label })}>
              <strong>Option {o.label}</strong>
              <small>{describe(o)}</small>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function DetailsStep({ character, update }: { character: Character; update: (fn: (c: Character) => Character) => void }) {
  const sheet = derive(character, content);
  const open = sheet.pending.filter((p) => p.kind !== "prepared");
  return (
    <section className="section stack">
      <div className="row" style={{ alignItems: "center" }}>
        <Portrait name={character.name || "?"} src={character.portrait} />
        <label className="btn">
          {character.portrait ? "Change portrait" : "Add a portrait"}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                const portrait = await portraitFromFile(f);
                update((c) => ({ ...c, portrait }));
              }
            }}
          />
        </label>
      </div>
      <label className="field">
        <span>Character name</span>
        <input className="input" value={character.name} onChange={(e) => update((c) => ({ ...c, name: e.target.value }))} autoComplete="off" />
      </label>
      <label className="field">
        <span>Your name (optional)</span>
        <input className="input" value={character.playerName} onChange={(e) => update((c) => ({ ...c, playerName: e.target.value }))} />
      </label>
      <label className="field">
        <span>Languages</span>
        <input className="input" value={character.build.languages} onChange={(e) => update((c) => ({ ...c, build: { ...c.build, languages: e.target.value } }))} />
      </label>
      <p className="muted small">You know Common plus two languages of your choice from the standard languages.</p>
      <div className="panel">
        <h3>{character.name.trim() || "Your character"}</h3>
        <p className="muted small" style={{ marginTop: 4 }}>
          {sheet.classSummary}, {sheet.speciesName}, {sheet.backgroundName}. {sheet.hp.max.value} HP, AC {sheet.ac.value}.
        </p>
        {open.length > 0 ? (
          <div className="notice notice-todo">
            Still open, which you can finish later from the sheet:
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {open.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="small" style={{ margin: 0 }}>Every choice is made.</p>
        )}
      </div>
    </section>
  );
}
