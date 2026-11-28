/**
 * Sessions and their log. While the DM runs a session, every change to the campaign that players would notice is
 * written to the log as one plain line: fights starting and ending, creatures falling, handouts shown, world pages
 * revealed, the map changing, players joining and public rolls. Ending the session drafts a recap from the log,
 * which the DM edits and can share with the party as a handout.
 *
 * The log is DM-only. It records only what players could see, so a recap built from it never names a hidden
 * creature, a DM-only roll or an unrevealed page.
 */
import { saveHandout, setHandoutRevealed, type HostCampaign } from "./host.js";

export const LOG_KINDS = ["session", "scene", "combat", "defeat", "roll", "reveal", "map", "party", "note"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export interface LogEvent {
  at: string;
  kind: LogKind;
  text: string;
  /** Rolls only: a natural 20 or a natural 1. */
  flag?: "crit" | "fumble";
}

export interface Session {
  id: string;
  /** 1 for the first session of the campaign. */
  number: number;
  startedAt: string;
  /** null while the session is running. */
  endedAt: string | null;
  /** The DM's recap, Markdown. Drafted from the log when the session ends. */
  recap: string;
  events: LogEvent[];
  /** The handout the recap was shared as, so sharing again updates it. */
  handoutId: string | null;
}

/** Oldest lines are dropped beyond this, so a long session can't grow the campaign without bound. */
export const SESSION_LOG_LIMIT = 500;
export const LOG_TEXT_MAX = 300;
export const RECAP_MAX = 20000;

const sessionsOf = (c: HostCampaign): Session[] => c.sessions ?? [];

/** The session in progress, if any. */
export function runningSession(c: HostCampaign): Session | null {
  return sessionsOf(c).find((s) => s.endedAt === null) ?? null;
}

const withSession = (c: HostCampaign, id: string, fn: (s: Session) => Session): HostCampaign => ({
  ...c,
  sessions: sessionsOf(c).map((s) => (s.id === id ? fn(s) : s)),
});

const append = (s: Session, events: LogEvent[]): Session =>
  events.length === 0 ? s : { ...s, events: [...s.events, ...events.map((e) => ({ ...e, text: e.text.slice(0, LOG_TEXT_MAX) }))].slice(-SESSION_LOG_LIMIT) };

/** Starts the next session. Does nothing while one is already running. */
export function startSession(c: HostCampaign, id: string, now: string): HostCampaign {
  if (runningSession(c)) return c;
  const number = sessionsOf(c).reduce((n, s) => Math.max(n, s.number), 0) + 1;
  const session: Session = {
    id,
    number,
    startedAt: now,
    endedAt: null,
    recap: "",
    events: [{ at: now, kind: "session", text: `Session ${number} started.` }],
    handoutId: null,
  };
  return { ...c, sessions: [...sessionsOf(c), session] };
}

/** Ends the running session and drafts its recap, unless the DM already wrote one. */
export function endSession(c: HostCampaign, now: string): HostCampaign {
  const s = runningSession(c);
  if (!s) return c;
  return withSession(c, s.id, (x) => {
    const ended = append({ ...x, endedAt: now }, [{ at: now, kind: "session", text: `Session ${x.number} ended.` }]);
    return { ...ended, recap: x.recap.trim() ? x.recap : draftRecap(ended) };
  });
}

/** A line the DM adds to the running session's log by hand. */
export function addLogNote(c: HostCampaign, text: string, now: string): HostCampaign {
  const s = runningSession(c);
  const clean = text.trim();
  if (!s || !clean) return c;
  return withSession(c, s.id, (x) => append(x, [{ at: now, kind: "note", text: clean }]));
}

export function saveRecap(c: HostCampaign, id: string, recap: string): HostCampaign {
  return withSession(c, id, (s) => ({ ...s, recap: recap.slice(0, RECAP_MAX) }));
}

export function removeSession(c: HostCampaign, id: string): HostCampaign {
  return { ...c, sessions: sessionsOf(c).filter((s) => s.id !== id) };
}

/** Shows the recap to the party as a handout named "Session N recap", or updates the one shared before. */
export function shareRecap(c: HostCampaign, id: string, newHandoutId: string): HostCampaign {
  const s = sessionsOf(c).find((x) => x.id === id);
  if (!s || !s.recap.trim()) return c;
  const existing = s.handoutId && (c.handouts ?? []).some((h) => h.id === s.handoutId) ? s.handoutId : null;
  const handoutId = existing ?? newHandoutId;
  let next = saveHandout(c, { id: handoutId, title: `Session ${s.number} recap`, body: s.recap, imageId: null });
  next = setHandoutRevealed(next, handoutId, true);
  return withSession(next, id, (x) => ({ ...x, handoutId }));
}

const minutes = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60000));

