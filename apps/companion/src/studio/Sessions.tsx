/**
 * Sessions: start one when play begins and the studio logs what the party saw; end it and the log becomes a
 * recap draft to tidy and share as a handout.
 */
import { newId } from "@mimicbox/ruleset-dnd5e";
import { addLogNote, endSession, LOG_TEXT_MAX, RECAP_MAX, removeSession, runningSession, saveRecap, sessionLength, shareRecap, startSession, type LogEvent, type Session } from "@mimicbox/table";
import { useEffect, useState } from "react";
import { Markdown } from "../lib/markdown";
import type { StudioCampaign } from "./store";

type Update = (fn: (c: StudioCampaign) => StudioCampaign) => void;

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** Re-renders once a minute so a running session's length stays current. */
function useMinute() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
}

function LogLines({ events, label }: { events: LogEvent[]; label: string }) {
  return (
    <ol className="session-log" aria-label={label}>
      {events.map((e, i) => (
        <li key={i} className={`log-${e.kind}${e.flag ? ` log-${e.flag}` : ""}`}>
          <time dateTime={e.at}>{time(e.at)}</time>
          <span>{e.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** The session controls in Play: start, the latest lines of the log, a note, and end. */
export function SessionPlay({ campaign, update, onRecap }: { campaign: StudioCampaign; update: Update; onRecap: (id: string) => void }) {
  useMinute();
  const [note, setNote] = useState("");
  const [all, setAll] = useState(false);
  const running = runningSession(campaign);
  const sessions = campaign.sessions ?? [];
  const last = sessions.filter((s) => s.endedAt).at(-1) ?? null;
  const next = sessions.reduce((n, s) => Math.max(n, s.number), 0) + 1;

  if (!running)
    return (
      <section className="section session-play" aria-label="Session">
        <div className="spread">
          <h2>Session</h2>
          <button className="btn btn-primary" onClick={() => update((c) => ({ ...c, ...startSession(c, newId(), new Date().toISOString()) }))}>
            Start session {next}
          </button>
        </div>
        {last ? (
          <p className="muted small">
            Session {last.number} ended {last.endedAt && time(last.endedAt)}.{" "}
            <button className="link-btn" onClick={() => onRecap(last.id)}>
              {last.handoutId ? "Read its recap" : "Tidy and share its recap"}
            </button>
          </p>
        ) : (
          <p className="muted small">While a session runs, fights, reveals and public rolls are logged here, ready to become a recap.</p>
        )}
      </section>
    );

  const shown = all ? running.events : running.events.slice(-5);
  return (
    <section className="section session-play" aria-label="Session">
      <div className="spread">
        <h2>
          Session {running.number} <span className="muted small">{sessionLength(running)}</span>
        </h2>
        <button
          className="btn"
          onClick={() => {
            update((c) => ({ ...c, ...endSession(c, new Date().toISOString()) }));
            onRecap(running.id);
          }}
        >
          End session
        </button>
      </div>
      <LogLines events={[...shown].reverse()} label="Session log" />
      {running.events.length > 5 && (
        <button className="link-btn small" onClick={() => setAll(!all)}>
          {all ? "Show the latest only" : `Show all ${running.events.length} lines`}
        </button>
      )}
      <form
        className="row session-note"
        onSubmit={(e) => {
          e.preventDefault();
          update((c) => ({ ...c, ...addLogNote(c, note, new Date().toISOString()) }));
          setNote("");
        }}
      >
        <input className="input" value={note} maxLength={LOG_TEXT_MAX} onChange={(e) => setNote(e.target.value)} placeholder="The party bribed the gate guard." aria-label="Add to the log" />
        <button className="btn" disabled={!note.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

/** Prepare → Sessions: every session with its recap and log. */
export function SessionsPanel({ campaign, update, open, onOpen }: { campaign: StudioCampaign; update: Update; open: string | null; onOpen: (id: string | null) => void }) {
  useMinute();
  const sessions = [...(campaign.sessions ?? [])].reverse();
  return (
    <section className="section">
      <h2>Sessions</h2>
      <p className="muted small" style={{ marginTop: 4 }}>
        Start a session in Play and what the party sees is logged. When it ends, the log becomes a recap you can edit and share with the players as a handout.
      </p>
      {sessions.length === 0 && <p className="muted">No sessions yet. Start one from Play when the game begins.</p>}
      {sessions.map((s) => (
        <SessionCard key={s.id} session={s} campaign={campaign} update={update} open={open === s.id} onToggle={() => onOpen(open === s.id ? null : s.id)} />
      ))}
    </section>
  );
}

function SessionCard({ session: s, campaign, update, open, onToggle }: { session: Session; campaign: StudioCampaign; update: Update; open: boolean; onToggle: () => void }) {
  const [draft, setDraft] = useState(s.recap);
  const [confirm, setConfirm] = useState(false);
  // A recap drafted when the session ends replaces an empty editor.
  useEffect(() => setDraft(s.recap), [s.recap]);
  const shared = s.handoutId ? (campaign.handouts ?? []).find((h) => h.id === s.handoutId) : null;
  const sharedNow = Boolean(shared?.revealed && shared.body === s.recap);
  const save = () => {
    if (draft !== s.recap) update((c) => ({ ...c, ...saveRecap(c, s.id, draft) }));
  };
  return (
    <article className="panel session-card" aria-label={`Session ${s.number}`}>
      <button className="spread session-head" aria-expanded={open} onClick={onToggle}>
        <strong className="member-name">Session {s.number}</strong>
        <span className="muted small">
          {day(s.startedAt)}, {sessionLength(s)}
        </span>
        <span className={s.endedAt === null || shared?.revealed ? "presence here" : "presence"}>{s.endedAt === null ? "Running" : shared?.revealed ? "Shared" : "Only you"}</span>
      </button>
      {open && (
        <div className="session-body">
          <label className="field">
            <span>Recap</span>
            <textarea
              className="input"
              style={{ minHeight: 200 }}
              value={draft}
              maxLength={RECAP_MAX}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={save}
              placeholder={s.endedAt === null ? "The recap is drafted from the log when the session ends. You can start writing now." : "What happened this session."}
            />
          </label>
          <div className="row">
            <button
              className={sharedNow ? "btn" : "btn btn-primary"}
              disabled={!draft.trim() || sharedNow}
              onClick={() => update((c) => ({ ...c, ...shareRecap(saveRecap(c, s.id, draft), s.id, newId()) }))}
            >
              {sharedNow ? "Shared with players" : shared ? "Share the changes" : "Share with players"}
            </button>
            {confirm ? (
              <button
                className="btn btn-danger"
                onClick={() => update((c) => ({ ...c, ...removeSession(c, s.id) }))}
              >
                Delete session {s.number} and its log
              </button>
            ) : (
              <button className="btn btn-quiet" onClick={() => setConfirm(true)}>
                Delete
              </button>
            )}
          </div>
          {draft.trim() && (
            <details className="small">
              <summary>Preview</summary>
              <Markdown text={draft} />
            </details>
          )}
          <details className="small">
            <summary>The log, {s.events.length} lines</summary>
            <LogLines events={s.events} label={`Session ${s.number} log`} />
          </details>
        </div>
      )}
    </article>
  );
}
