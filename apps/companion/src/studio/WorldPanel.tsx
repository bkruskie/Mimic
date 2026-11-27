/**
 * The DM's world notes. Each entry is a list of paragraphs with their own reveal switch, and an entry can sit inside
 * a place. Players see an entry once it's revealed, and only its revealed paragraphs.
 */
import { newId } from "@mimicbox/ruleset-dnd5e";
import {
  QUEST_STATUSES,
  WORLD_KINDS,
  WORLD_TEXT_MAX,
  findByTitle,
  mentionsOf,
  removeWorldEntry,
  saveWorldEntry,
  setBlockRevealed,
  setEntryRevealed,
  setPictureRevealed,
  trail,
  type WorldEntry,
  type WorldKind,
} from "@mimicbox/table";
import { useState } from "react";
import { useWideTable } from "../components/SidePanel";
import { EyeIcon, EyeOffIcon } from "../lib/icons";
import { Markdown, type WikiLink } from "../lib/markdown";
import { PicturePicker, StoredImage, useDraftPictures } from "./pictures";
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
  const narrow = !useWideTable();
  // The open page is remembered for this browser tab, so a reload comes back to it.
  const selKey = `world-page:${campaign.id}`;
  const [selected, setSelected] = useState<string | null>(() => sessionStorage.getItem(selKey));
  const select = (id: string | null) => {
    setSelected(id);
    try {
      if (id) sessionStorage.setItem(selKey, id);
      else sessionStorage.removeItem(selKey);
    } catch {
      /* Not remembered in private browsing. */
    }
  };
  const current = world.find((e) => e.id === selected) ?? null;
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
    setDraft({ id: newId(), kind, title: "", parentId: current?.kind === "place" ? current.id : null, revealed: false, blocks: [{ id: newId(), text: "", revealed: false }], questStatus: kind === "quest" ? "active" : null, image: null });
  };
  const edit = (e: WorldEntry) => {
    setConfirmDelete(false);
    pictures.discard();
    setDraft({ id: e.id, kind: e.kind, title: e.title, parentId: e.parentId, revealed: e.revealed, blocks: e.blocks, questStatus: e.questStatus, image: e.image ?? null });
  };
  const save = () => {
    if (!draft || !draft.title.trim()) return;
    const previous = world.find((x) => x.id === draft.id)?.image?.id ?? null;
    update((c) => ({ ...c, ...saveWorldEntry(c, draft) }));
    pictures.kept(draft.image?.id ?? null, previous);
    select(draft.id);
    setDraft(null);
  };
  const patchBlock = (id: string, p: Partial<Draft["blocks"][number]>) => setDraft((d) => d && { ...d, blocks: d.blocks.map((b) => (b.id === id ? { ...b, ...p } : b)) });
  const showPage = Boolean(draft || current);

  return (
    <section className={`section world ${narrow ? "narrow" : ""}`} aria-label="World">
      {(!narrow || !showPage) && (
        <nav className="world-tree" aria-label="World entries">
          <h2>World</h2>
          <div className="row world-new" role="group" aria-label="New entry">
            {WORLD_KINDS.map((k) => (
              <button key={k} className="chip" aria-label={`New ${KIND_NAMES[k].one.toLowerCase()}`} onClick={() => start(k)}>
                + {KIND_NAMES[k].one}
              </button>
            ))}
          </div>
          {world.length === 0 && <p className="muted small">Places, people, factions, quests and lore. Players see an entry only once you reveal it, and only the paragraphs you show.</p>}
          {WORLD_KINDS.map((k) => {
            const items = k === "place" ? ordered.filter((e) => e.kind === "place") : ordered.filter((e) => e.kind === k);
            if (!items.length) return null;
            return (
              <div key={k} className="world-group">
                <h3>{KIND_NAMES[k].many}</h3>
                <ul>
                  {items.map((e) => (
                    <li key={e.id}>
                      <button
                        className={`world-item ${e.revealed ? "" : "secret"}`}
                        aria-current={e.id === selected && !draft ? "page" : undefined}
                        style={{ paddingLeft: 10 + (k === "place" ? depth(e) * 14 : 0) }}
                        onClick={() => {
                          setDraft(null);
                          select(e.id);
                        }}
                      >
                        {e.title}
                        {!e.revealed && <span className="visually-hidden"> (only you)</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {world.some((e) => !e.revealed) && <p className="muted small">Dashed entries are only yours.</p>}
        </nav>
      )}
      {(!narrow || showPage) && (
        <div className="world-page">
          {narrow && (
            <button
              className="btn btn-quiet"
              onClick={() => {
                pictures.discard();
                setDraft(null);
                select(null);
              }}
            >
              All entries
            </button>
          )}
      {draft ? (
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
                    select(null);
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
      ) : current ? (
            <EntryPage entry={current} world={world} campaign={campaign} update={update} onOpen={(id) => select(id)} onEdit={() => edit(current)} />
          ) : (
            <p className="muted world-empty">{world.length ? "Choose an entry to open its page." : "Start with a place your story begins in."}</p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One entry as a page (docs/design.md: the world is pages, not lists): where it sits, its picture, its paragraphs
 * with [[links]], what's inside it and what mentions it. Each paragraph and the picture can be shown or hidden
 * right here; secrets wear the dashed "only you" outline.
 */
function EntryPage({
  entry,
  world,
  campaign,
  update,
  onOpen,
  onEdit,
}: {
  entry: WorldEntry;
  world: WorldEntry[];
  campaign: StudioCampaign;
  update: (fn: (c: StudioCampaign) => StudioCampaign) => void;
  onOpen: (id: string) => void;
  onEdit: () => void;
}) {
  const one = KIND_NAMES[entry.kind].one.toLowerCase();
  const path = trail(world, entry.id);
  const inside = world.filter((e) => e.parentId === entry.id).sort((a, b) => a.title.localeCompare(b.title));
  const mentioned = mentionsOf(world, entry.id, (e) => e.blocks.map((b) => b.text));
  const link: WikiLink = (name, key) => {
    const target = findByTitle(world, name);
    return target ? (
      <button key={key} type="button" className={`wiki-link ${target.revealed ? "" : "secret"}`} onClick={() => onOpen(target.id)}>
        {name}
      </button>
    ) : (
      <span key={key} className="wiki-missing" title="No entry has this name yet">
        {name}
      </span>
    );
  };
  void campaign;
  return (
    <article className="entry-page" aria-label={entry.title}>
      {path.length > 0 && (
        <p className="entry-trail">
          {path.map((p, i) => (
            <span key={p.id}>
              {i > 0 && <span aria-hidden="true"> / </span>}
              <button type="button" className="wiki-link" onClick={() => onOpen(p.id)}>
                {p.title}
              </button>
            </span>
          ))}
        </p>
      )}
      {entry.image && (
        <div className={`entry-picture ${entry.image.revealed ? "" : "veil"}`}>
          <StoredImage id={entry.image.id} alt={entry.title} />
          <button
            type="button"
            className="chip"
            aria-pressed={entry.image.revealed}
            onClick={() => update((c) => ({ ...c, ...setPictureRevealed(c, entry.id, !entry.image!.revealed) }))}
          >
            {entry.image.revealed ? "Picture shown to players" : "Picture only for you"}
          </button>
        </div>
      )}
      <div className="entry-head">
        <h2>{entry.title}</h2>
        <span className="muted small">
          {KIND_NAMES[entry.kind].one}
          {entry.questStatus ? `, ${QUEST_NAMES[entry.questStatus].toLowerCase()}` : ""}
        </span>
        <span className="table-bar-gap" />
        <button type="button" className="chip" aria-pressed={entry.revealed} onClick={() => update((c) => ({ ...c, ...setEntryRevealed(c, entry.id, !entry.revealed) }))}>
          {entry.revealed ? `Players know this ${one}` : `Players don't know this ${one}`}
        </button>
        <button type="button" className="btn" aria-label={`Edit ${entry.title}`} onClick={onEdit}>
          Edit
        </button>
      </div>
      <div className="entry-body">
        <div className="entry-text">
          {entry.blocks.filter((b) => b.text.trim()).length === 0 && <p className="muted">Nothing written yet. Edit the entry to add paragraphs.</p>}
          {entry.blocks
            .filter((b) => b.text.trim())
            .map((b) => (
              <div key={b.id} className={`entry-block ${b.revealed ? "" : "veil"}`}>
                <Markdown text={b.text} link={link} />
                <button
                  type="button"
                  className="btn btn-quiet entry-eye"
                  aria-pressed={b.revealed}
                  aria-label={b.revealed ? "Paragraph shown to players. Hide it." : "Paragraph only for you. Show it to players."}
                  title={b.revealed ? "Shown to players" : "Only you"}
                  onClick={() => update((c) => ({ ...c, ...setBlockRevealed(c, entry.id, b.id, !b.revealed) }))}
                >
                  {b.revealed ? <EyeIcon width={20} height={20} /> : <EyeOffIcon width={20} height={20} />}
                </button>
              </div>
            ))}
          <p className="muted small">Write [[Name]] to link another entry.{entry.revealed ? "" : ` Players don't know this ${one} yet, so nothing here reaches them.`}</p>
        </div>
        {(inside.length > 0 || mentioned.length > 0) && (
          <aside className="entry-aside" aria-label={`About ${entry.title}`}>
            {inside.length > 0 && (
              <>
                <h3>In {entry.title}</h3>
                <ul>
                  {inside.map((e) => (
                    <li key={e.id}>
                      <button type="button" className={`wiki-link ${e.revealed ? "" : "secret"}`} onClick={() => onOpen(e.id)}>
                        {e.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {mentioned.length > 0 && (
              <>
                <h3>Mentioned in</h3>
                <ul>
                  {mentioned.map((e) => (
                    <li key={e.id}>
                      <button type="button" className={`wiki-link ${e.revealed ? "" : "secret"}`} onClick={() => onOpen(e.id)}>
                        {e.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}
      </div>
    </article>
  );
}
