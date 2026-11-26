import { classOptionRule, derive, exportCharacter, findClass, levelUp, type Character } from "@mimicbox/ruleset-dnd5e";
import { useState } from "react";
import { go } from "../../App";
import { ClassOptionsEditor, PendingChoices } from "../../components/editors";
import { BonusForm, FeatureForm, describeBonus } from "../../components/homebrew";
import { Markdown } from "../../lib/markdown";
import { content, useApp } from "../../lib/state";
import { portraitFromFile } from "../../lib/edit";
import { Drawer, type SheetProps } from "../SheetScreen";

const NOTE_FIELDS: { key: keyof Character["notes"]; label: string }[] = [
  { key: "personality", label: "Personality, ideals and bonds" },
  { key: "appearance", label: "Appearance" },
  { key: "backstory", label: "Backstory" },
  { key: "other", label: "Other notes" },
];

export function NotesTab({ character, sheet, update, onHistory }: SheetProps & { onHistory: () => void }) {
  const { vault, refresh, toast } = useApp();
  const [levelling, setLevelling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingOptions, setEditingOptions] = useState(false);
  const [featureForm, setFeatureForm] = useState<{ id: string | null } | null>(null);
  const [bonusForm, setBonusForm] = useState<{ id: string | null } | null>(null);
  const hb = character.homebrew ?? { features: [], attacks: [], bonuses: [] };
  const entry = character.build.classes[0]!;
  const optionRule = classOptionRule(entry.id, entry.level, findClass(content, entry.id).progression[entry.level - 1]?.columns ?? {});

  function download() {
    const file = exportCharacter(character, content);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${character.name.replace(/[^\w -]+/g, "").trim() || "character"}.mimicbox-character`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Character file saved");
  }

  const groups = new Map<string, typeof sheet.features>();
  for (const f of sheet.features) groups.set(f.source, [...(groups.get(f.source) ?? []), f]);

  return (
    <>
      {sheet.pending.length > 0 && (
        <section className="section panel">
          <h2>To do</h2>
          <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {sheet.pending.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
          <PendingChoices character={character} sheet={sheet} update={(fn) => update(fn)} />
          {sheet.pending.some((p) => p.kind === "cantrips" || p.kind === "prepared") && <p className="muted small">Choose spells in the Spells tab.</p>}
        </section>
      )}
      {sheet.warnings.length > 0 && (
        <section className="section stack">
          {sheet.warnings.map((w, i) => (
            <p key={i} className="notice">
              {w}
            </p>
          ))}
        </section>
      )}

      <section className="section">
        <div className="spread">
          <h2>Level {sheet.level}</h2>
          <button className="btn btn-primary" disabled={entry.level >= 20} onClick={() => setLevelling(true)}>
            Level up
          </button>
        </div>
        {optionRule && optionRule.count > 0 && (
          <button className="btn" style={{ marginTop: 10 }} onClick={() => setEditingOptions(true)}>
            Change {optionRule.label}
          </button>
        )}
      </section>
      {editingOptions && optionRule && (
        <Drawer title={optionRule.label} onClose={() => setEditingOptions(false)}>
          <ClassOptionsEditor character={character} sheet={sheet} update={update} />
        </Drawer>
      )}

      <section className="section">
        <h2>Features and traits</h2>
        {[...groups.entries()].map(([source, list]) => (
          <div key={source} style={{ marginTop: 12 }}>
            <h3 className="muted" style={{ fontSize: "var(--t-md)", marginBottom: 6 }}>
              {source}
            </h3>
            {list.map((f, i) => (
              <details key={`${f.name}-${i}`} className="feature">
                <summary>
                  <span className="grow">{f.name}</span>
                  {f.level !== null && <span className="muted small">Level {f.level}</span>}
                </summary>
                <Markdown text={f.text} />
              </details>
            ))}
          </div>
        ))}
      </section>

      <section className="section">
        <h2>Homebrew</h2>
        <p className="muted small" style={{ margin: "4px 0 10px" }}>
          Your own features, magic items and bonuses. Bonuses are added to the numbers they change, and each number still explains where it comes from.
        </p>
        {hb.features.length + hb.bonuses.length > 0 && (
          <ul className="rows" aria-label="Your homebrew">
            {hb.features.map((f) => (
              <li key={f.id} className="resource spread">
                <span>
                  <strong>{f.name}</strong>
                  <br />
                  <span className="muted small">
                    {f.kind}
                    {f.uses ? `, ${f.uses.max} use${f.uses.max === 1 ? "" : "s"} per ${f.uses.reset === "long" ? "Long Rest" : "Short or Long Rest"}` : ""}
                  </span>
                </span>
                <button className="btn btn-quiet" aria-label={`Edit ${f.name}`} onClick={() => setFeatureForm({ id: f.id })}>
                  Edit
                </button>
              </li>
            ))}
            {hb.bonuses.map((b) => (
              <li key={b.id} className="resource spread">
                <span>
                  <strong>{b.label}</strong>
                  <br />
                  <span className="muted small">{describeBonus(b, character)}</span>
                </span>
                <button className="btn btn-quiet" aria-label={`Edit ${b.label}`} onClick={() => setBonusForm({ id: b.id })}>
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => setFeatureForm({ id: null })}>
            Add a feature
          </button>
          <button className="btn" onClick={() => setBonusForm({ id: null })}>
            Add a bonus
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Add your own attacks on the Actions tab.
        </p>
      </section>
      {featureForm && <FeatureForm feature={hb.features.find((f) => f.id === featureForm.id) ?? null} update={update} onClose={() => setFeatureForm(null)} />}
      {bonusForm && <BonusForm bonus={hb.bonuses.find((b) => b.id === bonusForm.id) ?? null} character={character} update={update} onClose={() => setBonusForm(null)} />}

      <section className="section stack">
        <h2>Notes</h2>
        {NOTE_FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <textarea
              className="input"
              value={character.notes[f.key]}
              onChange={(e) => update((c) => ({ ...c, updatedAt: new Date().toISOString(), notes: { ...c.notes, [f.key]: e.target.value } }))}
            />
          </label>
        ))}
      </section>

      <section className="section stack">
        <h2>Character</h2>
        <label className="field">
          <span>Name</span>
          <input className="input" value={character.name} onChange={(e) => update((c) => ({ ...c, updatedAt: new Date().toISOString(), name: e.target.value }))} />
        </label>
        <label className="field">
          <span>Languages</span>
          <input
            className="input"
            value={character.build.languages}
            onChange={(e) => update((c) => ({ ...c, updatedAt: new Date().toISOString(), build: { ...c.build, languages: e.target.value } }))}
          />
        </label>
        <label className="field">
          <span>Tool proficiencies you chose</span>
          <input
            className="input"
            placeholder="For example: Lute, Dice set"
            value={character.build.toolNotes}
            onChange={(e) => update((c) => ({ ...c, updatedAt: new Date().toISOString(), build: { ...c.build, toolNotes: e.target.value } }))}
          />
        </label>
        <div className="row">
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
                  update((c) => ({ ...c, updatedAt: new Date().toISOString(), portrait }));
                }
              }}
            />
          </label>
          <button className="btn" onClick={download}>
            Export character file
          </button>
          <button className="btn" onClick={onHistory}>
            Roll history
          </button>
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete character
          </button>
        </div>
        <p className="muted small">
          An exported file is a full copy you can keep anywhere, import on another device, or bring to a game later.
        </p>
      </section>

      <p className="footer-note">{content.pack.attribution}</p>

      {levelling && (
        <LevelUpDrawer
          character={character}
          onClose={() => setLevelling(false)}
          onConfirm={(roll) => {
            const next = levelUp(character, content, { classId: entry.id, hitPointRoll: roll });
            const open = derive(next, content).pending.length;
            update(next);
            setLevelling(false);
            toast(open ? `Level ${sheet.level + 1}. You have new choices under To do.` : `Level ${sheet.level + 1}.`);
          }}
        />
      )}
      {confirmDelete && (
        <Drawer title={`Delete ${character.name}?`} onClose={() => setConfirmDelete(false)}>
          <p>The character moves to Deleted characters in your vault, where you can restore it.</p>
          <button
            className="btn btn-danger"
            onClick={async () => {
              await vault?.remove(character.id);
              await refresh();
              toast(`Deleted ${character.name}`);
              go({ name: "vault" });
            }}
          >
            Delete character
          </button>
        </Drawer>
      )}
    </>
  );
}

function LevelUpDrawer({ character, onClose, onConfirm }: { character: Character; onClose: () => void; onConfirm: (roll: number | null) => void }) {
  const entry = character.build.classes[0]!;
  const cls = findClass(content, entry.id);
  const next = entry.level + 1;
  const row = cls.progression[next - 1]!;
  const [mode, setMode] = useState<"average" | "roll">("average");
  const [rolled, setRolled] = useState("");
  const rollValue = Math.floor(Number(rolled));
  const valid = mode === "average" || (rollValue >= 1 && rollValue <= cls.hitDie);
  return (
    <Drawer title={`${cls.name} level ${next}`} onClose={onClose}>
      <p>
        New at level {next}: {row.features.length ? row.features.join(", ") : "no new class features"}.
      </p>
      <h3>Hit points</h3>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="chip" aria-pressed={mode === "average"} onClick={() => setMode("average")}>
          Take the average ({cls.hitDie / 2 + 1})
        </button>
        <button className="chip" aria-pressed={mode === "roll"} onClick={() => setMode("roll")}>
          Enter a d{cls.hitDie} roll
        </button>
      </div>
      {mode === "roll" && (
        <label className="field" style={{ marginTop: 10 }}>
          <span>Your d{cls.hitDie} roll</span>
          <input className="input" type="number" inputMode="numeric" min={1} max={cls.hitDie} value={rolled} onChange={(e) => setRolled(e.target.value)} />
        </label>
      )}
      <p className="muted small" style={{ marginTop: 10 }}>
        Your Constitution modifier is added automatically. New choices, such as a subclass or an Ability Score Improvement, appear under To do.
      </p>
      <p className="muted small">Multiclassing arrives in a later release.</p>
      <button className="btn btn-primary" disabled={!valid} onClick={() => onConfirm(mode === "roll" ? rollValue : null)}>
        Reach level {next}
      </button>
    </Drawer>
  );
}
