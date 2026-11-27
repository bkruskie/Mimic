/**
 * Encounters: fights the DM prepares (Prepare → Encounters) and runs in one tap (Play). See packages/table/src/encounters.ts.
 */
import { newId } from "@mimicbox/ruleset-dnd5e";
import { encounterXp, removeEncounter, runEncounter, saveEncounter, type Encounter, type EncounterGroup } from "@mimicbox/table";
import { useState } from "react";
import { MonsterSearch, rollHp, rollInitiative } from "./Bestiary";
import type { StudioCampaign } from "./store";

type Update = (fn: (c: StudioCampaign) => StudioCampaign) => void;
type Draft = Omit<Encounter, "updatedAt">;

const describeGroups = (e: Pick<Encounter, "groups">) => e.groups.map((g) => `${g.count} ${g.name}${g.hidden ? " (hidden)" : ""}`).join(", ") || "No creatures yet";

/** Runs an encounter with real dice: initiative rolled, hit points rolled from the stat block when known. */
export const runWithDice = (c: StudioCampaign, id: string): StudioCampaign => ({
  ...c,
  ...runEncounter(c, id, { initiative: rollInitiative, hp: (g: EncounterGroup) => rollHp(g.hpFormula, g.hp) }, newId),
});

export function EncountersPanel({ campaign, update }: { campaign: StudioCampaign; update: Update }) {
  const encounters = campaign.encounters ?? [];
  const maps = campaign.maps ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [searching, setSearching] = useState(false);
  const [count, setCount] = useState("1");
  const [own, setOwn] = useState({ name: "", bonus: "0", hp: "", ac: "" });
  const n = Math.max(1, Math.min(20, Number.parseInt(count, 10) || 1));

  const patchGroup = (id: string, p: Partial<EncounterGroup>) => setDraft((d) => d && { ...d, groups: d.groups.map((g) => (g.id === id ? { ...g, ...p } : g)) });
  const addGroup = (g: Omit<EncounterGroup, "id">) =>
    setDraft((d) => {
      if (!d) return d;
      // The same creature again adds to its group instead of making a second one.
      const same = d.groups.find((x) => x.name === g.name && x.monsterId === g.monsterId && x.hidden === g.hidden);
      return same ? { ...d, groups: d.groups.map((x) => (x === same ? { ...x, count: Math.min(20, x.count + g.count) } : x)) } : { ...d, groups: [...d.groups, { ...g, id: newId() }] };
    });

  if (draft) {
    return (
      <section className="section" aria-label="Encounter">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            update((c) => ({ ...c, ...saveEncounter(c, draft) }));
            setDraft(null);
          }}
        >
          <h2>{encounters.some((x) => x.id === draft.id) ? "Edit encounter" : "New encounter"}</h2>
          <div className="row" style={{ alignItems: "end" }}>
            <label className="field" style={{ flex: 2, minWidth: 180 }}>
              <span>Encounter name</span>
              <input className="input" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Docks ambush" />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              <span>Map</span>
              <select className="input" value={draft.mapId ?? ""} onChange={(e) => setDraft({ ...draft, mapId: e.target.value || null })}>
                <option value="">Whichever map is showing</option>
                {maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Notes for you</span>
            <textarea className="input" rows={2} value={draft.notes} maxLength={4000} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="They wait under the pier until someone crosses the gangplank." />
          </label>

          <h3>Creatures</h3>
          {draft.groups.length === 0 && <p className="muted small">Add creatures from the bestiary or your own below.</p>}
          <ul className="rows" aria-label="Creatures in this encounter">
            {draft.groups.map((g) => (
              <li key={g.id} className="resource spread" style={{ flexWrap: "wrap", gap: 8 }}>
                <span style={{ minWidth: 140, flex: 1 }}>
                  {g.name}
                  <br />
                  <span className="muted small">
                    {g.ac !== null ? `AC ${g.ac}, ` : ""}HP {g.hp}
                    {g.hpFormula ? ` (${g.hpFormula})` : ""}, initiative {g.initiativeBonus >= 0 ? "+" : ""}
                    {g.initiativeBonus}
                    {g.xp ? `, ${g.xp} XP each` : ""}
                  </span>
                </span>
                <label className="row" style={{ gap: 6, alignItems: "center" }}>
                  <span className="small">How many</span>
                  <input className="input init-input" inputMode="numeric" aria-label={`How many ${g.name}`} value={g.count} onChange={(e) => patchGroup(g.id, { count: Math.max(1, Math.min(20, Number.parseInt(e.target.value, 10) || 1)) })} />
                </label>
                <button type="button" className="chip" aria-pressed={g.hidden} onClick={() => patchGroup(g.id, { hidden: !g.hidden })}>
                  {g.hidden ? "Hidden" : "Seen"}
                </button>
                <button type="button" className="btn btn-quiet" aria-label={`Remove ${g.name}`} onClick={() => setDraft({ ...draft, groups: draft.groups.filter((x) => x.id !== g.id) })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {draft.groups.length > 0 && <p className="muted small">Total {encounterXp(draft).toLocaleString()} XP.</p>}

          <details className="bestiary-add" open={searching} onToggle={(e) => setSearching(e.currentTarget.open)}>
            <summary className="btn">Add from the bestiary</summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <label className="field" style={{ width: 80 }}>
                <span>How many</span>
                <input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
              </label>
              <MonsterSearch
                open={searching}
                count={n}
                onPick={(m) =>
                  addGroup({ name: m.name, count: n, hidden: false, monsterId: m.id, initiativeBonus: m.initiative.bonus, hp: m.hp.average, hpFormula: m.hp.formula, ac: m.ac, xp: m.xp })
                }
              />
            </div>
          </details>
          <div className="row" style={{ alignItems: "end" }}>
            <label className="field" style={{ flex: 2, minWidth: 140 }}>
              <span>Your own creature</span>
              <input className="input" value={own.name} maxLength={60} onChange={(e) => setOwn({ ...own, name: e.target.value })} placeholder="Harbour thug" />
            </label>
            <label className="field" style={{ width: 80 }}>
              <span>Init bonus</span>
              <input className="input" inputMode="numeric" value={own.bonus} onChange={(e) => setOwn({ ...own, bonus: e.target.value })} />
            </label>
            <label className="field" style={{ width: 70 }}>
              <span>HP</span>
              <input className="input" inputMode="numeric" value={own.hp} onChange={(e) => setOwn({ ...own, hp: e.target.value })} />
            </label>
            <label className="field" style={{ width: 70 }}>
              <span>AC</span>
              <input className="input" inputMode="numeric" value={own.ac} onChange={(e) => setOwn({ ...own, ac: e.target.value })} />
            </label>
            <button
              type="button"
              className="btn"
              disabled={!own.name.trim() || !(Number.parseInt(own.hp, 10) > 0)}
              onClick={() => {
                const ac = Number.parseInt(own.ac, 10);
                addGroup({ name: own.name.trim(), count: n, hidden: false, monsterId: null, initiativeBonus: Number.parseInt(own.bonus, 10) || 0, hp: Number.parseInt(own.hp, 10), hpFormula: null, ac: Number.isNaN(ac) ? null : ac, xp: 0 });
                setOwn({ name: "", bonus: "0", hp: "", ac: "" });
              }}
            >
              Add {n > 1 ? n : ""}
            </button>
          </div>

          <div className="row">
            <button className="btn btn-primary">Save encounter</button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDraft(null);
                setConfirmDelete(false);
              }}
            >
              Cancel
            </button>
            {encounters.some((x) => x.id === draft.id) &&
              (confirmDelete ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    update((c) => ({ ...c, ...removeEncounter(c, draft.id) }));
                    setDraft(null);
                    setConfirmDelete(false);
                  }}
                >
                  Delete {draft.name || "encounter"}
                </button>
              ) : (
                <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              ))}
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="section" aria-label="Encounters">
      <div className="spread">
        <h2>Encounters</h2>
        <button className="btn btn-primary" onClick={() => setDraft({ id: newId(), name: "", notes: "", mapId: campaign.activeMapId ?? null, groups: [] })}>
          New encounter
        </button>
      </div>
      {encounters.length === 0 && <p className="muted">Prepare fights ahead: the creatures, how many, and the map. In Play, one tap runs one into the fight.</p>}
      <ul className="rows">
        {encounters.map((e) => (
          <li key={e.id} className="resource spread">
            <span>
              {e.name}
              <br />
              <span className="muted small">
                {describeGroups(e)}. {encounterXp(e).toLocaleString()} XP
                {e.mapId ? `, on ${maps.find((m) => m.id === e.mapId)?.name ?? "a map"}` : ""}
              </span>
            </span>
            <button className="btn" aria-label={`Edit ${e.name}`} onClick={() => setDraft({ id: e.id, name: e.name, notes: e.notes, mapId: e.mapId, groups: e.groups })}>
              Edit
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Play: prepared encounters, each run into the fight with one tap. */
export function RunEncounters({ campaign, update }: { campaign: StudioCampaign; update: Update }) {
  const encounters = campaign.encounters ?? [];
  if (!encounters.length) return null;
  return (
    <section className="section" aria-label="Encounters to run">
      <h2>Encounters</h2>
      <ul className="rows">
        {encounters.map((e) => (
          <li key={e.id} className="resource spread">
            <span>
              {e.name}
              <br />
              <span className="muted small">{describeGroups(e)}</span>
              {e.notes && (
                <>
                  <br />
                  <span className="muted small">{e.notes}</span>
                </>
              )}
            </span>
            <button className="btn" aria-label={`Run ${e.name}`} disabled={e.groups.length === 0} onClick={() => update((c) => runWithDice(c, e.id))}>
              Run
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
