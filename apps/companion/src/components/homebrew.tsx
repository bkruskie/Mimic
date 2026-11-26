/**
 * Forms for the player's own features, attacks and bonuses. Everything here is stored on the character
 * and computed by the rules engine like any other source, so the sheet can still explain every number.
 */
import { DiceSyntaxError, parseDice } from "@mimicbox/dice";
import {
  ABILITIES,
  ABILITY_NAMES,
  SKILLS,
  SKILL_IDS,
  newId,
  removeHomebrew,
  saveHomebrew,
  type BonusTarget,
  type Character,
  type HomebrewAttack,
  type HomebrewBonus,
  type HomebrewFeature,
  type HomebrewSubclass,
} from "@mimicbox/ruleset-dnd5e";
import { useState, type ReactNode } from "react";
import { Drawer } from "../screens/SheetScreen";
import type { Update } from "./editors";

export const BONUS_TARGETS: { id: BonusTarget; name: string }[] = [
  { id: "ac", name: "Armor Class" },
  { id: "saves", name: "All saving throws" },
  ...ABILITIES.map((a) => ({ id: `save:${a}` as BonusTarget, name: `${ABILITY_NAMES[a]} saving throw` })),
  ...ABILITIES.map((a) => ({ id: `ability:${a}` as BonusTarget, name: `${ABILITY_NAMES[a]} score` })),
  ...SKILL_IDS.map((s) => ({ id: `skill:${s}` as BonusTarget, name: `${SKILLS[s].name} checks` })),
  { id: "initiative", name: "Initiative" },
  { id: "speed", name: "Speed (feet)" },
  { id: "hpMax", name: "Hit point maximum" },
  { id: "attack", name: "Weapon attack rolls" },
  { id: "spellDc", name: "Spell save DC" },
  { id: "spellAttack", name: "Spell attack rolls" },
];
export const targetName = (t: BonusTarget) => BONUS_TARGETS.find((x) => x.id === t)?.name ?? t;

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

