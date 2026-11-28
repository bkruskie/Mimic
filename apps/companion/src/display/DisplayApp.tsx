/**
 * The table display: a second screen (TV, projector, spare laptop) on the DM's device. It shows only the
 * player-safe view and never sends anything but a request for the current view.
 *
 * Each display window has a layout: the map filling the screen, the map with the turn order and party beside it,
 * or the party and rolls without a map (for a wall TV next to a table with a projected map). With no map in play,
 * every layout shows the party.
 */
import { displayChannelName, type DisplayView } from "@mimicbox/table";
import { MapView } from "../components/MapView";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "../lib/markdown";

export type DisplayLayout = "map" | "map-side" | "party";
const LAYOUTS: { id: DisplayLayout; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "map-side", label: "Map and turns" },
  { id: "party", label: "Party and rolls" },
];
const LAYOUT_KEY = "mimicbox:display-layout";

/** The layout: from this window's address first (so two displays can differ), then the last one chosen. */
function initialLayout(): DisplayLayout {
  const fromUrl = new URLSearchParams(location.search).get("layout");
  const stored = (() => {
    try {
      return localStorage.getItem(LAYOUT_KEY);
    } catch {
      return null;
    }
  })();
  const pick = (v: string | null) => LAYOUTS.find((l) => l.id === v)?.id ?? null;
  return pick(fromUrl) ?? pick(stored) ?? "map-side";
}

