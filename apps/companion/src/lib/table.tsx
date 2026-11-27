/**
 * The player's connection to a DM's game. One character at a time can sit at a table. The connection is remembered
 * on this device, so the sheet rejoins after a reload. Messages are only accepted from the DM's device identity
 * named in the invite; anything else in the room is ignored.
 */
import type { Character } from "@mimicbox/ruleset-dnd5e";
import {
  PROTOCOL_VERSION,
  applyEffect,
  LAN_HOST,
  decodeInvite,
  describeEffect,
  encodeInvite,
  joinLan,
  lanLink,
  openLink,
  parseHostMessage,
  type Invite,
  type PartyMember,
  type PlayerMessage,
  type PublicCombat,
  type PublicMap,
  type PublicWorldEntry,
  type Effect,
  type PublicHandout,
  type SharedRoll,
  type TableLink,
} from "@mimicbox/table";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { newId } from "@mimicbox/ruleset-dnd5e";
import { content, summaryFor, useApp } from "./state";

export type TableStatus = "idle" | "connecting" | "waiting" | "connected" | "denied" | "error";

export interface Seat {
  code: string;
  characterId: string;
  playerName: string;
  /** Joined on the DM's network without internet (ADR 0006): the link can't reopen by itself. */
  lan?: boolean;
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
  /** Pictures for shown handouts, by image id, as they arrive. */
  handoutImages: Record<string, string>;
  /** The fight in progress, as players see it. */
  combat: PublicCombat | null;
  /** This device's identity in the game, from the DM's welcome. */
  memberId: string | null;
  /** World notes the DM has revealed. */
  world: PublicWorldEntry[];
  /** The map in play, and the tiles received for it so far. */
  map: PublicMap | null;
  mapTiles: { tx: number; ty: number; url: string }[];
  moveToken: (tokenId: string, x: number, y: number) => void;
  /** Opens or closes a door next to this player's token. */
  toggleDoor: (x: number, y: number) => void;
  join: (seat: Seat) => Promise<void>;
  /** Joins on the DM's network from the DM's code; returns the reply code to show the DM. */
  joinOnNetwork: (dmCode: string, characterId: string, playerName: string) => Promise<string>;
  leave: () => Promise<void>;
  shareCharacter: (c: Character) => void;
  shareRoll: (roll: Extract<PlayerMessage, { t: "roll" }>["roll"]) => void;
  /** The open sheet takes the DM's effects itself, so they land in its own state. */
  setEffectHandler: (handler: ((e: Effect) => void) | null) => void;
}

const TableContext = createContext<TableState | null>(null);
const SEAT_SETTING = "tableSeat";

type Command = Extract<PlayerMessage, { commandId: string }>;

