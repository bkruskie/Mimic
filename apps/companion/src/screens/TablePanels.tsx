/**
 * The game from the player's side: party and connection, the combat banner, and the journal. Each is a panel that
 * shows in a drawer on phones and in the table view's side panel on wider screens.
 */
import { formatModifier } from "@mimicbox/dice";
import type { DerivedSheet } from "@mimicbox/ruleset-dnd5e";
import { go } from "../App";
import { Drawer } from "../components/Drawer";
import { findByTitle, mentionsOf, trail, type PublicWorldEntry } from "@mimicbox/table";
import { useState } from "react";
import { Markdown, type WikiLink } from "../lib/markdown";
import { useTable } from "../lib/table";

export function tableStatusText(status: ReturnType<typeof useTable>["status"], campaign: string): string {
  switch (status) {
    case "connected":
      return `At ${campaign}`;
    case "waiting":
      return `Waiting for the DM of ${campaign}`;
    case "connecting":
      return `Connecting to ${campaign}`;
    case "denied":
      return `${campaign}: not let in`;
    case "error":
      return `${campaign}: can't connect`;
    default:
      return campaign;
  }
}

/** The game as the player sees it: connection, turn order, party, handouts and table rolls. */
export function PartyPanel({ onLeft }: { onLeft?: () => void }) {
  const table = useTable();
  return (
    <>
      {table.problem ? (
        <p className="notice">{table.problem}</p>
      ) : (
        <p className="muted small" style={{ marginTop: 0 }}>
          {table.status === "connected"
            ? "Connected to your DM. Your sheet and rolls are shared with the table as you play."
            : table.status === "waiting"
              ? table.seat?.lan
                ? "The connection to the DM's computer dropped. Ask the DM for a new code and scan it to reconnect; nothing you do meanwhile is lost."
                : "Waiting for your DM's app. It connects by itself when the DM starts hosting."
              : "Connecting…"}
        </p>
      )}
      {table.seat?.lan && table.status !== "connected" && (
        <button className="btn btn-primary" onClick={() => go({ name: "join", code: null })}>
          Scan a new code
        </button>
      )}
      {table.combat && (
        <>
          <h3>Combat, round {table.combat.round}</h3>
          <ol className="initiative" aria-label="Initiative order">
            {table.combat.order.map((c) => (
              <li key={c.id} aria-current={c.id === table.combat!.turnId ? "true" : undefined} className={c.memberId === table.memberId ? "you" : ""}>
                <span className="init">{c.initiative ?? "–"}</span>
                <span className="grow">{c.name}</span>
                {c.id === table.combat!.turnId && <span className="small">Acting</span>}
              </li>
            ))}
          </ol>
        </>
      )}
      <h3 style={{ marginTop: 16 }}>Party</h3>
      {table.party.length === 0 && <p className="muted">No one else yet.</p>}
      <ul className="rows" aria-label="Party">
        {table.party.map((m) => (
          <li key={m.userId} className="resource">
            <div className="spread">
              <span>
                <strong>{m.character?.name ?? m.playerName}</strong>
                <br />
                <span className="muted small">
                  {m.character ? `${m.character.classSummary}, played by ${m.playerName}` : `${m.playerName} hasn't shared a character yet`}
                </span>
              </span>
              <span className={m.connected ? "small" : "muted small"}>{m.connected ? "Here" : "Away"}</span>
            </div>
            {m.character && (
              <div className="muted small" style={{ marginTop: 6 }}>
                HP {m.character.hp.current} of {m.character.hp.max}
                {m.character.hp.temp ? ` (+${m.character.hp.temp} temporary)` : ""}, AC {m.character.ac}
                {m.character.conditions.length ? `, ${m.character.conditions.join(", ")}` : ""}
              </div>
            )}
          </li>
        ))}
      </ul>
      {table.handouts.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Handouts</h3>
          {[...table.handouts].reverse().map((h) => (
            <details key={h.id} className="feature" aria-label={h.title}>
              <summary>
                <span className="grow">{h.title}</span>
              </summary>
              {h.imageId &&
                (table.pictures[h.imageId] ? (
                  <img className="handout-image" src={table.pictures[h.imageId]} alt={h.title} />
                ) : (
                  <p className="muted small">The picture is on its way.</p>
                ))}
              <Markdown text={h.body} />
            </details>
          ))}
        </>
      )}
      <h3 style={{ marginTop: 16 }}>Table rolls</h3>
      {table.rolls.length === 0 && <p className="muted">No rolls shared yet.</p>}
      <ul className="history" aria-label="Table rolls">
        {[...table.rolls].reverse().map((r) => (
          <li key={r.id}>
            <span className={`t ${r.flag ?? ""}`}>{r.total}</span>
            <span className="grow">
              {r.characterName}: {r.label}
              <br />
              <span className="breakdown small">{r.breakdown}</span>
            </span>
          </li>
        ))}
      </ul>
      <button className="btn" style={{ marginTop: 16 }} onClick={() => void table.leave().then(onLeft)}>
        Leave the game
      </button>
    </>
  );
}

