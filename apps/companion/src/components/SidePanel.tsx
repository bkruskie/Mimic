/**
 * A side panel beside the map that the user can resize (drag its edge, or arrow keys on it) and fold away, with the
 * layout remembered on this device (docs/design.md). Used by the player's table view and the DM's Play mode.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { PanelIcon } from "../lib/icons";

const MIN = 260;
const MAX = 620;

export interface PanelLayout<T extends string = string> {
  open: boolean;
  width: number;
  tab: T;
}

/** The panel's layout, kept in localStorage under `key`. */
export function usePanelLayout<T extends string>(key: string, tabs: readonly T[], fallback: PanelLayout<T>) {
  const [layout, setLayout] = useState<PanelLayout<T>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<PanelLayout<T>> | null;
      return {
        open: raw?.open !== undefined ? raw.open !== false : fallback.open,
        width: typeof raw?.width === "number" ? Math.max(MIN, Math.min(MAX, raw.width)) : fallback.width,
        tab: raw?.tab && tabs.includes(raw.tab) ? raw.tab : fallback.tab,
      };
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(layout));
    } catch {
      /* Private browsing can refuse storage; the layout just isn't remembered. */
    }
  }, [key, layout]);
  return [layout, setLayout] as const;
}

/** The button that folds the panel away or brings it back. */
export function PanelToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? "Hide the side panel" : "Show the side panel";
  return (
    <button className="btn btn-quiet table-bar-btn" aria-pressed={open} aria-label={label} title={label} onClick={onToggle}>
      <PanelIcon width={20} height={20} />
    </button>
  );
}

/** The resize handle and the panel itself. Render it only while the panel is open. */
export function SidePanel({ width, onWidth, label, children }: { width: number; onWidth: (w: number) => void; label: string; children: ReactNode }) {
  const resizing = useRef<{ x: number; width: number } | null>(null);
  const set = (w: number) => onWidth(Math.max(MIN, Math.min(MAX, Math.round(w))));
  return (
    <>
      <div
        className="table-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Side panel width"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          resizing.current = { x: e.clientX, width };
        }}
        onPointerMove={(e) => resizing.current && set(resizing.current.width + (resizing.current.x - e.clientX))}
        onPointerUp={() => (resizing.current = null)}
        onPointerCancel={() => (resizing.current = null)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "ArrowLeft") set(width + 20);
          if (e.key === "ArrowRight") set(width - 20);
        }}
      />
      <aside className="table-panel" style={{ width }} aria-label={label}>
        {children}
      </aside>
    </>
  );
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

