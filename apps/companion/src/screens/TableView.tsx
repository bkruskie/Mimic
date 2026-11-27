/**
 * The table, from a player's seat: the map as large as the screen allows, with the game around it (docs/design.md).
 * A phone in portrait shows the map between a one-line status bar and the sheet's tabs; party and journal open as
 * drawers. Anything wider (a phone on its side, a tablet, a laptop) shows the map beside a side panel the player
 * can resize or fold away, and the layout is remembered on this device.
 */
import type { Character, DerivedSheet } from "@mimicbox/ruleset-dnd5e";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MapView } from "../components/MapView";
import { PanelIcon, ScrollIcon } from "../lib/icons";
import { useTable } from "../lib/table";
import { CombatBanner, JournalPanel, PartyPanel, tableStatusText } from "./TablePanels";

const LAYOUT_KEY = "mimicbox:table-layout";
const SHORT_STATUS: Record<string, string> = { connected: "Connected", waiting: "Waiting", connecting: "Connecting", denied: "Not let in", error: "Can't connect", idle: "Not connected" };
const MIN_PANEL = 260;
const MAX_PANEL = 560;

interface Layout {
  open: boolean;
  width: number;
  tab: "party" | "journal";
}

function loadLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    return {
      open: raw?.open !== false,
      width: typeof raw?.width === "number" ? Math.max(MIN_PANEL, Math.min(MAX_PANEL, raw.width)) : 320,
      tab: raw?.tab === "journal" ? "journal" : "party",
    };
  } catch {
    return { open: true, width: 320, tab: "party" };
  }
}

/** True when the screen is wide enough for the map and a side panel: a phone on its side and anything larger. */
export function useWideTable(): boolean {
  const q = "(min-width: 720px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const list = window.matchMedia(q);
    const on = () => setWide(list.matches);
    list.addEventListener("change", on);
    return () => list.removeEventListener("change", on);
  }, []);
  return wide;
}

