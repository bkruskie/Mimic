/**
 * The player's connection to a DM's game. One character at a time can sit at a table. The connection is remembered
 * on this device, so the sheet rejoins after a reload. Messages are only accepted from the DM's device identity
 * named in the invite; anything else in the room is ignored.
 */
import type { Character } from "@mimicbox/ruleset-dnd5e";
import {
  PROTOCOL_VERSION,
  decodeInvite,
  openLink,
  parseHostMessage,
  type Invite,
  type PartyMember,
  type PlayerMessage,
  type PublicHandout,
  type SharedRoll,
  type TableLink,
} from "@mimicbox/table";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { newId } from "@mimicbox/ruleset-dnd5e";
import { useApp } from "./state";

export type TableStatus = "idle" | "connecting" | "waiting" | "connected" | "denied" | "error";

export interface Seat {
  code: string;
  characterId: string;
  playerName: string;
}

interface TableState {
  seat: Seat | null;
  invite: Invite | null;
  status: TableStatus;
  /** Why the DM turned the player away, or what went wrong. */
  problem: string | null;
  party: PartyMember[];
  rolls: SharedRoll[];
  /** Handouts the DM has shown to the party. */
  handouts: PublicHandout[];
  join: (seat: Seat) => Promise<void>;
  leave: () => Promise<void>;
  shareCharacter: (c: Character) => void;
  shareRoll: (roll: Extract<PlayerMessage, { t: "roll" }>["roll"]) => void;
}

const TableContext = createContext<TableState | null>(null);
const SEAT_SETTING = "tableSeat";

type Command = Extract<PlayerMessage, { commandId: string }>;

export function TableProvider({ children }: { children: ReactNode }) {
  const { vault, toast } = useApp();
  const [handouts, setHandouts] = useState<PublicHandout[]>([]);
  // Handouts already seen on this connection, so only new reveals are announced.
  const knownHandouts = useRef<Set<string> | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [status, setStatus] = useState<TableStatus>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [party, setParty] = useState<PartyMember[]>([]);
  const [rolls, setRolls] = useState<SharedRoll[]>([]);
  const link = useRef<TableLink | null>(null);
  const welcomed = useRef(false);
  // Commands wait here until the DM confirms them, and are sent again after a reconnect. The DM's app
  // recognises a command it has already applied, so nothing happens twice.
  const outbox = useRef<Command[]>([]);
  const invite = useMemo(() => {
    try {
      return seat ? decodeInvite(seat.code) : null;
    } catch {
      return null;
    }
  }, [seat]);

  const flushOutbox = useCallback(() => {
    if (!link.current || !invite || !welcomed.current) return;
    for (const cmd of outbox.current) link.current.send(cmd, invite.host);
  }, [invite]);

  const enqueue = useCallback(
    (cmd: Command) => {
      // Only the newest copy of the character matters.
      if (cmd.t === "character") outbox.current = outbox.current.filter((c) => c.t !== "character");
      outbox.current.push(cmd);
      if (link.current && invite && welcomed.current) link.current.send(cmd, invite.host);
    },
    [invite],
  );

  // Restore the seat this device had.
  useEffect(() => {
    if (!vault) return;
    void vault.getSetting<Seat>(SEAT_SETTING).then((s) => s && setSeat(s));
  }, [vault]);

  // Open the link whenever there is a seat.
  useEffect(() => {
    if (!seat || !invite || !vault) return;
    let cancelled = false;
    welcomed.current = false;
    knownHandouts.current = null;
    setStatus("connecting");
    setProblem(null);
    const hello = () => link.current?.send({ t: "hello", v: PROTOCOL_VERSION, invite: invite.key, playerName: seat.playerName }, invite.host);
    void (async () => {
      let l: TableLink;
      try {
        l = await openLink({ room: invite.room, key: invite.key, relays: invite.relays });
      } catch {
        if (!cancelled) {
          setStatus("error");
          setProblem("Couldn't start the connection. Check you're online, then try again.");
        }
        return;
      }
      if (cancelled) return void l.leave();
      link.current = l;
      setStatus("waiting");
      l.onJoin((userId) => userId === invite.host && hello());
      l.onLeave((userId) => {
        if (userId !== invite.host) return;
        welcomed.current = false;
        setStatus("waiting");
      });
      l.onMessage((raw, from) => {
        if (from !== invite.host) return; // Only the DM named in the invite speaks for the game.
        const m = parseHostMessage(raw);
        if (!m) return;
        if (m.t === "welcome") {
          welcomed.current = true;
          setStatus("connected");
          setProblem(null);
          // Bring the newest copy of the character, then resend anything the DM hasn't confirmed.
          void vault.get<Character>(seat.characterId).then((e) => {
            if (e) outbox.current = [...outbox.current.filter((c) => c.t !== "character"), { t: "character", v: PROTOCOL_VERSION, commandId: newId(), character: e.doc }];
            flushOutbox();
          });
        } else if (m.t === "denied") {
          setStatus("denied");
          setProblem(m.reason);
        } else if (m.t === "party") setParty(m.members);
        else if (m.t === "rolls") setRolls(m.rolls);
        else if (m.t === "handouts") {
          const fresh = m.handouts.filter((h) => knownHandouts.current && !knownHandouts.current.has(h.id));
          knownHandouts.current = new Set(m.handouts.map((h) => h.id));
          setHandouts(m.handouts);
          if (fresh.length) toast(fresh.length === 1 ? `New handout: ${fresh[0]!.title}` : `${fresh.length} new handouts`);
        }
        else if (m.t === "ack") outbox.current = outbox.current.filter((c) => c.commandId !== m.commandId);
      });
      if (l.connected().includes(invite.host)) hello();
    })();
    return () => {
      cancelled = true;
      welcomed.current = false;
      const l = link.current;
      link.current = null;
      void l?.leave();
    };
  }, [seat, invite, vault, flushOutbox, toast]);

  const join = useCallback(
    async (next: Seat) => {
      outbox.current = [];
      setParty([]);
      setRolls([]);
      setHandouts([]);
      await vault?.setSetting(SEAT_SETTING, next);
      setSeat(next);
    },
    [vault],
  );

  const leave = useCallback(async () => {
    outbox.current = [];
    await vault?.setSetting(SEAT_SETTING, null);
    setSeat(null);
    setStatus("idle");
    setParty([]);
    setRolls([]);
    setHandouts([]);
  }, [vault]);

  const shareCharacter = useCallback(
    (c: Character) => {
      if (seat && c.id === seat.characterId) enqueue({ t: "character", v: PROTOCOL_VERSION, commandId: newId(), character: c });
    },
    [seat, enqueue],
  );

  const shareRoll = useCallback((roll: Extract<PlayerMessage, { t: "roll" }>["roll"]) => enqueue({ t: "roll", v: PROTOCOL_VERSION, commandId: newId(), roll }), [enqueue]);

  const value = useMemo<TableState>(
    () => ({ seat, invite, status, problem, party, rolls, handouts, join, leave, shareCharacter, shareRoll }),
    [seat, invite, status, problem, party, rolls, handouts, join, leave, shareCharacter, shareRoll],
  );
  return <TableContext.Provider value={value}>{children}</TableContext.Provider>;
}

export function useTable(): TableState {
  const ctx = useContext(TableContext);
  if (!ctx) throw new Error("useTable must be used inside TableProvider.");
  return ctx;
}

/** Reads an invite code from a pasted link or a bare code. */
export function inviteCodeFrom(text: string): string {
  const t = text.trim();
  const m = /#\/join\/([\w-]+)/.exec(t);
  return m ? m[1]! : t;
}
