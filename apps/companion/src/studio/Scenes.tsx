/**
 * Scenes: the DM's plan, in order (Prepare → Scenes), and the scene being played with everything it needs one
 * tap away (Play). See packages/table/src/scenes.ts.
 */
import { newId } from "@mimicbox/ruleset-dnd5e";
import {
  beginScene,
  currentScene,
  moveScene,
  nextScene,
  removeScene,
  saveScene,
  SCENE_LINKS_MAX,
  SCENE_NOTES_MAX,
  SCENE_TITLE_MAX,
  setEntryRevealed,
  setHandoutRevealed,
  setSceneDone,
  type Scene,
} from "@mimicbox/table";
import { useState } from "react";
import { Markdown } from "../lib/markdown";
import { runWithDice } from "./Encounters";
import type { StudioCampaign } from "./store";

type Update = (fn: (c: StudioCampaign) => StudioCampaign) => void;
type Draft = Omit<Scene, "done">;

/** What a scene gathers, in a few words: "docks map, Docks ambush, 2 handouts". */
function sceneParts(c: StudioCampaign, s: Scene): string {
  const parts: string[] = [];
  const map = (c.maps ?? []).find((m) => m.id === s.mapId);
  const fight = (c.encounters ?? []).find((e) => e.id === s.encounterId);
  if (map) parts.push(`${map.name} map`);
  if (fight) parts.push(fight.name);
  const handouts = s.handoutIds.filter((id) => (c.handouts ?? []).some((h) => h.id === id)).length;
  const pages = s.entryIds.filter((id) => (c.world ?? []).some((e) => e.id === id)).length;
  if (handouts) parts.push(`${handouts} handout${handouts === 1 ? "" : "s"}`);
  if (pages) parts.push(`${pages} world page${pages === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function Picks({ legend, options, chosen, onChange }: { legend: string; options: { id: string; label: string }[]; chosen: string[]; onChange: (ids: string[]) => void }) {
  if (!options.length) return null;
  const full = chosen.length >= SCENE_LINKS_MAX;
  return (
    <fieldset className="field scene-picks">
      <legend>{legend}</legend>
      <div className="scene-pick-list">
        {options.map((o) => {
          const on = chosen.includes(o.id);
          return (
            <label key={o.id} className="check">
              <input type="checkbox" checked={on} disabled={!on && full} onChange={() => onChange(on ? chosen.filter((x) => x !== o.id) : [...chosen, o.id])} />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ScenesPanel({ campaign, update }: { campaign: StudioCampaign; update: Update }) {
  const scenes = campaign.scenes ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (draft) {
    const existing = scenes.some((s) => s.id === draft.id);
    return (
      <section className="section" aria-label="Scene">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            update((c) => ({ ...c, ...saveScene(c, draft) }));
            setDraft(null);
          }}
        >
          <h2>{existing ? "Edit scene" : "New scene"}</h2>
          <label className="field">
            <span>Scene title</span>
            <input className="input" value={draft.title} maxLength={SCENE_TITLE_MAX} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Arrival at the docks" />
          </label>
          <label className="field">
            <span>Notes for you</span>
            <textarea
              className="input"
              style={{ minHeight: 120 }}
              value={draft.notes}
              maxLength={SCENE_NOTES_MAX}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Mara waits by the boat. If they ask about the bell, she lies."
            />
          </label>
          <div className="row" style={{ alignItems: "end" }}>
            <label className="field" style={{ flex: 1, minWidth: 180 }}>
              <span>Map</span>
              <select className="input" value={draft.mapId ?? ""} onChange={(e) => setDraft({ ...draft, mapId: e.target.value || null })}>
                <option value="">Keep the map that's showing</option>
                {(campaign.maps ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1, minWidth: 180 }}>
              <span>Fight</span>
              <select className="input" value={draft.encounterId ?? ""} onChange={(e) => setDraft({ ...draft, encounterId: e.target.value || null })}>
                <option value="">No fight</option>
                {(campaign.encounters ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Picks legend="Handouts to give" options={(campaign.handouts ?? []).map((h) => ({ id: h.id, label: h.title }))} chosen={draft.handoutIds} onChange={(handoutIds) => setDraft({ ...draft, handoutIds })} />
          <Picks legend="World pages to reveal" options={(campaign.world ?? []).map((e) => ({ id: e.id, label: e.title }))} chosen={draft.entryIds} onChange={(entryIds) => setDraft({ ...draft, entryIds })} />
          <div className="row">
            <button className="btn btn-primary">Save scene</button>
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
            {existing &&
              (confirmDelete ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    update((c) => ({ ...c, ...removeScene(c, draft.id) }));
                    setDraft(null);
                    setConfirmDelete(false);
                  }}
                >
                  Delete {draft.title || "this scene"}
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
    <section className="section" aria-label="Scenes">
      <div className="spread">
        <h2>Scenes</h2>
        <button className="btn btn-primary" onClick={() => setDraft({ id: newId(), title: "", notes: "", mapId: null, encounterId: null, handoutIds: [], entryIds: [] })}>
          New scene
        </button>
      </div>
      {scenes.length === 0 && (
        <p className="muted">Plan the game as scenes, in order. Each holds your notes, the map to show, the fight to run, and the handouts and pages to reveal, so in Play they're one tap away.</p>
      )}
      <ol className="rows scene-list">
        {scenes.map((s, i) => (
          <li key={s.id} className={`resource spread${s.done ? " scene-done" : ""}`}>
            <span className="scene-number" aria-hidden>
              {i + 1}
            </span>
            <span className="scene-summary">
              {s.title}
              {s.id === campaign.currentSceneId && <span className="presence here"> Playing now</span>}
              {s.done && <span className="muted small"> Played</span>}
              <br />
              <span className="muted small">{sceneParts(campaign, s) || "Notes only"}</span>
            </span>
            <span className="row scene-actions">
              <button className="btn btn-quiet" aria-label={`Move ${s.title} earlier`} disabled={i === 0} onClick={() => update((c) => ({ ...c, ...moveScene(c, s.id, -1) }))}>
                ↑
              </button>
              <button className="btn btn-quiet" aria-label={`Move ${s.title} later`} disabled={i === scenes.length - 1} onClick={() => update((c) => ({ ...c, ...moveScene(c, s.id, 1) }))}>
                ↓
              </button>
              <button className="btn" aria-label={`Edit ${s.title}`} onClick={() => setDraft({ id: s.id, title: s.title, notes: s.notes, mapId: s.mapId, encounterId: s.encounterId, handoutIds: s.handoutIds, entryIds: s.entryIds })}>
                Edit
              </button>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Play: the scene being played and what it gathers, then the next one. Nothing when no scenes are planned. */
export function ScenePlay({ campaign, update }: { campaign: StudioCampaign; update: Update }) {
  const scene = currentScene(campaign);
  const next = nextScene(campaign);
  if (!(campaign.scenes ?? []).length) return null;
  const begin = (id: string) => update((c) => ({ ...c, ...beginScene(c, id) }));

  if (!scene)
    return (
      <section className="section" aria-label="Scene">
        <div className="spread">
          <h2>Scene</h2>
          {next && (
            <button className="btn btn-primary" onClick={() => begin(next.id)}>
              Begin {next.title}
            </button>
          )}
        </div>
        {!next && <p className="muted small">Every planned scene has been played. Plan more in Prepare.</p>}
      </section>
    );

  const handouts = scene.handoutIds.flatMap((id) => (campaign.handouts ?? []).filter((h) => h.id === id));
  const pages = scene.entryIds.flatMap((id) => (campaign.world ?? []).filter((e) => e.id === id));
  const fight = (campaign.encounters ?? []).find((e) => e.id === scene.encounterId) ?? null;
  return (
    <section className="section scene-play" aria-label="Scene">
      <div className="spread">
        <h2>{scene.title}</h2>
        {next ? (
          <button className="btn" aria-label={`Next scene: ${next.title}`} title={next.title} onClick={() => begin(next.id)}>
            Next scene
          </button>
        ) : (
          <button className="btn" onClick={() => update((c) => ({ ...c, ...setSceneDone(c, scene.id, true) }))}>
            Finish scene
          </button>
        )}
      </div>
      {scene.notes && <Markdown text={scene.notes} className="prose scene-notes" />}
      {(fight || handouts.length > 0 || pages.length > 0) && (
        <ul className="rows" aria-label="In this scene">
          {fight && (
            <li className="resource spread">
              <span>
                {fight.name}
                <br />
                <span className="muted small">{campaign.combat ? "A fight is running" : "Fight"}</span>
              </span>
              <button className="btn" aria-label={`Run ${fight.name}`} disabled={fight.groups.length === 0} onClick={() => update((c) => runWithDice(c, fight.id))}>
                Run
              </button>
            </li>
          )}
          {handouts.map((h) => (
            <li key={h.id} className="resource spread">
              <span>
                {h.title}
                <br />
                <span className="muted small">{h.revealed ? "Shown to the party" : "Handout, only you"}</span>
              </span>
              <button className={h.revealed ? "btn btn-quiet" : "btn"} aria-label={`${h.revealed ? "Hide" : "Show"} ${h.title}`} onClick={() => update((c) => ({ ...c, ...setHandoutRevealed(c, h.id, !h.revealed) }))}>
                {h.revealed ? "Hide" : "Show"}
              </button>
            </li>
          ))}
          {pages.map((e) => (
            <li key={e.id} className="resource spread">
              <span>
                {e.title}
                <br />
                <span className="muted small">{e.revealed ? "In the party's journal" : "World page, only you"}</span>
              </span>
              <button className={e.revealed ? "btn btn-quiet" : "btn"} aria-label={`${e.revealed ? "Hide" : "Reveal"} ${e.title}`} onClick={() => update((c) => ({ ...c, ...setEntryRevealed(c, e.id, !e.revealed) }))}>
                {e.revealed ? "Hide" : "Reveal"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