export function TableView({
  character,
  sheet,
  wide,
  onSheet,
  onHp,
  onParty,
  onJournal,
  onRollInitiative,
}: {
  character: Character;
  sheet: DerivedSheet;
  /** Map and side panel side by side; otherwise the phone layout. */
  wide: boolean;
  /** Back to the sheet: shown when there are no sheet tabs below (wide screens). */
  onSheet: (() => void) | null;
  onHp: () => void;
  onParty: () => void;
  onJournal: () => void;
  onRollInitiative: () => void;
}) {
  const table = useTable();
  const [tool, setTool] = useState<"view" | "measure">("view");
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const resizing = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* Private browsing can refuse storage; the layout just isn't remembered. */
    }
  }, [layout]);
  const setWidth = (w: number) => setLayout((l) => ({ ...l, width: Math.max(MIN_PANEL, Math.min(MAX_PANEL, Math.round(w))) }));
  const hasJournal = table.world.length > 0;
  const tab = layout.tab === "journal" && hasJournal ? "journal" : "party";
  const campaign = table.invite?.campaign ?? "the game";
  const hp = sheet.hp;
  const tools = table.map && (
    <div className="table-tools" role="group" aria-label="Map tool">
      <button className="chip" aria-pressed={tool === "view"} onClick={() => setTool("view")} title="Drag your token to move it. Tap a door next to it to open or close it.">
        Move my token
      </button>
      <button className="chip" aria-pressed={tool === "measure"} onClick={() => setTool("measure")} title="Drag between two points to measure.">
        Measure
      </button>
    </div>
  );

  return (
    <div className={`table-view ${wide ? "wide" : ""}`}>
      <header className="table-bar">
        {onSheet && (
          <button className="btn btn-quiet table-bar-btn" onClick={onSheet}>
            <ScrollIcon width={20} height={20} />
            Sheet
          </button>
        )}
        {wide && <strong className="table-bar-name">{character.name}</strong>}
        <button className="table-hp" onClick={onHp} aria-label={`Hit points ${hp.current} of ${hp.max.value}. Change hit points.`}>
          <span className="table-hp-bar" aria-hidden="true">
            <span style={{ width: `${hp.max.value ? Math.max(0, Math.min(100, (hp.current / hp.max.value) * 100)) : 0}%` }} />
          </span>
          HP {hp.current}/{hp.max.value}
          {hp.temp ? ` +${hp.temp}` : ""}
        </button>
        <span className="table-bar-stat">AC {sheet.ac.value}</span>
        {wide && tools}
        <span className="table-bar-gap" />
        {!wide && hasJournal && (
          <button className="chip" onClick={onJournal}>
            Journal
          </button>
        )}
        {wide ? (
          <button
            className="btn btn-quiet table-bar-btn"
            aria-pressed={layout.open}
            aria-label={layout.open ? "Hide the side panel" : "Show the side panel"}
            title={layout.open ? "Hide the side panel" : "Show the side panel"}
            onClick={() => setLayout((l) => ({ ...l, open: !l.open }))}
          >
            <PanelIcon width={20} height={20} />
          </button>
        ) : (
          <span className={`chip chip-table table-status ${table.status}`} role="status" aria-label={tableStatusText(table.status, campaign)}>
            {SHORT_STATUS[table.status] ?? table.status}
          </span>
        )}
      </header>

      <div className="table-body">
        <div className="table-map">
          {table.combat && <CombatBanner sheet={sheet} onRollInitiative={onRollInitiative} onOpen={wide ? () => setLayout((l) => ({ ...l, open: true, tab: "party" })) : onParty} />}
          {table.map ? (
            <>
              {!wide && tools}
              <MapView
                fit={wide ? "contain" : "width"}
                tool={tool}
                label={`${table.map.name}, the parts you can see`}
                map={table.map}
                tiles={table.mapTiles}
                tokens={table.map.tokens}
                doors={table.map.doors ?? []}
                pins={table.map.pins ?? []}
                activeTokenId={table.map.activeTokenId ?? null}
                onDoor={tool === "view" ? (x, y) => table.toggleDoor(x, y) : undefined}
                canMove={(t) => t.memberId !== null && t.memberId === table.memberId}
                onMove={(t, x, y) => table.moveToken(t.id, x, y)}
              />
            </>
          ) : (
            <p className="table-empty muted">No map on the table yet. It appears here as soon as your DM shows one.</p>
          )}
          {!wide && (
            // A phone in portrait: whatever height the map doesn't need goes to the game around it.
            <section className="table-below" aria-label={campaign}>
              <PartyPanel />
            </section>
          )}
        </div>

        {wide && layout.open && (
          <>
            <div
              className="table-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Side panel width"
              aria-valuemin={MIN_PANEL}
              aria-valuemax={MAX_PANEL}
              aria-valuenow={layout.width}
              tabIndex={0}
              onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                resizing.current = { x: e.clientX, width: layout.width };
              }}
              onPointerMove={(e) => resizing.current && setWidth(resizing.current.width + (resizing.current.x - e.clientX))}
              onPointerUp={() => (resizing.current = null)}
              onPointerCancel={() => (resizing.current = null)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "ArrowLeft") setWidth(layout.width + 20);
                if (e.key === "ArrowRight") setWidth(layout.width - 20);
              }}
            />
            <aside className="table-panel" style={{ width: layout.width }} aria-label="Side panel">
              {hasJournal && (
                <div className="row table-panel-tabs" role="tablist" aria-label="Side panel">
                  <button role="tab" className="chip" aria-selected={tab === "party"} aria-pressed={tab === "party"} onClick={() => setLayout((l) => ({ ...l, tab: "party" }))}>
                    Party
                  </button>
                  <button role="tab" className="chip" aria-selected={tab === "journal"} aria-pressed={tab === "journal"} onClick={() => setLayout((l) => ({ ...l, tab: "journal" }))}>
                    Journal
                  </button>
                </div>
              )}
              <h2 className="table-panel-title">{tab === "journal" ? "Journal" : campaign}</h2>
              {tab === "journal" ? <JournalPanel /> : <PartyPanel />}
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