export function TableProvider({ children }: { children: ReactNode }) {
  const { vault, toast } = useApp();
  const [handouts, setHandouts] = useState<PublicHandout[]>([]);
  const [handoutImages, setHandoutImages] = useState<Record<string, string>>({});
  const [combat, setCombat] = useState<PublicCombat | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [map, setMap] = useState<PublicMap | null>(null);
  const [world, setWorld] = useState<PublicWorldEntry[]>([]);
  const knownWorld = useRef<Set<string> | null>(null);
  const [tileStore, setTileStore] = useState<Map<string, string>>(new Map());
  const effectHandler = useRef<((e: Effect) => void) | null>(null);
  const appliedEffects = useRef(new Set<string>());
  const setEffectHandler = useCallback((h: ((e: Effect) => void) | null) => {
    effectHandler.current = h;
  }, []);
  // Handouts already seen on this connection, so only new reveals are announced.
  const knownHandouts = useRef<Set<string> | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [status, setStatus] = useState<TableStatus>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [party, setParty] = useState<PartyMember[]>([]);
  const [rolls, setRolls] = useState<SharedRoll[]>([]);
  const link = useRef<TableLink | null>(null);
  // A local-network link for a seat; it outlives re-renders, because it can't be reopened without the DM.
  const lanSeat = useRef<{ code: string; link: TableLink } | null>(null);
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
    knownWorld.current = null;
    setStatus("connecting");
    setProblem(null);
    const hello = () => link.current?.send({ t: "hello", v: PROTOCOL_VERSION, invite: invite.key, playerName: seat.playerName }, invite.host);
    void (async () => {
      let l: TableLink;
      if (seat.lan) {
        const held = lanSeat.current?.code === seat.code ? lanSeat.current.link : null;
        if (!held) {
          setStatus("error");
          setProblem("You played on the DM's network without internet. To reconnect, ask the DM for a new code and scan it in Join a game.");
          return;
        }
        l = held;
      } else try {
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
      l.onJoin((userId) => !cancelled && userId === invite.host && hello());
      l.onLeave((userId) => {
        if (cancelled || userId !== invite.host) return;
        welcomed.current = false;
        setStatus("waiting");
      });
      l.onMessage((raw, from) => {
        if (cancelled || from !== invite.host) return; // Only the DM named in the invite speaks for the game.
        const m = parseHostMessage(raw);
        if (!m) return;
        if (m.t === "welcome") {
          welcomed.current = true;
          setMemberId(m.memberId);
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
        else if (m.t === "combat") setCombat(m.combat);
        else if (m.t === "world") {
          const fresh = m.entries.filter((e) => knownWorld.current && !knownWorld.current.has(e.id));
          knownWorld.current = new Set(m.entries.map((e) => e.id));
          setWorld(m.entries);
          if (fresh.length) toast(fresh.length === 1 ? `New in your journal: ${fresh[0]!.title}` : `${fresh.length} new journal entries`);
        }
        else if (m.t === "map") {
          setMap(m.map);
          // Keep only tiles of the current versions; older ones show squares that have changed.
          const keep = new Set((m.map?.tiles ?? []).map((t) => `${m.map!.id}:${t.tx}:${t.ty}:${t.version}`));
          setTileStore((prev) => new Map([...prev].filter(([k]) => keep.has(k))));
        } else if (m.t === "image") setHandoutImages((prev) => ({ ...prev, [m.id]: m.data }));
        else if (m.t === "tile") setTileStore((prev) => new Map(prev).set(`${m.mapId}:${m.tx}:${m.ty}:${m.version}`, m.data));
        else if (m.t === "effect") {
          if (appliedEffects.current.has(m.effectId)) return;
          appliedEffects.current.add(m.effectId);
          toast(describeEffect(m.effect));
          if (effectHandler.current) effectHandler.current(m.effect);
          else {
            // The sheet isn't open: change the vault copy and send the DM the result.
            void vault.get<Character>(seat.characterId).then(async (entry) => {
              if (!entry) return;
              const next = applyEffect(entry.doc, content, m.effect);
              await vault.put(next, summaryFor(next));
              outbox.current = [...outbox.current.filter((c) => c.t !== "character"), { t: "character", v: PROTOCOL_VERSION, commandId: newId(), character: next }];
              flushOutbox();
            });
          }
        }
        else if (m.t === "handouts") {
          const fresh = m.handouts.filter((h) => knownHandouts.current && !knownHandouts.current.has(h.id));
          knownHandouts.current = new Set(m.handouts.map((h) => h.id));
          setHandouts(m.handouts);
          // A handout hidden again takes its picture with it.
          const used = new Set(m.handouts.map((h) => h.imageId));
          setHandoutImages((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => used.has(id))));
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
      if (l && l !== lanSeat.current?.link) void l.leave();
    };
  }, [seat, invite, vault, flushOutbox, toast]);

  const join = useCallback(
    async (next: Seat) => {
      if (lanSeat.current && lanSeat.current.code !== next.code) {
        void lanSeat.current.link.leave();
        lanSeat.current = null;
      }
      outbox.current = [];
      setParty([]);
      setRolls([]);
      setHandouts([]);
      setHandoutImages({});
      setCombat(null);
      setMap(null);
      setWorld([]);
      setTileStore(new Map());
      await vault?.setSetting(SEAT_SETTING, next);
      setSeat(next);
    },
    [vault],
  );

  const joinOnNetwork = useCallback(
    async (dmCode: string, characterId: string, playerName: string) => {
      if (!vault) throw new Error("This device's storage isn't ready yet. Try again in a moment.");
      let lanId = await vault.getSetting<string>("lanId");
      if (!lanId) {
        lanId = `lan-${newId()}`;
        await vault.setSetting("lanId", lanId);
      }
      const { offer, reply, peer } = await joinLan(dmCode, lanId);
      const code = encodeInvite({ room: "lan", key: offer.key, host: LAN_HOST, campaign: offer.campaign });
      // Close an older local link only after the new one exists, then sit down with the new one.
      const old = lanSeat.current;
      lanSeat.current = { code, link: lanLink(peer, lanId) };
      if (old && old.link !== lanSeat.current.link) void old.link.leave();
      await join({ code, characterId, playerName, lan: true });
      return reply;
    },
    [vault, join],
  );

  const leave = useCallback(async () => {
    void lanSeat.current?.link.leave();
    lanSeat.current = null;
    outbox.current = [];
    await vault?.setSetting(SEAT_SETTING, null);
    setSeat(null);
    setStatus("idle");
    setParty([]);
    setRolls([]);
    setHandouts([]);
    setHandoutImages({});
    setCombat(null);
    setMap(null);
    setWorld([]);
    setTileStore(new Map());
  }, [vault]);

  const shareCharacter = useCallback(
    (c: Character) => {
      if (seat && c.id === seat.characterId) enqueue({ t: "character", v: PROTOCOL_VERSION, commandId: newId(), character: c });
    },
    [seat, enqueue],
  );

  const shareRoll = useCallback(
    (roll: Extract<PlayerMessage, { t: "roll" }>["roll"]) => {
      enqueue({ t: "roll", v: PROTOCOL_VERSION, commandId: newId(), roll });
      // An initiative roll during a fight also takes this character's place in the order.
      const mine = combat?.order.find((c) => c.memberId === memberId);
      if (/^Initiative\b/.test(roll.label) && mine && mine.initiative === null) enqueue({ t: "initiative", v: PROTOCOL_VERSION, commandId: newId(), total: roll.total });
    },
    [enqueue, combat, memberId],
  );

  const mapTiles = useMemo(
    () =>
      (map?.tiles ?? []).flatMap((t) => {
        const url = tileStore.get(`${map!.id}:${t.tx}:${t.ty}:${t.version}`);
        return url ? [{ tx: t.tx, ty: t.ty, url }] : [];
      }),
    [map, tileStore],
  );

  const moveToken = useCallback(
    (tokenId: string, x: number, y: number) => {
      // Move it here at once; the DM's answer confirms it or puts it back.
      setMap((m) => (m ? { ...m, tokens: m.tokens.map((t) => (t.id === tokenId ? { ...t, x, y } : t)) } : m));
      enqueue({ t: "move", v: PROTOCOL_VERSION, commandId: newId(), tokenId, x, y });
    },
    [enqueue],
  );

  const toggleDoor = useCallback((x: number, y: number) => enqueue({ t: "door", v: PROTOCOL_VERSION, commandId: newId(), x, y }), [enqueue]);

  const value = useMemo<TableState>(
    () => ({ seat, invite, status, problem, party, rolls, handouts, handoutImages, combat, memberId, world, map, mapTiles, moveToken, toggleDoor, join, joinOnNetwork, leave, shareCharacter, shareRoll, setEffectHandler }),
    [seat, invite, status, problem, party, rolls, handouts, handoutImages, combat, memberId, world, map, mapTiles, moveToken, toggleDoor, join, joinOnNetwork, leave, shareCharacter, shareRoll, setEffectHandler],
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
