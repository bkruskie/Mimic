/**
 * Hosting a campaign from the DM's browser: opens the link, applies players' messages through the host rules in
 * @mimicbox/table, sends each audience its own view, and feeds the table display over a same-device channel.
 */
import { newId, srdContent as content } from "@mimicbox/ruleset-dnd5e";
import {
  displayChannelName,
  displayView,
  encodeInvite,
  handlePlayerMessage,
  openLink,
  playerView,
  type TableLink,
} from "@mimicbox/table";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveCampaign, type StudioCampaign } from "./store";

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

  const broadcast = useCallback(() => {
    const c = ref.current;
    const now = connectedRef.current;
    for (const userId of now) {
      if (!c.members[userId]) continue;
      for (const m of playerView(c, now, content)) link.current?.send(m, userId);
    }
    display.current?.postMessage(displayView(c, now, content));
  }, []);

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
        changedConnections();
      });
      l.onLeave((userId) => {
        connectedRef.current.delete(userId);
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
      if ((e.data as { t?: string })?.t === "display-hello") ch.postMessage(displayView(ref.current, connectedRef.current, content));
    };
    return () => {
      display.current = null;
      ch.close();
    };
  }, [initial.id]);

  useEffect(() => () => void saveCampaign(ref.current), []);

  const inviteUrl = hostId
    ? `${new URL("./", location.href).href}#/join/${encodeInvite({ room: campaign.room, key: campaign.key, host: hostId, campaign: campaign.name, relays: campaign.relays })}`
    : null;

  /** Applies a DM action to the newest campaign state. */
  const update = useCallback((fn: (c: StudioCampaign) => StudioCampaign) => setCampaign(fn(ref.current)), [setCampaign]);

  return { campaign, update, status, connected, inviteUrl };
}
