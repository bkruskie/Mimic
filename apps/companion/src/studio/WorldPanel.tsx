/**
 * The DM's world notes. Each entry is a list of paragraphs with their own reveal switch, and an entry can sit inside
 * a place. Players see an entry once it's revealed, and only its revealed paragraphs.
 */
import { newId } from "@mimicbox/ruleset-dnd5e";
import { QUEST_STATUSES, WORLD_KINDS, WORLD_TEXT_MAX, removeWorldEntry, saveWorldEntry, type WorldEntry, type WorldKind } from "@mimicbox/table";
import { useState } from "react";
import { PicturePicker, useDraftPictures } from "./pictures";
import { deleteImage, type StudioCampaign } from "./store";

export const KIND_NAMES: Record<WorldKind, { one: string; many: string }> = {
  place: { one: "Place", many: "Places" },
  person: { one: "Person", many: "People" },
  faction: { one: "Faction", many: "Factions" },
  quest: { one: "Quest", many: "Quests" },
  lore: { one: "Lore", many: "Lore" },
};
export const QUEST_NAMES = { active: "Active", done: "Done", failed: "Failed" } as const;

type Draft = Omit<WorldEntry, "updatedAt">;

export function WorldPanel({ campaign, update }: { campaign: StudioCampaign; update: (fn: (c: StudioCampaign) => StudioCampaign) => void }) {
  const world = campaign.world ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pictures = useDraftPictures();
  const depth = (e: WorldEntry): number => {
    let d = 0;
    for (let p = world.find((x) => x.id === e.parentId); p && d < 6; p = world.find((x) => x.id === p!.parentId)) d++;
    return d;
  };
  // Parents first, children right after them.
  const ordered: WorldEntry[] = [];
  const add = (parent: string | null) => {
    for (const e of world.filter((x) => x.parentId === parent).sort((a, b) => a.title.localeCompare(b.title))) {
      ordered.push(e);
      add(e.id);
    }
  };
  add(null);
  const start = (kind: WorldKind) => {
    setConfirmDelete(false);
    pictures.discard();
    setDraft({ id: newId(), kind, title: "", parentId: null, revealed: false, blocks: [{ id: newId(), text: "", revealed: false }], questStatus: kind === "quest" ? "active" : null, image: null });
  };
  const save = () => {
    if (!draft || !draft.title.trim()) return;
    const previous = world.find((x) => x.id === draft.id)?.image?.id ?? null;
    update((c) => ({ ...c, ...saveWorldEntry(c, draft) }));
    pictures.kept(draft.image?.id ?? null, previous);
    setDraft(null);
  };
  const patchBlock = (id: string, p: Partial<Draft["blocks"][number]>) => setDraft((d) => d && { ...d, blocks: d.blocks.map((b) => (b.id === id ? { ...b, ...p } : b)) });

  return (
    <section className="section" aria-label="World">
      <h2>World</h2>
      <p className="muted small" style={{ marginTop: 4 }}>
        Places, people, factions, quests and lore. Players see an entry only once you reveal it, and only the paragraphs you mark as shown.
      </p>
      <div className="row" style={{ marginTop: 8 }}>
        {WORLD_KINDS.map((k) => (
          <button key={k} className="btn btn-quiet" onClick={() => start(k)}>
            New {KIND_NAMES[k].one.toLowerCase()}
          </button>
        ))}
      </div>
      {draft && (
        <form
          className="panel stack handout-card"
          aria-label="World entry"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="row">
            <label className="field" style={{ flex: 2, minWidth: 180 }}>
              <span>{KIND_NAMES[draft.kind].one} name</span>
              <input className="input" value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              <span>Inside</span>
              <select className="input" value={draft.parentId ?? ""} onChange={(e) => setDraft({ ...draft, parentId: e.target.value || null })}>
                <option value="">Nowhere in particular</option>
                {world
                  .filter((w) => w.id !== draft.id && w.kind === "place")
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.title}
                    </option>
                  ))}
              </select>
            </label>
            {draft.kind === "quest" && (
              <label className="field" style={{ width: 120 }}>
                <span>Status</span>
                <select className="input" value={draft.questStatus ?? "active"} onChange={(e) => setDraft({ ...draft, questStatus: e.target.value as Draft["questStatus"] })}>
                  {QUEST_STATUSES.map((q) => (
                    <option key={q} value={q}>
                      {QUEST_NAMES[q]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="row" style={{ alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={draft.revealed} onChange={(e) => setDraft({ ...draft, revealed: e.target.checked })} />
            <span>Players know about this {KIND_NAMES[draft.kind].one.toLowerCase()}</span>
          </label>
          {draft.blocks.map((b, i) => (
            <div key={b.id} className="stack world-block">
              <label className="field">
                <span>Paragraph {i + 1}</span>
                <textarea className="input" value={b.text} maxLength={WORLD_TEXT_MAX} onChange={(e) => patchBlock(b.id, { text: e.target.value })} />
              </label>
              <div className="row">
                <button type="button" className="chip" aria-pressed={b.revealed} onClick={() => patchBlock(b.id, { revealed: !b.revealed })}>
                  {b.revealed ? "Shown to players" : "Only you"}
                </button>
                <button type="button" className="btn btn-quiet small" onClick={() => setDraft({ ...draft, blocks: draft.blocks.filter((x) => x.id !== b.id) })}>
                  Remove paragraph
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-quiet" onClick={() => setDraft({ ...draft, blocks: [...draft.blocks, { id: newId(), text: "", revealed: false }] })}>
            Add a paragraph
          </button>
          <PicturePicker
            imageId={draft.image?.id ?? null}
            label={`Picture of ${draft.title || `this ${KIND_NAMES[draft.kind].one.toLowerCase()}`}`}
            onAdd={(id) => {
              pictures.add(id);
              setDraft((d) => d && { ...d, image: { id, revealed: d.image?.revealed ?? false } });
            }}
            onRemove={() => setDraft({ ...draft, image: null })}
          />
          {draft.image && (
            <div className="row">
              <button type="button" className="chip" aria-pressed={draft.image.revealed} aria-label="Picture shown to players" onClick={() => setDraft({ ...draft, image: { ...draft.image!, revealed: !draft.image!.revealed } })}>
                {draft.image.revealed ? "Picture shown to players" : "Picture only for you"}
              </button>
            </div>
          )}
          {draft.revealed && !draft.blocks.some((b) => b.revealed) && <p className="muted small">Players will see the name only, until you show a paragraph.</p>}
          <div className="row">
            <button className="btn btn-primary" disabled={!draft.title.trim()}>
              Save {KIND_NAMES[draft.kind].one.toLowerCase()}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                pictures.discard();
                setDraft(null);
              }}
            >
              Cancel
            </button>
            {world.some((w) => w.id === draft.id) &&
              (confirmDelete ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    const gone = world.find((x) => x.id === draft.id)?.image?.id;
                    update((c) => ({ ...c, ...removeWorldEntry(c, draft.id) }));
                    pictures.discard();
                    if (gone) void deleteImage(gone);
                    setDraft(null);
                  }}
                >
                  Delete {draft.title}
                </button>
              ) : (
                <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              ))}
          </div>
        </form>
      )}
      {ordered.length > 0 && (
        <ul className="rows" aria-label="World entries" style={{ marginTop: 10 }}>
          {ordered.map((e) => {
            const shown = e.blocks.filter((b) => b.revealed).length;
            return (
              <li key={e.id} className="resource spread" style={{ paddingLeft: 14 + depth(e) * 18 }}>
                <span>
                  <strong>{e.title}</strong>
                  <br />
                  <span className="muted small">
                    {KIND_NAMES[e.kind].one}
                    {e.questStatus ? `, ${QUEST_NAMES[e.questStatus].toLowerCase()}` : ""}.{" "}
                    {e.revealed ? `Players know it; ${shown} of ${e.blocks.length} paragraph${e.blocks.length === 1 ? "" : "s"} shown.` : "Only you."}
                    {e.image ? (e.image.revealed && e.revealed ? " Picture shown." : " Picture only for you.") : ""}
                  </span>
                </span>
                <button
                  className="btn btn-quiet"
                  aria-label={`Edit ${e.title}`}
                  onClick={() => {
                    setConfirmDelete(false);
                    pictures.discard();
                    setDraft({ id: e.id, kind: e.kind, title: e.title, parentId: e.parentId, revealed: e.revealed, blocks: e.blocks, questStatus: e.questStatus, image: e.image ?? null });
                  }}
                >
                  Edit
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
