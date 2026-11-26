/**
 * Editors for every choice a character makes. The builder shows them step by step; the sheet shows the
 * ones still open after a level-up.
 */
import {
  ABILITIES,
  ABILITY_NAMES,
  CLASS_CHOICES,
  EPIC_BOON_LEVEL,
  FEAT_ABILITY_INCREASE,
  MYSTIC_ARCANUM,
  SKILLS,
  SKILL_IDS,
  SPECIES_CHOICES,
  SUBCLASS_CHOICES,
  classOptionRule,
  expertiseCount,
  findBackground,
  findClass,
  findSpecies,
  optionLevelPrerequisite,
  optionRequires,
  weaponMasteryCount,
  type Ability,
  type Character,
  type DerivedSheet,
  type PendingChoice,
  type SkillId,
} from "@mimicbox/ruleset-dnd5e";
import type { ReactNode } from "react";
import { Markdown } from "../lib/markdown";
import { content } from "../lib/state";
import { patchFeatAt, setFeatAt, toggle, updateClassEntry } from "../lib/edit";
import { MagicInitiateEditor, SpellChooser } from "./spells";

export type Update = (fn: (c: Character) => Character) => void;

interface EditorProps {
  character: Character;
  sheet: DerivedSheet;
  update: Update;
}

function Block({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {hint && <p className="muted small" style={{ margin: "4px 0 10px" }}>{hint}</p>}
      {children}
    </section>
  );
}

