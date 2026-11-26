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
  tilePlan,
  type Effect,
  type TableLink,
} from "@mimicbox/table";
import { useCallback, useEffect, useRef, useState } from "react";
import { coverTile } from "../lib/mapImages";
import { loadTiles, saveCampaign, type StudioCampaign } from "./store";

export type HostStatus = "starting" | "hosting" | "error";

export function useHost(initial: StudioCampaign) {
  const [campaign, setCampaignState] = useState(initial);
  const ref = useRef(initial);
  const [status, setStatus] = useState<HostStatus>("starting");
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

  /** Sends each player and the display the map tiles they don't have yet, covered where the fog is. */
  const syncTiles = useCallback(() => {
    tileQueue.current = tileQueue.current.then(async () => {
      const map = activeMap(ref.current);
      if (!map) return;
      if (!originals.current.has(map.id)) originals.current.set(map.id, await loadTiles(map.id));
      const source = originals.current.get(map.id)!;
      const audiences = [...[...connectedRef.current].filter((u) => ref.current.members[u]), ...(display.current ? ["display"] : [])];
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
          else link.current?.send(tile, a);
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
      for (const m of playerView(c, now, content, userId)) link.current?.send(m, userId);
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

  useEffect(() => {
    let cancelled = false;
    setStatus("starting");
    connectedRef.current = new Set();
    setConnected([]);
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
      const changedConnections = () => {
        setConnected([...connectedRef.current]);
        broadcast();
      };
      l.onJoin((userId) => {
        connectedRef.current.add(userId);
        sent.current.delete(userId);
        changedConnections();
      });
      l.onLeave((userId) => {
        connectedRef.current.delete(userId);
        sent.current.delete(userId);
        changedConnections();
      });
      l.onMessage((raw, from) => {
        const result = handlePlayerMessage(ref.current, from, raw, content, newId);
        for (const r of result.replies) l.send(r.msg, r.to);
        if (result.campaign !== ref.current) setCampaign({ ...ref.current, ...result.campaign }, result.changed);
      });
    })();
    return () => {
      cancelled = true;
      const l = link.current;
      link.current = null;
      void l?.leave();
    };
    // A new room or key (a replaced invite link) means a new link.
  }, [campaign.room, campaign.key]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const inviteUrl = hostId
    ? `${new URL("./", location.href).href}#/join/${encodeInvite({ room: campaign.room, key: campaign.key, host: hostId, campaign: campaign.name, relays: campaign.relays })}`
    : null;

  /** Applies a DM action to the newest campaign state. */
  const update = useCallback((fn: (c: StudioCampaign) => StudioCampaign) => setCampaign(fn(ref.current)), [setCampaign]);

  /** Sends damage, healing or a condition to one player's sheet. Only reaches players who are connected. */
  const sendEffect = useCallback((userId: string, effect: Effect) => {
    if (!connectedRef.current.has(userId)) return false;
    link.current?.send({ t: "effect", v: PROTOCOL_VERSION, effectId: newId(), effect }, userId);
    return true;
  }, []);

  /** Forget a map's cached tiles, after a new image is saved for it. */
  const forgetTiles = useCallback((mapId: string) => originals.current.delete(mapId), []);

  return { campaign, update, status, connected, inviteUrl, sendEffect, forgetTiles };
}