function FormActions({ onSave, saveLabel, canSave, problem, onDelete }: { onSave: () => void; saveLabel: string; canSave: boolean; problem: string | null; onDelete?: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      {problem && <p className="notice small">{problem}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={!canSave} onClick={onSave}>
          {saveLabel}
        </button>
        {onDelete &&
          (confirm ? (
            <button className="btn btn-danger" onClick={onDelete}>
              Delete for good
            </button>
          ) : (
            <button className="btn" onClick={() => setConfirm(true)}>
              Delete
            </button>
          ))}
      </div>
    </div>
  );
}

const int = (v: string) => (v.trim() === "" || v.trim() === "-" ? NaN : Number.parseInt(v, 10));

// ---------- features ----------

export function FeatureForm({ feature, update, onClose }: { feature: HomebrewFeature | null; update: Update; onClose: () => void }) {
  const [name, setName] = useState(feature?.name ?? "");
  const [kind, setKind] = useState(feature?.kind ?? "Feat");
  const [text, setText] = useState(feature?.text ?? "");
  const [limited, setLimited] = useState(Boolean(feature?.uses));
  const [max, setMax] = useState(String(feature?.uses?.max ?? 1));
  const [reset, setReset] = useState<"long" | "short">(feature?.uses?.reset ?? "long");
  const uses = int(max);
  const problem = !name.trim() ? "Give the feature a name." : limited && !(uses >= 1 && uses <= 99) ? "Uses must be a whole number from 1 to 99." : null;
  return (
    <Drawer title={feature ? `Edit ${feature.name}` : "Add a feature"} onClose={onClose}>
      <div className="stack">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lucky Charm" />
        </Field>
        <Field label="Group" hint="Features are listed under this heading.">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {["Feat", "Magic item", "Boon", "Trait", "Class feature", "Other"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="What it does">
          <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <label className="row" style={{ alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} />
          <span>It has limited uses</span>
        </label>
        {limited && (
          <div className="row">
            <Field label="Uses">
              <input className="input" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} style={{ width: 90 }} />
            </Field>
            <Field label="Regain on">
              <select className="input" value={reset} onChange={(e) => setReset(e.target.value as "long" | "short")}>
                <option value="long">Long Rest</option>
                <option value="short">Short or Long Rest</option>
              </select>
            </Field>
          </div>
        )}
      </div>
      <FormActions
        saveLabel={feature ? "Save feature" : "Add feature"}
        canSave={!problem}
        problem={name ? problem : null}
        onSave={() => {
          update((c) => saveHomebrew(c, "features", { id: feature?.id ?? newId(), name: name.trim(), kind, text, uses: limited ? { max: uses, reset } : null }));
          onClose();
        }}
        onDelete={feature ? () => (update((c) => removeHomebrew(c, "features", feature.id)), onClose()) : undefined}
      />
    </Drawer>
  );
}

// ---------- attacks ----------

export function AttackForm({ attack, update, onClose }: { attack: HomebrewAttack | null; update: Update; onClose: () => void }) {
  const [name, setName] = useState(attack?.name ?? "");
  const [ability, setAbility] = useState<HomebrewAttack["ability"]>(attack?.ability ?? "str");
  const [proficient, setProficient] = useState(attack?.proficient ?? true);
  const [bonus, setBonus] = useState(String(attack?.toHitBonus ?? 0));
  const [damage, setDamage] = useState(attack?.damage ?? "1d6");
  const [addModifier, setAddModifier] = useState(attack?.addModifier ?? true);
  const [damageType, setDamageType] = useState(attack?.damageType ?? "");
  const [range, setRange] = useState(attack?.range ?? "5 ft.");
  const [notes, setNotes] = useState(attack?.notes ?? "");
  let damageProblem: string | null = null;
  try {
    parseDice(damage);
  } catch (e) {
    damageProblem = e instanceof DiceSyntaxError ? `Damage: ${e.message}` : "Damage isn't a dice roll, such as 1d8 or 2d6+1.";
  }
  const b = int(bonus);
  const problem = !name.trim() ? "Give the attack a name." : damageProblem ?? (Number.isNaN(b) || Math.abs(b) > 20 ? "Extra bonus must be a whole number from -20 to 20." : null);
  return (
    <Drawer title={attack ? `Edit ${attack.name}` : "Add an attack"} onClose={onClose}>
      <div className="stack">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Flame Tongue" />
        </Field>
        <Field label="Uses this ability">
          <select className="input" value={ability} onChange={(e) => setAbility(e.target.value as HomebrewAttack["ability"])}>
            {ABILITIES.map((a) => (
              <option key={a} value={a}>
                {ABILITY_NAMES[a]}
              </option>
            ))}
            <option value="spell">Spellcasting ability</option>
            <option value="none">No ability modifier</option>
          </select>
        </Field>
        <label className="row" style={{ alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={proficient} onChange={(e) => setProficient(e.target.checked)} />
          <span>Add my Proficiency Bonus</span>
        </label>
        <Field label="Extra bonus to hit" hint="For example 1 for a +1 weapon.">
          <input className="input" inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value)} style={{ width: 90 }} />
        </Field>
        <Field label="Damage dice" hint="For example 1d8, 2d6 or 1d10+1.">
          <input className="input" value={damage} onChange={(e) => setDamage(e.target.value)} />
        </Field>
        <label className="row" style={{ alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={addModifier} onChange={(e) => setAddModifier(e.target.checked)} />
          <span>Add the ability modifier to damage</span>
        </label>
        <div className="row">
          <Field label="Damage type">
            <input className="input" value={damageType} onChange={(e) => setDamageType(e.target.value)} placeholder="slashing" />
          </Field>
          <Field label="Range">
            <input className="input" value={range} onChange={(e) => setRange(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="+2d6 Fire while ablaze" />
        </Field>
      </div>
      <FormActions
        saveLabel={attack ? "Save attack" : "Add attack"}
        canSave={!problem}
        problem={name ? problem : null}
        onSave={() => {
          update((c) =>
            saveHomebrew(c, "attacks", {
              id: attack?.id ?? newId(),
              name: name.trim(),
              ability,
              proficient,
              toHitBonus: b,
              damage: damage.trim(),
              addModifier,
              damageType: damageType.trim(),
              range: range.trim(),
              notes: notes.trim(),
            }),
          );
          onClose();
        }}
        onDelete={attack ? () => (update((c) => removeHomebrew(c, "attacks", attack.id)), onClose()) : undefined}
      />
    </Drawer>
  );
}

// ---------- bonuses ----------

export function BonusForm({ bonus, character, update, onClose }: { bonus: HomebrewBonus | null; character: Character; update: Update; onClose: () => void }) {
  const [label, setLabel] = useState(bonus?.label ?? "");
  const [target, setTarget] = useState<BonusTarget>(bonus?.target ?? "ac");
  const [value, setValue] = useState(String(bonus?.value ?? 1));
  const [setMinimum, setSetMinimum] = useState(bonus?.setMinimum ?? false);
  const [itemId, setItemId] = useState(bonus?.itemId ?? "");
  const isScore = target.startsWith("ability:");
  const v = int(value);
  const range = isScore && setMinimum ? [1, 30] : [-30, 30];
  const problem = !label.trim()
    ? "Say where the bonus comes from, such as the item's name."
    : Number.isNaN(v) || v < range[0]! || v > range[1]!
      ? `The value must be a whole number from ${range[0]} to ${range[1]}.`
      : null;
  return (
    <Drawer title={bonus ? `Edit ${bonus.label}` : "Add a bonus"} onClose={onClose}>
      <div className="stack">
        <Field label="Comes from" hint="Shown wherever the number is explained.">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ring of Protection" />
        </Field>
        <Field label="Changes">
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value as BonusTarget)}>
            {BONUS_TARGETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        {isScore && (
          <div className="row" role="group" aria-label="How it changes the score">
            <button type="button" className="chip" aria-pressed={!setMinimum} onClick={() => setSetMinimum(false)}>
              Adds to it
            </button>
            <button type="button" className="chip" aria-pressed={setMinimum} onClick={() => setSetMinimum(true)}>
              Sets it to at least
            </button>
          </div>
        )}
        <Field label={isScore && setMinimum ? "Score" : "Amount"} hint={isScore && setMinimum ? "Like Gauntlets of Ogre Power: Strength becomes 19 unless it's already higher." : "Use a minus sign for a penalty."}>
          <input className="input" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 90 }} />
        </Field>
        <Field label="Counts" hint="Tie it to an item to have it count only while that item is equipped.">
          <select className="input" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Always</option>
            {character.inventory.map((i) => (
              <option key={i.id} value={i.id}>
                While {i.name} is equipped
              </option>
            ))}
          </select>
        </Field>
      </div>
      <FormActions
        saveLabel={bonus ? "Save bonus" : "Add bonus"}
        canSave={!problem}
        problem={label ? problem : null}
        onSave={() => {
          update((c) => saveHomebrew(c, "bonuses", { id: bonus?.id ?? newId(), label: label.trim(), target, value: v, setMinimum: isScore && setMinimum, itemId: itemId || null }));
          onClose();
        }}
        onDelete={bonus ? () => (update((c) => removeHomebrew(c, "bonuses", bonus.id)), onClose()) : undefined}
      />
    </Drawer>
  );
}

export function describeBonus(b: HomebrewBonus, character: Character): string {
  const what = targetName(b.target);
  const amount = b.setMinimum ? `${what} becomes at least ${b.value}` : `${b.value >= 0 ? "+" : ""}${b.value} ${what}`;
  const item = b.itemId ? character.inventory.find((i) => i.id === b.itemId) : null;
  return item ? `${amount}, while ${item.name} is equipped` : b.itemId ? `${amount} (its item is gone)` : amount;
}


// ---------- subclasses ----------

interface DraftFeature {
  id: string;
  level: string;
  name: string;
  text: string;
  limited: boolean;
  max: string;
  reset: "long" | "short";
}

export function SubclassForm({
  subclass,
  classId,
  className,
  update,
  onClose,
  onCreated,
}: {
  subclass: HomebrewSubclass | null;
  classId: string;
  className: string;
  update: Update;
  onClose: () => void;
  /** Called with the new id when a subclass is created, so the editor can choose it. */
  onCreated?: (id: string) => void;
}) {
  const [name, setName] = useState(subclass?.name ?? "");
  const [description, setDescription] = useState(subclass?.description ?? "");
  const [features, setFeatures] = useState<DraftFeature[]>(
    subclass?.features.map((f) => ({ id: f.id, level: String(f.level), name: f.name, text: f.text, limited: Boolean(f.uses), max: String(f.uses?.max ?? 1), reset: f.uses?.reset ?? "long" })) ?? [
      { id: newId(), level: "3", name: "", text: "", limited: false, max: "1", reset: "long" },
    ],
  );
  const patch = (id: string, p: Partial<DraftFeature>) => setFeatures((list) => list.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const bad = features.find((f) => !f.name.trim() || !(int(f.level) >= 1 && int(f.level) <= 20) || (f.limited && !(int(f.max) >= 1 && int(f.max) <= 99)));
  const problem = !name.trim()
    ? "Give the subclass a name."
    : features.length === 0
      ? "Add at least one feature."
      : bad
        ? !bad.name.trim()
          ? "Every feature needs a name."
          : "Feature levels must be 1 to 20, and uses 1 to 99."
        : null;
  return (
    <Drawer title={subclass ? `Edit ${subclass.name}` : `Create a ${className} subclass`} onClose={onClose}>
      <div className="stack">
        <Field label="Subclass name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ember Knight" />
        </Field>
        <Field label="Description">
          <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <h3>Features</h3>
        {features.map((f, i) => (
          <fieldset key={f.id} className="stack" style={{ border: 0, marginInline: 0, padding: 14, borderRadius: "var(--r-md)", background: "var(--hollow)" }} aria-label={`Feature ${i + 1}`}>
            <strong>Feature {i + 1}</strong>
            <div className="row">
              <Field label="Class level">
                <select className="input" value={f.level} onChange={(e) => patch(f.id, { level: e.target.value })}>
                  {Array.from({ length: 20 }, (_, l) => (
                    <option key={l + 1} value={l + 1}>
                      {l + 1}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Feature name">
                <input className="input" value={f.name} onChange={(e) => patch(f.id, { name: e.target.value })} />
              </Field>
            </div>
            <Field label="What it does">
              <textarea className="input" value={f.text} onChange={(e) => patch(f.id, { text: e.target.value })} />
            </Field>
            <label className="row" style={{ alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={f.limited} onChange={(e) => patch(f.id, { limited: e.target.checked })} />
              <span>It has limited uses</span>
            </label>
            {f.limited && (
              <div className="row">
                <Field label="Uses">
                  <input className="input" inputMode="numeric" value={f.max} onChange={(e) => patch(f.id, { max: e.target.value })} style={{ width: 90 }} />
                </Field>
                <Field label="Regain on">
                  <select className="input" value={f.reset} onChange={(e) => patch(f.id, { reset: e.target.value as "long" | "short" })}>
                    <option value="long">Long Rest</option>
                    <option value="short">Short or Long Rest</option>
                  </select>
                </Field>
              </div>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => setFeatures((list) => list.filter((x) => x.id !== f.id))}>
              Remove this feature
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn"
          onClick={() => setFeatures((list) => [...list, { id: newId(), level: String(Math.min(20, (int(list.at(-1)?.level ?? "2") || 2) + 3)), name: "", text: "", limited: false, max: "1", reset: "long" }])}
        >
          Add a feature
        </button>
      </div>
      <FormActions
        saveLabel={subclass ? "Save subclass" : "Create subclass"}
        canSave={!problem}
        problem={name || features.some((f) => f.name) ? problem : null}
        onSave={() => {
          const id = subclass?.id ?? `hb-${newId()}`;
          update((c) =>
            saveHomebrew(c, "subclasses", {
              id,
              classId,
              name: name.trim(),
              description: description.trim(),
              features: features
                .map((f) => ({ id: f.id, level: int(f.level), name: f.name.trim(), text: f.text, uses: f.limited ? { max: int(f.max), reset: f.reset } : null }))
                .sort((a, b) => a.level - b.level),
            }),
          );
          if (!subclass) onCreated?.(id);
          onClose();
        }}
        onDelete={subclass ? () => (update((c) => removeHomebrew(c, "subclasses", subclass.id)), onClose()) : undefined}
      />
    </Drawer>
  );
}