function Chips<T extends string>({
  options,
  selected,
  onToggle,
  label,
  disabled,
}: {
  options: { id: T; name: string }[];
  selected: T[];
  onToggle: (id: T) => void;
  label: string;
  disabled?: (id: T) => boolean;
}) {
  return (
    <div className="row" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="chip"
          aria-pressed={selected.includes(o.id)}
          disabled={disabled?.(o.id) && !selected.includes(o.id)}
          onClick={() => onToggle(o.id)}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}

const skillOptions = (ids: readonly SkillId[]) => ids.map((id) => ({ id, name: SKILLS[id].name }));
const spellAbilities: Ability[] = ["int", "wis", "cha"];

// ---------- species ----------

export function SpeciesEditor({ character, update }: EditorProps) {
  const sp = findSpecies(content, character.build.species.id);
  const def = SPECIES_CHOICES[sp.id];
  const choice = character.build.species;
  const featAtSpecies = character.build.feats.find((f) => f.source === "species");
  return (
    <>
      {sp.sizes.length > 1 && (
        <Block title="Size" hint={sp.sizeText}>
          <Chips
            label="Size"
            options={sp.sizes.map((s) => ({ id: s, name: s === "small" ? "Small" : "Medium" }))}
            selected={[choice.size]}
            onToggle={(size) => update((c) => ({ ...c, build: { ...c.build, species: { ...c.build.species, size } } }))}
          />
        </Block>
      )}
      {def && def.options.length > 0 && (
        <Block title={def.label}>
          <div className="choice-grid">
            {def.options.map((o) => (
              <button
                key={o.id}
                type="button"
                className="choice"
                aria-pressed={choice.option === o.id}
                onClick={() => update((c) => ({ ...c, build: { ...c.build, species: { ...c.build.species, option: o.id } } }))}
              >
                <strong>{o.name}</strong>
                <small>{o.summary}</small>
              </button>
            ))}
          </div>
        </Block>
      )}
      {def?.needsSpellAbility && (
        <Block title="Spellcasting ability" hint={`Used for the spells your ${def.label} gives you.`}>
          <Chips
            label="Spellcasting ability"
            options={spellAbilities.map((a) => ({ id: a, name: ABILITY_NAMES[a] }))}
            selected={choice.spellAbility ? [choice.spellAbility] : []}
            onToggle={(a) => update((c) => ({ ...c, build: { ...c.build, species: { ...c.build.species, spellAbility: a } } }))}
          />
        </Block>
      )}
      {def?.skillChoice && (
        <Block title={sp.id === "elf" ? "Keen Senses" : "Skillful"} hint="Gain proficiency in one skill.">
          <Chips
            label="Species skill"
            options={skillOptions(def.skillChoice === "any" ? SKILL_IDS : def.skillChoice)}
            selected={choice.skill ? [choice.skill] : []}
            onToggle={(s) => update((c) => ({ ...c, build: { ...c.build, species: { ...c.build.species, skill: s } } }))}
          />
        </Block>
      )}
      {def?.originFeat && (
        <Block title="Versatile" hint="Choose an Origin feat. Skilled is recommended.">
          <Chips
            label="Origin feat"
            options={content.feats.filter((f) => f.category === "origin").map((f) => ({ id: f.id, name: f.name }))}
            selected={featAtSpecies ? [featAtSpecies.id] : []}
            onToggle={(id) =>
              update((c) =>
                setFeatAt(c, "species", id === "magic-initiate" ? { id, magicInitiate: { list: "wizard", ability: "int", cantrips: [], spell: null } } : { id }),
              )
            }
          />
          {featAtSpecies?.id === "skilled" && <SkilledEditor character={character} source="species" update={update} />}
          {featAtSpecies?.id === "magic-initiate" && <MagicInitiateEditor character={character} source="species" update={update} chooseList />}
        </Block>
      )}
    </>
  );
}

function SkilledEditor({ character, source, update }: { character: Character; source: string; update: Update }) {
  const feat = character.build.feats.find((f) => f.source === source);
  const chosen = feat?.skills ?? [];
  return (
    <div style={{ marginTop: 10 }}>
      <p className="muted small">Skilled: choose three skills ({chosen.length}/3).</p>
      <Chips
        label="Skilled feat skills"
        options={skillOptions(SKILL_IDS)}
        selected={chosen}
        disabled={() => chosen.length >= 3}
        onToggle={(s) => update((c) => patchFeatAt(c, source, { skills: toggle(chosen, s, 3) }))}
      />
    </div>
  );
}

// ---------- background ----------

export function BackgroundAbilityEditor({ character, update }: EditorProps) {
  const bg = findBackground(content, character.build.background.id);
  const inc = character.build.background.abilityIncreases;
  const values = Object.values(inc).filter((v) => (v ?? 0) > 0).length;
  const mode = values === 3 ? "spread" : "focus";
  const set = (next: Partial<Record<Ability, number>>) =>
    update((c) => ({ ...c, build: { ...c.build, background: { ...c.build.background, abilityIncreases: next } } }));
  const plus2 = (Object.entries(inc).find(([, v]) => v === 2)?.[0] ?? null) as Ability | null;
  const plus1 = (Object.entries(inc).find(([, v]) => v === 1)?.[0] ?? null) as Ability | null;
  return (
    <Block title="Ability score increases" hint={`${bg.name} raises ${bg.abilityOptions.map((a) => ABILITY_NAMES[a]).join(", ")}. Choose +2 and +1, or +1 to all three. No score can go above 20.`}>
      <div className="row" style={{ marginBottom: 10 }}>
        <button type="button" className="chip" aria-pressed={mode === "focus"} onClick={() => set({})}>
          +2 and +1
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={mode === "spread"}
          onClick={() => set(Object.fromEntries(bg.abilityOptions.map((a) => [a, 1])))}
        >
          +1 to all three
        </button>
      </div>
      {mode === "focus" && (
        <div className="stack">
          <div>
            <p className="small muted" style={{ marginBottom: 4 }}>+2 to</p>
            <Chips
              label="Plus two"
              options={bg.abilityOptions.map((a) => ({ id: a, name: ABILITY_NAMES[a] }))}
              selected={plus2 ? [plus2] : []}
              onToggle={(a) => set({ [a]: 2, ...(plus1 && plus1 !== a ? { [plus1]: 1 } : {}) })}
            />
          </div>
          <div>
            <p className="small muted" style={{ marginBottom: 4 }}>+1 to</p>
            <Chips
              label="Plus one"
              options={bg.abilityOptions.map((a) => ({ id: a, name: ABILITY_NAMES[a] }))}
              selected={plus1 ? [plus1] : []}
              disabled={(a) => a === plus2}
              onToggle={(a) => set({ ...(plus2 ? { [plus2]: 2 } : {}), [a]: 1 })}
            />
          </div>
        </div>
      )}
    </Block>
  );
}

// ---------- class ----------

export function ClassSkillsEditor({ character, update }: EditorProps) {
  const entry = character.build.classes[0]!;
  const cls = findClass(content, entry.id);
  const fromElsewhere = new Set<SkillId>([
    ...findBackground(content, character.build.background.id).skills,
    ...(character.build.species.skill ? [character.build.species.skill] : []),
  ]);
  return (
    <Block title={`${cls.name} skills`} hint={`Choose ${cls.skills.choose} (${entry.skills.length} chosen). Skills you already have from your background or species are marked unavailable.`}>
      <Chips
        label="Class skills"
        options={skillOptions(cls.skills.from)}
        selected={entry.skills}
        disabled={(s) => fromElsewhere.has(s) || entry.skills.length >= cls.skills.choose}
        onToggle={(s) => update((c) => updateClassEntry(c, { skills: toggle(entry.skills, s, cls.skills.choose) }))}
      />
    </Block>
  );
}

export function ExpertiseEditor({ character, sheet, update }: EditorProps) {
  const entry = character.build.classes[0]!;
  const max = expertiseCount(entry.id, entry.level);
  if (max === 0) return null;
  const proficient = SKILL_IDS.filter((s) => sheet.skills[s].proficiency === "proficient" || sheet.skills[s].proficiency === "expertise");
  return (
    <Block title="Expertise" hint={`Double your Proficiency Bonus for ${max} skills you're proficient in (${entry.expertise.length} chosen).`}>
      <Chips
        label="Expertise"
        options={skillOptions(proficient)}
        selected={entry.expertise}
        disabled={() => entry.expertise.length >= max}
        onToggle={(s) => update((c) => updateClassEntry(c, { expertise: toggle(entry.expertise, s, max) }))}
      />
    </Block>
  );
}

export function ClassChoicesEditor({ character, update }: EditorProps) {
  const entry = character.build.classes[0]!;
  const defs = [...(CLASS_CHOICES[entry.id] ?? []), ...(entry.subclass ? SUBCLASS_CHOICES[entry.subclass] ?? [] : [])].filter((d) => entry.level >= d.level);
  return (
    <>
      {defs.map((def) => (
        <Block key={def.key} title={def.label}>
          <div className="choice-grid">
            {def.options.map((o) => (
              <button
                key={o.id}
                type="button"
                className="choice"
                aria-pressed={entry.choices[def.key] === o.id}
                onClick={() => update((c) => updateClassEntry(c, { choices: { ...entry.choices, [def.key]: o.id } }))}
              >
                <strong>{o.name}</strong>
                <small>{o.summary}</small>
              </button>
            ))}
          </div>
        </Block>
      ))}
    </>
  );
}

export function FightingStyleEditor({ character, update }: EditorProps) {
  const entry = character.build.classes[0]!;
  const source = `class:${entry.id}:fighting-style`;
  const current = character.build.feats.find((f) => f.source === source);
  const styles = content.feats.filter((f) => f.category === "fighting-style");
  return (
    <Block title="Fighting Style" hint="Choose a Fighting Style feat.">
      <div className="choice-grid">
        {styles.map((f) => (
          <button key={f.id} type="button" className="choice" aria-pressed={current?.id === f.id} onClick={() => update((c) => setFeatAt(c, source, { id: f.id }))}>
            <strong>{f.name}</strong>
            <small>{firstSentence(f.text)}</small>
          </button>
        ))}
      </div>
    </Block>
  );
}

export function WeaponMasteryEditor({ character, update }: EditorProps) {
  const entry = character.build.classes[0]!;
  const cls = findClass(content, entry.id);
  const max = weaponMasteryCount(entry.id, cls.progression[entry.level - 1]?.columns ?? {});
  if (max === 0) return null;
  const eligible = content.weapons.filter((w) => {
    if (entry.id === "rogue") return w.category === "simple" || w.properties.some((p) => p === "finesse" || p === "light");
    return true;
  });
  return (
    <Block title="Weapon Mastery" hint={`Choose ${max} kinds of weapons whose mastery property you can use (${entry.weaponMasteries.length} chosen).`}>
      <Chips
        label="Weapon Mastery"
        options={eligible.map((w) => ({ id: w.id, name: `${w.name} (${w.mastery})` }))}
        selected={entry.weaponMasteries}
        disabled={() => entry.weaponMasteries.length >= max}
        onToggle={(id) => update((c) => updateClassEntry(c, { weaponMasteries: toggle(entry.weaponMasteries, id, max) }))}
      />
    </Block>
  );
}

export function SubclassEditor({ character, update }: EditorProps) {
  const entry = character.build.classes[0]!;
  const cls = findClass(content, entry.id);
  return (
    <Block title={`${cls.name} subclass`}>
      {cls.subclasses.map((s) => (
        <div key={s.id} className="panel" style={{ marginBottom: 8 }}>
          <div className="spread">
            <h3>{s.name}</h3>
            <button type="button" className="chip" aria-pressed={entry.subclass === s.id} onClick={() => update((c) => updateClassEntry(c, { subclass: s.id }))}>
              {entry.subclass === s.id ? "Chosen" : "Choose"}
            </button>
          </div>
          <Markdown text={s.description} />
        </div>
      ))}
    </Block>
  );
}

export function AsiEditor({ character, sheet, update, level, boon = false }: EditorProps & { level: number; boon?: boolean }) {
  const entry = character.build.classes[0]!;
  const source = `${boon ? "boon" : "asi"}:${entry.id}:${level}`;
  const current = character.build.feats.find((f) => f.source === source);
  const isAsi = boon ? current?.id === "ability-score-improvement" : !current || current.id === "ability-score-improvement";
  const inc = current?.abilityIncreases ?? {};
  const used = Object.values(inc).reduce((t, v) => t + (v ?? 0), 0);
  const choices = content.feats.filter(
    (f) => (f.category === "general" && f.id !== "ability-score-improvement") || (boon && f.category === "epic-boon"),
  );
  const featRule = current ? FEAT_ABILITY_INCREASE[current.id] : undefined;
  const bump = (a: Ability, delta: number) => {
    const next = { ...inc, [a]: Math.max(0, Math.min(2, (inc[a] ?? 0) + delta)) };
    const total = Object.values(next).reduce((t, v) => t + (v ?? 0), 0);
    if (total > 2) return;
    update((c) => setFeatAt(c, source, { id: "ability-score-improvement", abilityIncreases: next }));
  };
  const scoreBefore = (a: Ability) => sheet.abilities[a].score.value - (inc[a] ?? 0);
  return (
    <Block
      title={boon ? `Level ${level}: Epic Boon` : `Level ${level}: Ability Score Improvement`}
      hint={
        boon
          ? "Choose an Epic Boon feat, or another feat you qualify for. Epic Boons raise a score by 1, to a maximum of 30."
          : "Increase one score by 2, or two scores by 1 (to a maximum of 20), or take a General feat instead."
      }
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <button type="button" className="chip" aria-pressed={isAsi} onClick={() => update((c) => setFeatAt(c, source, { id: "ability-score-improvement", abilityIncreases: {} }))}>
          Ability scores
        </button>
        {choices.map((f) => (
          <button key={f.id} type="button" className="chip" aria-pressed={current?.id === f.id} onClick={() => update((c) => setFeatAt(c, source, { id: f.id }))}>
            {f.name}
          </button>
        ))}
      </div>
      {isAsi ? (
        <div className="score-table">
          {ABILITIES.map((a) => (
            <div key={a} style={{ display: "contents" }}>
              <span>
                {ABILITY_NAMES[a]} <span className="muted small">{sheet.abilities[a].score.value}</span>
              </span>
              <span className="stepper">
                <button type="button" aria-label={`Lower ${ABILITY_NAMES[a]}`} onClick={() => bump(a, -1)} disabled={!inc[a]}>
                  −
                </button>
                <output>+{inc[a] ?? 0}</output>
                <button type="button" aria-label={`Raise ${ABILITY_NAMES[a]}`} onClick={() => bump(a, 1)} disabled={used >= 2 || sheet.abilities[a].score.value >= 20}>
                  +
                </button>
              </span>
              <span />
            </div>
          ))}
          <p className="muted small">{2 - used} point{2 - used === 1 ? "" : "s"} left.</p>
        </div>
      ) : current ? (
        <>
          {featRule && (
            <div style={{ marginBottom: 10 }}>
              <p className="small muted" style={{ marginBottom: 4 }}>
                Raise one score by 1 (maximum {featRule.max})
              </p>
              <Chips
                label="Ability to raise"
                options={(featRule.abilities === "any" ? [...ABILITIES] : featRule.abilities).map((a) => ({ id: a, name: `${ABILITY_NAMES[a]} ${scoreBefore(a)}` }))}
                selected={ABILITIES.filter((a) => (inc[a] ?? 0) > 0)}
                disabled={(a) => scoreBefore(a) >= featRule.max}
                onToggle={(a) => update((c) => patchFeatAt(c, source, { abilityIncreases: { [a]: 1 } }))}
              />
            </div>
          )}
          <Markdown text={content.feats.find((f) => f.id === current.id)?.text ?? ""} />
        </>
      ) : null}
    </Block>
  );
}

export function ClassOptionsEditor({ character, update }: EditorProps) {
  const entry = character.build.classes[0]!;
  const cls = findClass(content, entry.id);
  const rule = classOptionRule(entry.id, entry.level, cls.progression[entry.level - 1]?.columns ?? {});
  if (!rule || rule.count === 0) return null;
  const list = cls.options.find((o) => o.id === rule.listId);
  if (!list) return null;
  const chosen = entry.options ?? [];
  const full = chosen.length >= rule.count;
  return (
    <Block title={rule.label} hint={`Choose ${rule.count} (${chosen.length} chosen). Options you don't meet the level or invocation prerequisite for are unavailable.`}>
      <div className="choice-grid">
        {list.items.map((item) => {
          const need = optionLevelPrerequisite(item.text);
          const requires = optionRequires(item.text);
          const picked = chosen.includes(item.id);
          const blocked = need > entry.level || (requires !== null && !chosen.includes(requires));
          const prereq = /\*Prerequisite: ([^*]+)\*/.exec(item.text)?.[1];
          return (
            <button
              key={item.id}
              type="button"
              className="choice"
              aria-pressed={picked}
              disabled={!picked && (blocked || full)}
              onClick={() =>
                update((c) => {
                  // Dropping an invocation also drops the ones that need it.
                  let next = picked ? chosen.filter((id) => id !== item.id) : [...chosen, item.id];
                  if (picked) next = next.filter((id) => optionRequires(list.items.find((i) => i.id === id)?.text ?? "") !== item.id);
                  return updateClassEntry(c, { options: next });
                })
              }
            >
              <strong>{item.name}</strong>
              {prereq && <small className="prereq">Needs {prereq.replace(/ Warlock/g, "").replace(/^Level (\d+)\+/, "level $1")}</small>}
              <small>{firstSentence(item.text.replace(/\*Prerequisite:[^*]+\*/, ""))}</small>
            </button>
          );
        })}
      </div>
    </Block>
  );
}

export function MysticArcanumEditor({ character, update, spellLevel }: { character: Character; update: Update; spellLevel: number }) {
  const cls = findClass(content, "warlock");
  const current = character.spells.arcanum?.[String(spellLevel)];
  return (
    <SpellChooser
      title={`Mystic Arcanum: level ${spellLevel} spell`}
      ids={cls.spellList[String(spellLevel)] ?? []}
      selected={current ? [current] : []}
      max={1}
      onToggle={(id) =>
        update((c) => {
          const arcanum = { ...(c.spells.arcanum ?? {}) };
          if (arcanum[String(spellLevel)] === id) delete arcanum[String(spellLevel)];
          else arcanum[String(spellLevel)] = id;
          return { ...c, spells: { ...c.spells, arcanum } };
        })
      }
    />
  );
}

/** Mystic Arcanum levels the Warlock has reached. */
export function arcanumLevels(character: Character): number[] {
  const entry = character.build.classes.find((e) => e.id === "warlock");
  return entry ? Object.entries(MYSTIC_ARCANUM).filter(([lvl]) => entry.level >= Number(lvl)).map(([, sl]) => sl) : [];
}

/** Shows an editor for each open choice, for the sheet's "To do" card after a level-up. */
export function PendingChoices({ character, sheet, update }: EditorProps) {
  const kinds = new Set(sheet.pending.map((p) => p.kind));
  const asis = sheet.pending.filter((p): p is PendingChoice & { level: number } => p.kind === "asi" && p.level !== undefined);
  // A feat that raises an ability needs its ASI or boon editor back to pick the ability.
  const featAbility = sheet.pending
    .filter((p) => p.kind === "feat-ability" && p.key)
    .map((p) => ({ boon: p.key!.startsWith("boon:"), level: Number(p.key!.split(":").pop()) }))
    .filter((f) => !Number.isNaN(f.level));
  const asiLevels = [...new Set([...asis.map((p) => p.level), ...featAbility.filter((f) => !f.boon).map((f) => f.level)])];
  const boon = kinds.has("epic-boon") || featAbility.some((f) => f.boon);
  const props = { character, sheet, update };
  return (
    <>
      {(kinds.has("species-option") || kinds.has("species-skill") || kinds.has("species-spell-ability") || kinds.has("origin-feat")) && <SpeciesEditor {...props} />}
      {kinds.has("background-abilities") && <BackgroundAbilityEditor {...props} />}
      {kinds.has("class-skills") && <ClassSkillsEditor {...props} />}
      {kinds.has("subclass") && <SubclassEditor {...props} />}
      {(kinds.has("class-choice") || kinds.has("subclass-choice")) && <ClassChoicesEditor {...props} />}
      {kinds.has("expertise") && <ExpertiseEditor {...props} />}
      {kinds.has("fighting-style") && <FightingStyleEditor {...props} />}
      {kinds.has("weapon-mastery") && <WeaponMasteryEditor {...props} />}
      {kinds.has("class-options") && <ClassOptionsEditor {...props} />}
      {asiLevels.map((level) => (
        <AsiEditor key={level} {...props} level={level} />
      ))}
      {boon && <AsiEditor {...props} level={EPIC_BOON_LEVEL} boon />}
      {sheet.pending
        .filter((p) => p.kind === "mystic-arcanum" && p.level)
        .map((p) => (
          <MysticArcanumEditor key={p.level} character={character} update={update} spellLevel={p.level!} />
        ))}
      {sheet.pending
        .filter((p) => p.kind === "magic-initiate" && p.key)
        .map((p) => (
          <MagicInitiateEditor key={p.key} character={character} source={p.key!} update={update} chooseList={p.key === "species"} />
        ))}
    </>
  );
}

function firstSentence(text: string): string {
  const plain = text.replace(/\*\*[^*]+\*\*\s*/g, "").replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(plain);
  return m ? m[1]! : plain.slice(0, 120);
}