/** True for a few seconds after the pointer moves or a control has focus, so the controls get out of the way. */
function useAwake(ms = 3000) {
  const [awake, setAwake] = useState(true);
  useEffect(() => {
    let t = window.setTimeout(() => setAwake(false), ms);
    const wake = () => {
      setAwake(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setAwake(false), ms);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [ms]);
  return awake;
}

type Roll = DisplayView["rolls"][number];

/** The newest roll, for a few seconds after it lands. */
function useFreshRoll(latest: Roll | undefined, ms = 8000): Roll | null {
  const [fresh, setFresh] = useState<Roll | null>(null);
  const first = useRef(true);
  useEffect(() => {
    // Rolls already made when the display opens aren't news.
    if (first.current) {
      first.current = false;
      return;
    }
    if (!latest) return;
    setFresh(latest);
    const t = window.setTimeout(() => setFresh(null), ms);
    return () => window.clearTimeout(t);
  }, [latest?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return fresh;
}

export function DisplayApp() {
  const campaignId = location.hash.replace(/^#/, "");
  const [view, setView] = useState<DisplayView | null>(null);
  const [tiles, setTiles] = useState<Map<string, string>>(new Map());
  const [images, setImages] = useState<Record<string, string>>({});
  const [layout, setLayoutState] = useState<DisplayLayout>(initialLayout);
  const awake = useAwake();
  useEffect(() => {
    if (!campaignId) return;
    const ch = new BroadcastChannel(displayChannelName(campaignId));
    ch.onmessage = (e) => {
      const d = e.data as DisplayView | { t: "tile"; mapId: string; tx: number; ty: number; version: string; data: string } | { t: "image"; id: string; data: string };
      if (d?.t === "display" && Array.isArray(d.members)) setView(d);
      else if (d?.t === "image" && typeof d.data === "string" && d.data.startsWith("data:image/")) setImages((prev) => ({ ...prev, [d.id]: d.data }));
      else if (d?.t === "tile" && typeof d.data === "string" && d.data.startsWith("data:image/")) setTiles((prev) => new Map(prev).set(`${d.mapId}:${d.tx}:${d.ty}:${d.version}`, d.data));
    };
    ch.postMessage({ t: "display-hello" });
    return () => ch.close();
  }, [campaignId]);
  const latest = view?.rolls.at(-1);
  const freshRoll = useFreshRoll(latest);

  const setLayout = (next: DisplayLayout) => {
    setLayoutState(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Storage blocked: the layout still changes for this window.
    }
    const url = new URL(location.href);
    url.searchParams.set("layout", next);
    history.replaceState(null, "", url);
  };

  const controls = (
    <div className={`display-controls${awake ? " awake" : ""}`} role="toolbar" aria-label="Display controls">
      <div className="theme-picker" role="group" aria-label="Layout">
        {LAYOUTS.map((l) => (
          <button key={l.id} type="button" aria-pressed={layout === l.id} onClick={() => setLayout(l.id)}>
            {l.label}
          </button>
        ))}
      </div>
      <button className="btn btn-quiet" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}>
        Full screen
      </button>
    </div>
  );

  if (!view) {
    return (
      <main className="display idle">
        <img src="./icon.svg" alt="" />
        <p>Waiting for the DM's game. Open this screen from the DM page with Open table display.</p>
      </main>
    );
  }

  const party = view.members.filter((m) => m.character);
  const spotlight = view.spotlight && (
    <article className="display-handout" aria-label={view.spotlight.title}>
      <h2>{view.spotlight.title}</h2>
      {view.spotlight.imageId && images[view.spotlight.imageId] && <img className="handout-image" src={images[view.spotlight.imageId]} alt="" />}
      <Markdown text={view.spotlight.body} />
    </article>
  );
  const initiative = view.combat && (
    <section aria-label="Initiative" className="display-combat">
      <h2>Round {view.combat.round}</h2>
      <ol className="initiative">
        {view.combat.order.map((c) => (
          <li key={c.id} aria-current={c.id === view.combat!.turnId ? "true" : undefined}>
            <span className="init">{c.initiative ?? "–"}</span>
            <span className="grow">{c.name}</span>
          </li>
        ))}
      </ol>
    </section>
  );
  const rollLine = (r: Roll) => (
    <div className={`display-latest ${r.flag ?? ""}`}>
      <span className="display-total">{r.total}</span>
      <span>
        {r.characterName}: {r.label}
      </span>
    </div>
  );

  // The map layouts: the map takes the screen.
  if (view.map && layout !== "party") {
    const map = (
      <section className="display-map" aria-label="Map">
        <MapView
          label={view.map.name}
          map={view.map}
          fit="contain"
          zoomControls={false}
          tokens={view.map.tokens}
          doors={view.map.doors ?? []}
          pins={view.map.pins ?? []}
          seen={view.map.seen ?? undefined}
          activeTokenId={view.map.activeTokenId ?? null}
          tiles={view.map.tiles.flatMap((t) => {
            const url = tiles.get(`${view.map!.id}:${t.tx}:${t.ty}:${t.version}`);
            return url ? [{ tx: t.tx, ty: t.ty, url }] : [];
          })}
        />
      </section>
    );
    if (layout === "map")
      return (
        <main className="display display-fill layout-map">
          {map}
          <div className="display-float">
            {spotlight}
            {freshRoll && rollLine(freshRoll)}
          </div>
          {controls}
        </main>
      );
    return (
      <main className="display display-fill layout-map-side">
        {map}
        <aside className="display-side" aria-label="Turns and party">
          {initiative}
          {spotlight}
          {freshRoll && rollLine(freshRoll)}
          <section aria-label="Party" className="display-party compact">
            {party.map((m) => (
              <PartyCard key={m.userId} member={m} compact />
            ))}
          </section>
        </aside>
        {controls}
      </main>
    );
  }

  // The party layout, and every layout while no map is in play.
  return (
    <main className="display layout-party">
      <header className="display-head">
        <h1>{view.campaign}</h1>
      </header>
      <div className="display-body">
        <div className="display-main">
          {initiative}
          <section aria-label="Party" className="display-party">
            {party.length === 0 && <p className="muted">The party appears here as players join.</p>}
            {party.map((m) => (
              <PartyCard key={m.userId} member={m} />
            ))}
          </section>
        </div>
        <section aria-label="Rolls" className="display-rolls">
          {spotlight}
          {latest && rollLine(latest)}
          <ul>
            {[...view.rolls]
              .reverse()
              .slice(1, 8)
              .map((r) => (
                <li key={r.id}>
                  <strong>{r.total}</strong> {r.characterName}: {r.label}
                </li>
              ))}
          </ul>
        </section>
      </div>
      {controls}
    </main>
  );
}

/** A party member's card: name, class (not in the compact side panel), hit points, AC and conditions. */
function PartyCard({ member, compact = false }: { member: DisplayView["members"][number]; compact?: boolean }) {
  const c = member.character!;
  const pct = c.hp.max ? Math.max(0, Math.min(100, (c.hp.current / c.hp.max) * 100)) : 0;
  return (
    <article className={member.connected ? "display-card" : "display-card away"}>
      <h2>{c.name}</h2>
      {!compact && <p className="muted">{c.classSummary}</p>}
      <div className={compact ? "hp-bar" : "hp-bar big"}>
        <span style={{ width: `${pct}%` }} className={pct <= 25 ? "low" : ""} />
      </div>
      <p className="display-stats">
        <span>
          HP {c.hp.current}/{c.hp.max}
          {c.hp.temp ? ` +${c.hp.temp}` : ""}
        </span>
        <span>AC {c.ac}</span>
      </p>
      {c.conditions.length > 0 && <p className="display-conditions">{c.conditions.join(", ")}</p>}
    </article>
  );
}
