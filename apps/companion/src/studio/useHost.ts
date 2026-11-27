/**
 * Hosting a campaign from the DM's browser: opens the link, applies players' messages through the host rules in
 * @mimicbox/table, sends each audience its own view, and feeds the table display over a same-device channel.
 */
import { newId, srdContent as content } from "@mimicbox/ruleset-dnd5e";
import {
  PROTOCOL_VERSION,
  activeMap,
  displayChannelName,
  displayView,
  encodeInvite,
  handlePlayerMessage,
  openLink,
  playerView,
  publicMap,
  sharedImageIds,
  tilePlan,
  LanCodeError,
  startLanHost,
  type Effect,
  type LanPeer,
  type TableLink,
} from "@mimicbox/table";
import { useCallback, useEffect, useRef, useState } from "react";
import { coverTile } from "../lib/mapImages";
import { loadImage, loadTiles, saveCampaign, type StudioCampaign } from "./store";

export type HostStatus = "starting" | "hosting" | "offline" | "error";

/** Whether the browser thinks it has a network connection, kept up to date. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useHost(initial: StudioCampaign) {
  const [campaign, setCampaignState] = useState(initial);
  const ref = useRef(initial);
  const [status, setStatus] = useState<HostStatus>("starting");
  const online = useOnline();
  const [hostId, setHostId] = useState<string | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const connectedRef = useRef(new Set<string>());
  const link = useRef<TableLink | null>(null);
  const display = useRef<BroadcastChannel | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  // Map tiles: the DM's originals, covered copies by version, and what each audience already has.
  const originals = useRef(new Map<string, Map<string, string>>());
  const covered = useRef(new Map<string, string>());
  const sent = useRef(new Map<string, Set<string>>());
  const tileQueue = useRef<Promise<void>>(Promise.resolve());

  // Players on the DM's network without internet (ADR 0006), by their local device id.
  const lanPeers = useRef(new Map<string, LanPeer>());

  /** Sends to one player, over whichever link they came in on; with no one named, to every player. */
  const sendTo = useCallback((msg: unknown, userId?: string) => {
    if (!userId) {
      link.current?.send(msg);
      for (const p of lanPeers.current.values()) p.send(msg);
      return;
    }
    const lan = lanPeers.current.get(userId);
    if (lan) lan.send(msg);
    else link.current?.send(msg, userId);
  }, []);

  /** Sends each player and the display the handout pictures and map tiles they don't have yet, covered where the fog is. */
  const syncTiles = useCallback(() => {
    tileQueue.current = tileQueue.current.then(async () => {
      // Pictures first: only those of shown handouts and shown world entries, once per audience.
      const audiences = [...[...connectedRef.current].filter((u) => ref.current.members[u]), ...(display.current ? ["display"] : [])];
      for (const imageId of sharedImageIds(ref.current)) {
        const key = `image:${imageId}`;
        const waiting = audiences.filter((a) => !sent.current.get(a)?.has(key));
        if (!waiting.length) continue;
        const data = await loadImage(imageId);
        if (!data) continue;
        const image = { t: "image" as const, v: PROTOCOL_VERSION, id: imageId, data };
        for (const a of waiting) {
          if (a === "display") display.current?.postMessage(image);
          else sendTo(image, a);
          if (!sent.current.has(a)) sent.current.set(a, new Set());
          sent.current.get(a)!.add(key);
        }
      }
      const map = activeMap(ref.current);
      if (!map) return;
      if (!originals.current.has(map.id)) originals.current.set(map.id, await loadTiles(map.id));
      const source = originals.current.get(map.id)!;
      for (const t of publicMap(map, null).tiles) {
        const key = `${map.id}:${t.tx}:${t.ty}:${t.version}`;
        const waiting = audiences.filter((a) => !sent.current.get(a)?.has(key));
        if (!waiting.length) continue;
        let data = covered.current.get(key);
        if (!data) {
          const original = source.get(`${t.tx}:${t.ty}`);
          if (!original) continue;
          data = await coverTile(original, tilePlan(map, t.tx, t.ty).cover);
          covered.current.set(key, data);
        }
        const tile = { t: "tile" as const, v: PROTOCOL_VERSION, mapId: map.id, tx: t.tx, ty: t.ty, version: t.version, data };
        for (const a of waiting) {
          if (a === "display") display.current?.postMessage(tile);
          else sendTo(tile, a);
          if (!sent.current.has(a)) sent.current.set(a, new Set());
          sent.current.get(a)!.add(key);
        }
      }
    }).catch(() => undefined);
  }, []);

  const broadcast = useCallback(() => {
    const c = ref.current;
    const now = connectedRef.current;
    for (const userId of now) {
      if (!c.members[userId]) continue;
      for (const m of playerView(c, now, content, userId)) sendTo(m, userId);
    }
    display.current?.postMessage(displayView(c, now, content));
    syncTiles();
  }, [syncTiles]);

  /** Every change to the campaign goes through here: kept in a ref for message handlers, saved shortly after. */
  const setCampaign = useCallback(
    (next: StudioCampaign, announce = true) => {
      ref.current = next;
      setCampaignState(next);
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void saveCampaign(ref.current), 300);
      if (announce) broadcast();
    },
    [broadcast],
  );

  const changedConnections = useCallback(() => {
    setConnected([...connectedRef.current]);
    broadcast();
  }, [broadcast]);
  const peerJoined = useCallback(
    (userId: string) => {
      connectedRef.current.add(userId);
      sent.current.delete(userId);
      changedConnections();
    },
    [changedConnections],
  );
  const peerLeft = useCallback(
    (userId: string) => {
      connectedRef.current.delete(userId);
      sent.current.delete(userId);
      changedConnections();
    },
    [changedConnections],
  );
  const received = useCallback(
    (raw: unknown, from: string) => {
      const result = handlePlayerMessage(ref.current, from, raw, content, newId);
      for (const r of result.replies) sendTo(r.msg, r.to);
      if (result.campaign !== ref.current) setCampaign({ ...ref.current, ...result.campaign }, result.changed);
    },
    [sendTo, setCampaign],
  );

  /**
   * Adds a player on this network without internet: returns the code to show them, and a way to finish with
   * their reply. The player then says hello with the campaign key like any other player.
   */
  const startLanPlayer = useCallback(async () => {
    const { code, peer, accept } = await startLanHost(ref.current.name, ref.current.key);
    let accepted = false;
    return {
      code,
      accept: async (reply: string) => {
        const answer = await accept(reply);
        if (!answer.player.startsWith("lan-")) throw new LanCodeError("That reply code is incomplete. Ask the player to join again.");
        accepted = true;
        const id = answer.player;
        peer.onMessage((m) => {
          if (lanPeers.current.get(id) === peer) received(m, id);
        });
        peer.onOpen(() => {
          const old = lanPeers.current.get(id);
          lanPeers.current.set(id, peer);
          old?.close(); // The same device joining again replaces its older connection.
          peerJoined(id);
        });
        peer.onClose(() => {
          if (lanPeers.current.get(id) !== peer) return;
          lanPeers.current.delete(id);
          peerLeft(id);
        });
        return answer;
      },
      cancel: () => {
        if (!accepted) peer.close();
      },
    };
  }, [received, peerJoined, peerLeft]);

  // A replaced invite link also ends local-network connections: their key no longer works.
  const firstKey = useRef(campaign.key);
  useEffect(() => {
    if (campaign.key === firstKey.current) return;
    firstKey.current = campaign.key;
    for (const p of [...lanPeers.current.values()]) p.close();
  }, [campaign.key]);
  useEffect(() => () => {
    for (const p of lanPeers.current.values()) p.close();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Players on the local network stay connected whether or not this computer is online.
    connectedRef.current = new Set([...lanPeers.current].filter(([, p]) => p.isOpen()).map(([id]) => id));
    setConnected([...connectedRef.current]);
    // With no connection the DM can still prepare: everything saves on this device. Hosting starts when it's back.
    if (!online) {
      setStatus("offline");
      return;
    }
    setStatus("starting");
    void (async () => {
      let l: TableLink;
      try {
        l = await openLink({ room: ref.current.room, key: ref.current.key, relays: ref.current.relays });
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }
      if (cancelled) return void l.leave();
      link.current = l;
      setHostId(await l.self());
      setStatus("hosting");
      l.onJoin(peerJoined);
      l.onLeave(peerLeft);
      l.onMessage(received);
    })();
    return () => {
      cancelled = true;
      const l = link.current;
      link.current = null;
      void l?.leave();
    };
    // A new room or key (a replaced invite link) means a new link; coming back online starts hosting again.
  }, [campaign.room, campaign.key, online]); // eslint-disable-line react-hooks/exhaustive-deps

  // The table display: read-only, on this device. It asks for the current view when it opens.
  useEffect(() => {
    const ch = new BroadcastChannel(displayChannelName(initial.id));
    display.current = ch;
    ch.onmessage = (e) => {
      if ((e.data as { t?: string })?.t === "display-hello") {
        sent.current.delete("display");
        ch.postMessage(displayView(ref.current, connectedRef.current, content));
        syncTiles();
      }
    };
    return () => {
      display.current = null;
      ch.close();
    };
  }, [initial.id, syncTiles]);

  useEffect(() => () => void saveCampaign(ref.current), []);

  const inviteUrl = hostId && status !== "offline"
    ? `${new URL("./", location.href).href}#/join/${encodeInvite({ room: campaign.room, key: campaign.key, host: hostId, campaign: campaign.name, relays: campaign.relays })}`
    : null;

  /** Applies a DM action to the newest campaign state. */
  const update = useCallback((fn: (c: StudioCampaign) => StudioCampaign) => setCampaign(fn(ref.current)), [setCampaign]);

  /** Sends damage, healing or a condition to one player's sheet. Only reaches players who are connected. */
  const sendEffect = useCallback((userId: string, effect: Effect) => {
    if (!connectedRef.current.has(userId)) return false;
    sendTo({ t: "effect", v: PROTOCOL_VERSION, effectId: newId(), effect }, userId);
    return true;
  }, []);

  /** Forget a map's cached tiles, after a new image is saved for it. */
  const forgetTiles = useCallback((mapId: string) => originals.current.delete(mapId), []);

  return { campaign, update, status, connected, inviteUrl, sendEffect, forgetTiles, startLanPlayer };
}