export function sessionLength(s: Session, now: string = new Date().toISOString()): string {
  const m = minutes(s.startedAt, s.endedAt ?? now);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

/**
 * A first draft of the recap: what happened, in order, and the rolls worth remembering. Leaves out the routine
 * lines (session start and end, each new round, ordinary rolls) that read as noise in a recap.
 */
export function draftRecap(s: Session): string {
  const happened: string[] = [];
  // Creatures added once a fight is under way join its opening line, so a fight reads as one line, not five.
  let fight: { at: number; names: string[] } | null = null;
  for (const e of s.events) {
    if (e.kind === "session" || e.kind === "scene" || e.kind === "roll" || (e.kind === "combat" && /^Round \d+/.test(e.text))) continue;
    const began = e.kind === "combat" ? /^A fight began(?:: (.+))?\.$/.exec(e.text) : null;
    const joined = e.kind === "combat" ? /^(.+) joined the fight\.$/.exec(e.text) : null;
    if (began) {
      fight = { at: happened.length, names: began[1] ? splitList(began[1]) : [] };
      happened.push(e.text);
    } else if (joined && fight) {
      fight.names.push(joined[1]!);
      happened[fight.at] = `A fight began: ${list(fight.names)}.`;
    } else {
      if (e.kind === "combat" && /^The fight ended/.test(e.text)) fight = null;
      happened.push(e.text);
    }
  }
  const rolls = s.events.filter((e) => e.kind === "roll" && e.flag);
  const parts = [`Played for ${sessionLength(s)}.`];
  if (happened.length) parts.push("## What happened", happened.map((t) => `- ${t}`).join("\n"));
  if (rolls.length) parts.push("## Rolls to remember", rolls.map((e) => `- ${e.text}`).join("\n"));
  if (!happened.length && !rolls.length) parts.push("Nothing was logged this session. Write what happened here.");
  return parts.join("\n\n");
}

/** Undoes list(): "A, B and C" back to its names. */
const splitList = (text: string) => text.split(/, | and /);
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * The log lines for one change to the campaign, given the campaign before and after it. Pure: callers pass the time.
 * Only what players could see is described.
 */
export function describeChanges(before: HostCampaign, after: HostCampaign, now: string): LogEvent[] {
  const out: LogEvent[] = [];
  const add = (kind: LogKind, text: string, flag?: LogEvent["flag"]) => out.push(flag ? { at: now, kind, text, flag } : { at: now, kind, text });

  // The DM's own scenes: in the log as a marker, never in a recap, since their titles are the DM's.
  if (after.currentSceneId && after.currentSceneId !== before.currentSceneId) {
    const scene = (after.scenes ?? []).find((s) => s.id === after.currentSceneId);
    if (scene) add("scene", `Scene: ${scene.title}.`);
  }

  // Players joining. A player's character often arrives just after they do, so the line waits for it.
  for (const [id, m] of Object.entries(after.members)) {
    if (m.character && !before.members[id]?.character) add("party", `${m.playerName} joined as ${m.character.name}.`);
  }

  // The map players see.
  if (after.activeMapId && after.activeMapId !== before.activeMapId) {
    const map = (after.maps ?? []).find((m) => m.id === after.activeMapId);
    if (map) add("map", `The party moved to ${map.name}.`);
  }

  // Fights.
  const was = before.combat ?? null;
  const is = after.combat ?? null;
  const visible = (cs: { hidden: boolean; name: string }[]) => cs.filter((x) => !x.hidden).map((x) => x.name);
  if (!was && is) {
    const names = visible(is.combatants);
    add("combat", names.length ? `A fight began: ${list(names)}.` : "A fight began.");
  } else if (was && !is) {
    add("combat", was.round > 1 ? `The fight ended after ${was.round} rounds.` : "The fight ended.");
  } else if (was && is) {
    if (is.round > was.round) add("combat", `Round ${is.round}.`);
    const old = new Map(was.combatants.map((x) => [x.id, x]));
    for (const x of is.combatants) {
      const o = old.get(x.id);
      if (x.hidden) continue;
      if (!o) add("combat", `${x.name} joined the fight.`);
      else if (o.hidden) add("combat", `${x.name} appeared.`);
      if (x.hp && x.hp.current <= 0 && (!o || !o.hp || o.hp.current > 0 || o.hidden)) add("defeat", `${x.name} fell.`);
    }
  }

  // Handouts, except recaps being shared.
  const recapIds = new Set(sessionsOf(after).map((s) => s.handoutId).filter(Boolean));
  const shown = new Set((before.handouts ?? []).filter((h) => h.revealed).map((h) => h.id));
  for (const h of after.handouts ?? []) {
    if (h.revealed && !shown.has(h.id) && !recapIds.has(h.id)) add("reveal", `The party received “${h.title}”.`);
  }

  // World pages.
  const oldWorld = new Map((before.world ?? []).map((e) => [e.id, e]));
  for (const e of after.world ?? []) {
    if (!e.revealed) continue;
    const o = oldWorld.get(e.id);
    if (!o || !o.revealed) {
      add("reveal", e.kind === "quest" ? `New quest: ${e.title}.` : `The party learned of ${e.title}.`);
      continue;
    }
    const known = new Set(o.blocks.filter((b) => b.revealed).map((b) => b.id));
    if (e.blocks.some((b) => b.revealed && !known.has(b.id))) add("reveal", `The party learned more about ${e.title}.`);
    if (e.kind === "quest" && e.questStatus !== o.questStatus && e.questStatus && e.questStatus !== "active") {
      add("reveal", e.questStatus === "done" ? `Quest completed: ${e.title}.` : `Quest failed: ${e.title}.`);
    }
  }

  // Public rolls. DM-only rolls stay out of the log, because the recap may be shared.
  const rolled = new Set(before.rolls.map((r) => r.id));
  for (const r of after.rolls) {
    if (rolled.has(r.id) || r.visibility !== "public") continue;
    const who = r.characterName || r.by;
    const note = r.flag === "crit" ? " (natural 20)" : r.flag === "fumble" ? " (natural 1)" : "";
    add("roll", `${who} rolled ${r.label}: ${r.total}${note}.`, r.flag);
  }
  return out;
}

/** Writes a change to the running session's log. Returns the campaign unchanged when no session is running. */
export function logChanges(before: HostCampaign, after: HostCampaign, now: string): HostCampaign {
  const s = runningSession(after);
  if (!s) return after;
  const events = describeChanges(before, after, now);
  return events.length ? withSession(after, s.id, (x) => append(x, events)) : after;
}

/** Sessions from a backup file. Anything malformed is dropped; at most one session stays running. */
export function readSessions(raw: unknown, handoutIds: readonly string[]): Session[] {
  if (!Array.isArray(raw)) return [];
  const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const isTime = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
  let running = false;
  return raw.filter(rec).flatMap((s) => {
    if (typeof s.id !== "string" || typeof s.number !== "number" || !Number.isInteger(s.number) || s.number < 1 || !isTime(s.startedAt)) return [];
    let endedAt = isTime(s.endedAt) ? s.endedAt : null;
    if (endedAt === null) {
      if (running) endedAt = s.startedAt;
      running = true;
    }
    const events = (Array.isArray(s.events) ? s.events : []).filter(rec).flatMap((e): LogEvent[] => {
      if (!isTime(e.at) || typeof e.text !== "string" || !LOG_KINDS.includes(e.kind as LogKind)) return [];
      const flag = e.flag === "crit" || e.flag === "fumble" ? e.flag : undefined;
      const event: LogEvent = { at: e.at, kind: e.kind as LogKind, text: e.text.slice(0, LOG_TEXT_MAX) };
      return [flag ? { ...event, flag } : event];
    });
    return [
      {
        id: s.id,
        number: s.number,
        startedAt: s.startedAt,
        endedAt,
        recap: typeof s.recap === "string" ? s.recap.slice(0, RECAP_MAX) : "",
        events: events.slice(-SESSION_LOG_LIMIT),
        handoutId: typeof s.handoutId === "string" && handoutIds.includes(s.handoutId) ? s.handoutId : null,
      },
    ];
  });
}
