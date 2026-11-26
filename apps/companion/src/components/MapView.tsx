/**
 * A battle map: tiles, a square grid, tokens and, for the DM, the fog drawn over squares players can't see.
 * Used by the DM page, the player's sheet and the table display. Plain DOM and SVG, no canvas, so it stays crisp
 * when zoomed and simple to test.
 */
import { TILE_SIZE, columns, rows, type MapScene, type Token } from "@mimicbox/table";
import { useEffect, useRef, useState, type PointerEvent } from "react";

export type MapTool = "view" | "reveal" | "hide" | "move";

interface Props {
  map: Pick<MapScene, "width" | "height" | "grid">;
  tiles: { tx: number; ty: number; url: string }[];
  tokens: Token[];
  /** The DM's own view: the squares players can see. Unrevealed squares get a fog overlay. */
  revealed?: ReadonlySet<number>;
  tool?: MapTool;
  canMove?: (t: Token) => boolean;
  onMove?: (t: Token, x: number, y: number) => void;
  onPaint?: (cells: { x: number; y: number }[], reveal: boolean) => void;
  /** Fit the whole map in the box instead of its width (the table display). */
  fit?: "width" | "contain";
  label: string;
}

export function MapView({ map, tiles, tokens, revealed, tool = "view", canMove = () => false, onMove, onPaint, fit = "width", label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ token: Token; x: number; y: number } | null>(null);
  const [paint, setPaint] = useState<Map<number, { x: number; y: number }> | null>(null);
  const cols = columns(map as MapScene);
  const rws = rows(map as MapScene);
  const { size, offsetX, offsetY } = map.grid;

  // Scale to the box, then let the user zoom from there.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth || map.width;
      const h = el.clientHeight || map.height;
      setFitScale(fit === "contain" ? Math.min(w / map.width, h / map.height) : Math.min(1, w / map.width));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [map.width, map.height, fit]);

  const scale = fitScale * zoom;
  const cellAt = (e: PointerEvent): { x: number; y: number } => {
    const r = surface.current!.getBoundingClientRect();
    const px = (e.clientX - r.left) / scale;
    const py = (e.clientY - r.top) / scale;
    const x = px < offsetX ? 0 : Math.floor((px - offsetX) / size);
    const y = py < offsetY ? 0 : Math.floor((py - offsetY) / size);
    return { x: Math.max(0, Math.min(cols - 1, x)), y: Math.max(0, Math.min(rws - 1, y)) };
  };
  const center = (x: number, y: number) => ({ cx: offsetX + (x + 0.5) * size, cy: offsetY + (y + 0.5) * size });
  const painting = tool === "reveal" || tool === "hide";

  function down(e: PointerEvent) {
    if (!painting || !onPaint) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const c = cellAt(e);
    setPaint(new Map([[c.y * cols + c.x, c]]));
  }
  function moveOver(e: PointerEvent) {
    if (paint) {
      const c = cellAt(e);
      if (!paint.has(c.y * cols + c.x)) setPaint(new Map(paint).set(c.y * cols + c.x, c));
    } else if (drag) setDrag({ ...drag, ...cellAt(e) });
  }
  function up() {
    if (paint && onPaint) onPaint([...paint.values()], tool === "reveal");
    setPaint(null);
    if (drag && onMove && (drag.x !== drag.token.x || drag.y !== drag.token.y)) onMove(drag.token, drag.x, drag.y);
    setDrag(null);
  }

  const fog: { x: number; y: number }[] = [];
  if (revealed) for (let y = 0; y < rws; y++) for (let x = 0; x < cols; x++) if (!revealed.has(y * cols + x)) fog.push({ x, y });

  return (
    <div className="map-view">
      <div className="map-box" ref={box} role="img" aria-label={label}>
        <div
          ref={surface}
          className={`map-surface ${painting ? "painting" : ""}`}
          style={{ width: map.width * scale, height: map.height * scale }}
          onPointerDown={down}
          onPointerMove={moveOver}
          onPointerUp={up}
          onPointerCancel={up}
        >
          {tiles.map((t) => (
            <img
              key={`${t.tx}:${t.ty}`}
              src={t.url}
              alt=""
              draggable={false}
              style={{ left: t.tx * TILE_SIZE * scale, top: t.ty * TILE_SIZE * scale, width: Math.min(TILE_SIZE, map.width - t.tx * TILE_SIZE) * scale, height: Math.min(TILE_SIZE, map.height - t.ty * TILE_SIZE) * scale }}
            />
          ))}
          <svg className="map-overlay" viewBox={`0 0 ${map.width} ${map.height}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <pattern id="grid" x={offsetX} y={offsetY} width={size} height={size} patternUnits="userSpaceOnUse">
                <path d={`M ${size} 0 L 0 0 0 ${size}`} fill="none" stroke="rgba(239,228,210,0.35)" strokeWidth={Math.max(1, size / 60)} />
              </pattern>
            </defs>
            <rect width={map.width} height={map.height} fill="url(#grid)" />
            {fog.map((c) => (
              <rect key={`f${c.x}:${c.y}`} className="fog" x={offsetX + c.x * size} y={offsetY + c.y * size} width={size} height={size} />
            ))}
            {paint &&
              [...paint.values()].map((c) => (
                <rect key={`p${c.x}:${c.y}`} className={tool === "reveal" ? "paint-reveal" : "paint-hide"} x={offsetX + c.x * size} y={offsetY + c.y * size} width={size} height={size} />
              ))}
          </svg>
          {tokens.map((t) => {
            const at = drag?.token.id === t.id ? drag : t;
            const { cx, cy } = center(at.x, at.y);
            const movable = tool === "move" || tool === "view" ? canMove(t) : false;
            return (
              <button
                key={t.id}
                type="button"
                className={`token ${t.hidden ? "hidden" : ""} ${movable ? "movable" : ""}`}
                aria-label={`${t.name}${t.hidden ? " (hidden)" : ""}`}
                title={t.name}
                style={{ left: (cx - size * 0.42) * scale, top: (cy - size * 0.42) * scale, width: size * 0.84 * scale, height: size * 0.84 * scale, background: t.color, fontSize: Math.max(10, size * 0.32 * scale) }}
                onPointerDown={(e) => {
                  if (!movable) return;
                  e.stopPropagation();
                  surface.current?.setPointerCapture(e.pointerId);
                  setDrag({ token: t, x: t.x, y: t.y });
                }}
              >
                {initials(t.name)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="row map-zoom">
        <button type="button" className="btn btn-quiet" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}>
          −
        </button>
        <span className="muted small">{Math.round(scale * 100)}%</span>
        <button type="button" className="btn btn-quiet" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>
          +
        </button>
      </div>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