export function PartyDrawer({ onClose }: { onClose: () => void }) {
  const table = useTable();
  return (
    <Drawer title={table.invite?.campaign ?? "The game"} onClose={onClose}>
      <PartyPanel onLeft={onClose} />
    </Drawer>
  );
}

export function CombatBanner({ sheet, onRollInitiative, onOpen }: { sheet: DerivedSheet; onRollInitiative: () => void; onOpen: () => void }) {
  const table = useTable();
  const combat = table.combat!;
  const mine = combat.order.find((c) => c.memberId === table.memberId);
  const yourTurn = mine && combat.turnId === mine.id;
  if (mine && mine.initiative === null) {
    return (
      <div className="notice notice-todo combat-banner" role="status">
        <span>Combat has started. Roll initiative ({formatModifier(sheet.initiative.value)}).</span>
        <button className="btn btn-primary" onClick={onRollInitiative}>
          Roll initiative
        </button>
      </div>
    );
  }
  return (
    <button className={yourTurn ? "notice combat-banner your-turn" : "notice combat-banner"} style={{ width: "100%", textAlign: "left", border: 0 }} onClick={onOpen} role="status">
      {yourTurn ? `Your turn. Round ${combat.round}.` : `Round ${combat.round}. ${combat.order.find((c) => c.id === combat.turnId)?.name ?? "Waiting for the next turn"}${combat.order.some((c) => c.id === combat.turnId) ? " is acting." : "."}`}
    </button>
  );
}

const JOURNAL_GROUPS = [
  ["quest", "Quests"],
  ["place", "Places"],
  ["person", "People"],
  ["faction", "Factions"],
  ["lore", "Lore"],
] as const;

/** What the party has learned of the DM's world. */
export function JournalPanel() {
  const table = useTable();
  const [open, setOpen] = useState<string | null>(null);
  const current = table.world.find((e) => e.id === open) ?? null;
  if (current) return <JournalPage entry={current} onOpen={setOpen} />;
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>
        What your DM has shared about the world of {table.invite?.campaign ?? "this game"}.
      </p>
      {JOURNAL_GROUPS.map(([kind, heading]) => {
        const entries = table.world.filter((e) => e.kind === kind);
        if (!entries.length) return null;
        return (
          <section key={kind} aria-label={heading} className="world-group">
            <h3>{heading}</h3>
            <ul>
              {entries.map((e) => (
                <li key={e.id}>
                  <button className="world-item" onClick={() => setOpen(e.id)}>
                    {e.title}
                    {e.questStatus && e.questStatus !== "active" && <span className="muted small">{e.questStatus === "done" ? ", done" : ", failed"}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/** One journal entry as a page: where it is, its picture, what's known, and links to what the party also knows. */
function JournalPage({ entry, onOpen }: { entry: PublicWorldEntry; onOpen: (id: string | null) => void }) {
  const table = useTable();
  const world = table.world;
  const path = trail(world, entry.id);
  const inside = world.filter((e) => e.parentId === entry.id);
  const mentioned = mentionsOf(world, entry.id, (e) => e.paragraphs);
  const go = (id: string, name: string, key?: string) => (
    <button key={key} type="button" className="wiki-link" onClick={() => onOpen(id)}>
      {name}
    </button>
  );
  // Links to entries the party hasn't learned about stay plain text.
  const link: WikiLink = (name, key) => {
    const target = findByTitle(world, name);
    return target ? go(target.id, name, key) : null;
  };
  return (
    <article className="entry-page journal-page" aria-label={entry.title}>
      <button className="btn btn-quiet" onClick={() => onOpen(null)}>
        All entries
      </button>
      {path.length > 0 && (
        <p className="entry-trail">
          In{" "}
          {path.map((p, i) => (
            <span key={p.id}>
              {i > 0 && <span aria-hidden="true"> / </span>}
              {go(p.id, p.title)}
            </span>
          ))}
        </p>
      )}
      {entry.imageId && table.pictures[entry.imageId] && <img className="handout-image entry-hero" src={table.pictures[entry.imageId]} alt={entry.title} />}
      <h3 className="journal-title">{entry.title}</h3>
      {entry.questStatus && <p className="muted small">Quest, {entry.questStatus === "active" ? "active" : entry.questStatus === "done" ? "done" : "failed"}</p>}
      {entry.paragraphs.length ? entry.paragraphs.map((p, i) => <Markdown key={i} text={p} link={link} />) : <p className="muted small">Nothing more is known yet.</p>}
      {inside.length > 0 && (
        <>
          <h4>In {entry.title}</h4>
          <p className="row" style={{ gap: 8 }}>
            {inside.map((e) => (
              <span key={e.id}>{go(e.id, e.title)}</span>
            ))}
          </p>
        </>
      )}
      {mentioned.length > 0 && (
        <>
          <h4>Mentioned in</h4>
          <p className="row" style={{ gap: 8 }}>
            {mentioned.map((e) => (
              <span key={e.id}>{go(e.id, e.title)}</span>
            ))}
          </p>
        </>
      )}
    </article>
  );
}

export function JournalDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Drawer title="Journal" onClose={onClose}>
      <JournalPanel />
    </Drawer>
  );
}
