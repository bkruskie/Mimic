/**
 * A battle map: tiles, a grid of squares or hexes, tokens and, for the DM, the fog drawn over cells players can't see.
 * Used by the DM page, the player's sheet and the table display. Plain DOM and SVG, no canvas, so it stays crisp
 * when zoomed and simple to test.
 */
import { TILE_SIZE, cellAt as gridCellAt, cellCentre, cellPolygon, columns, distanceFeet, gridKind, gridPath, polygonPath, rows, tokenSpotAt, type MapScene, type Point, type Token } from "@mimicbox/table";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

export type MapTool = "view" | "reveal" | "hide" | "move" | "measure" | "wall" | "erase" | "door" | "pin" | "light";
/** Tools that paint across squares by dragging. */
export type PaintTool = "reveal" | "hide" | "wall" | "erase";

interface Props {
  map: Pick<MapScene, "width" | "height" | "grid">;
  tiles: { tx: number; ty: number; url: string }[];
  tokens: Token[];
  /** The DM's own view: the squares players can see. Unrevealed squares get a fog overlay. */
  revealed?: ReadonlySet<number>;
  tool?: MapTool;
  canMove?: (t: Token) => boolean;
  onMove?: (t: Token, x: number, y: number) => void;
  onPaint?: (cells: { x: number; y: number }[], tool: PaintTool) => void;
  onDoor?: (x: number, y: number) => void;
  /** The DM's view: walls drawn on the map. */
  walls?: ReadonlySet<number>;
  /** Doors drawn on the map. With `onDoor` in the view tool, tapping one opens or closes it. */
  doors?: { x: number; y: number; open: boolean }[];
  /** Pins to draw. Those on the DM's layer get the dashed "only you" look. */
  pins?: { id: string; x: number; y: number; label: string; layer?: "dm" | "players" }[];
  /** With the pin tool, a tap on a cell. */
  onPin?: (x: number, y: number) => void;
  /** A dark map: the squares seen now. Every other square is drawn dimmed. */
  seen?: ReadonlySet<number> | readonly number[];
  /** The DM's view: lights on the map, drawn with their reach. */
  lights?: { id: string; x: number; y: number; radius: number }[];
  /** With the light tool, a tap on a cell. */
  onLight?: (x: number, y: number) => void;
  /** Zoom buttons under the map. Off for the table display, which always fits the map to the screen. */
  zoomControls?: boolean;
  /** The token whose turn it is. */
  activeTokenId?: string | null;
  /** Fit the whole map in the box instead of its width (the table display). */
  fit?: "width" | "contain";
  label: string;
}

export function MapView({ map, tiles, tokens, revealed, tool = "view", canMove = () => false, onMove, onPaint, onDoor, walls, doors, pins, onPin, seen, lights, onLight, zoomControls = true, activeTokenId = null, fit = "width", label }: Props) {
  const [ruler, setRuler] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ token: Token; x: number; y: number } | null>(null);
  const [paint, setPaint] = useState<Map<number, { x: number; y: number }> | null>(null);
  const cols = columns(map);
  const rws = rows(map);
  const { size, offsetX, offsetY } = map.grid;
  const kind = gridKind(map);
  const hex = kind === "hex-rows" || kind === "hex-columns";
  // Every hex outline in one path; recomputed only when the grid changes.
  const hexGrid = useMemo(() => (hex ? gridPath(map) : ""), [hex, map.width, map.height, map.grid.size, map.grid.offsetX, map.grid.offsetY, map.grid.kind]); // eslint-disable-line react-hooks/exhaustive-deps

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
    return gridCellAt(map, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
  };
  /** Where a dragged token or the ruler's end lands: a cell, or any point on a map with no grid. */
  const spotAt = (e: PointerEvent): { x: number; y: number } => {
    const r = surface.current!.getBoundingClientRect();
    return tokenSpotAt(map, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
  };
  const center = (x: number, y: number) => {
    const c = cellCentre(map, x, y);
    return { cx: c.x, cy: c.y };
  };
  /** A cell's shape: a rect on squares (crisp, and what the tests look for), a polygon on hexes. */
  const shape = (x: number, y: number, className: string, key: string, shrink = 1) => {
    if (!hex) {
      const inset = (size * (1 - shrink)) / 2;
      return <rect key={key} className={className} x={offsetX + x * size + inset} y={offsetY + y * size + inset} width={size * shrink} height={size * shrink} />;
    }
    const c = cellCentre(map, x, y);
    const pts = cellPolygon(map, x, y).map((p): Point => ({ x: c.x + (p.x - c.x) * shrink, y: c.y + (p.y - c.y) * shrink }));
    return <path key={key} className={className} d={polygonPath(pts)} />;
  };
  const painting = tool === "reveal" || tool === "hide" || tool === "wall" || tool === "erase";
  const [measuring, setMeasuring] = useState(false);

  function down(e: PointerEvent) {
    if (tool === "measure") {
      e.currentTarget.setPointerCapture(e.pointerId);
      const c = spotAt(e);
      setRuler({ from: c, to: c });
      setMeasuring(true);
      return;
    }
    if (tool === "pin" && onPin) {
      const c = cellAt(e);
      onPin(c.x, c.y);
      return;
    }
    if (tool === "light" && onLight) {
      const c = cellAt(e);
      onLight(c.x, c.y);
      return;
    }
    if (tool === "door" && onDoor) {
      const c = cellAt(e);
      onDoor(c.x, c.y);
      return;
    }
    if (tool === "view" && onDoor) {
      const c = cellAt(e);
      if (doors?.some((d) => d.x === c.x && d.y === c.y)) onDoor(c.x, c.y);
      return;
    }
    if (!painting || !onPaint) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const c = cellAt(e);
    setPaint(new Map([[c.y * cols + c.x, c]]));
  }
  function moveOver(e: PointerEvent) {
    if (measuring && ruler) {
      const c = spotAt(e);
      if (c.x !== ruler.to.x || c.y !== ruler.to.y) setRuler({ ...ruler, to: c });
    } else if (paint) {
      const c = cellAt(e);
      if (!paint.has(c.y * cols + c.x)) setPaint(new Map(paint).set(c.y * cols + c.x, c));
    } else if (drag) setDrag({ ...drag, ...spotAt(e) });
  }
  function up() {
    setMeasuring(false);
    if (paint && onPaint && painting) onPaint([...paint.values()], tool as PaintTool);
    setPaint(null);
    if (drag && onMove && (drag.x !== drag.token.x || drag.y !== drag.token.y)) onMove(drag.token, drag.x, drag.y);
    setDrag(null);
  }

  const fog: { x: number; y: number }[] = [];
  if (revealed && !hex) for (let y = 0; y < rws; y++) for (let x = 0; x < cols; x++) if (!revealed.has(y * cols + x)) fog.push({ x, y });
  // Darkness: everything not seen now, as one path (the map minus the seen cells), on squares and hexes alike.
  const darkness = useMemo(() => {
    if (!seen) return "";
    const holes = [...seen].map((i) => polygonPath(cellPolygon(map, i % cols, Math.floor(i / cols)))).join("");
    return `M0 0H${map.width}V${map.height}H0Z${holes}`;
  }, [seen, map, cols]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="map-view">
      <div className="map-box" ref={box} role="img" aria-label={label}>
        <div
          ref={surface}
          className={`map-surface ${painting || tool === "measure" || tool === "door" || tool === "pin" || tool === "light" ? "painting" : ""}`}
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
            {kind === "none" ? null : hex ? (
              <path d={hexGrid} fill="none" stroke="rgba(239,228,210,0.35)" strokeWidth={Math.max(1, size / 60)} />
            ) : (
              <>
                <defs>
                  <pattern id="grid" x={offsetX} y={offsetY} width={size} height={size} patternUnits="userSpaceOnUse">
                    <path d={`M ${size} 0 L 0 0 0 ${size}`} fill="none" stroke="rgba(239,228,210,0.35)" strokeWidth={Math.max(1, size / 60)} />
                  </pattern>
                </defs>
                <rect width={map.width} height={map.height} fill="url(#grid)" />
              </>
            )}
            {hex && revealed ? (
              // Hexes: the whole map minus the revealed hexes, so margins outside every hex are fogged too, as they
              // are in what players receive.
              <path className="fog" fillRule="evenodd" d={`M0 0H${map.width}V${map.height}H0Z${[...revealed].map((i) => polygonPath(cellPolygon(map, i % cols, Math.floor(i / cols)))).join("")}`} />
            ) : (
              fog.map((c) => shape(c.x, c.y, "fog", `f${c.x}:${c.y}`))
            )}
            {darkness && <path className="darkness" fillRule="evenodd" d={darkness} />}
            {lights?.map((l) => {
              const { cx, cy } = center(l.x, l.y);
              return (
                <g key={l.id} className="light">
                  <circle className="light-reach" cx={cx} cy={cy} r={(l.radius + 0.5) * size} strokeWidth={Math.max(1, size / 30)} />
                  <circle className="light-flame" cx={cx} cy={cy} r={size * 0.18} />
                </g>
              );
            })}
            {walls && [...walls].map((i) => shape(i % cols, Math.floor(i / cols), "wall", `w${i}`))}
            {doors?.map((d) => shape(d.x, d.y, d.open ? "door open" : "door", `d${d.x}:${d.y}`, 0.7))}
            {paint && [...paint.values()].map((c) => shape(c.x, c.y, `paint-${tool}`, `p${c.x}:${c.y}`))}
            {ruler && (
              <g className="ruler">
                <line x1={center(ruler.from.x, ruler.from.y).cx} y1={center(ruler.from.x, ruler.from.y).cy} x2={center(ruler.to.x, ruler.to.y).cx} y2={center(ruler.to.x, ruler.to.y).cy} strokeWidth={Math.max(2, size / 14)} />
                <circle cx={center(ruler.to.x, ruler.to.y).cx} cy={center(ruler.to.x, ruler.to.y).cy} r={size / 8} />
              </g>
            )}
          </svg>
          {pins?.map((p) => {
            const { cx, cy } = center(p.x, p.y);
            return (
              <span
                key={p.id}
                className={`pin ${p.layer === "dm" ? "dm" : ""}`}
                aria-label={`Pin: ${p.label}${p.layer === "dm" ? " (only you)" : ""}`}
                style={{ left: cx * scale, top: (cy - size * 0.5) * scale + 2, fontSize: Math.max(11, Math.min(15, size * 0.2 * scale)) }}
              >
                {p.label}
              </span>
            );
          })}
          {tokens.map((t) => {
            const at = drag?.token.id === t.id ? drag : t;
            const { cx, cy } = center(at.x, at.y);
            const movable = tool === "move" || tool === "view" ? canMove(t) : false;
            return (
              <button
                key={t.id}
                type="button"
                className={`token ${t.hidden ? "hidden" : ""} ${movable ? "movable" : ""} ${t.id === activeTokenId ? "acting" : ""}`}
                aria-label={`${t.name}${t.hidden ? " (hidden)" : ""}${t.id === activeTokenId ? ", acting now" : ""}`}
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
      {zoomControls && (
      <div className="row map-zoom">
        {ruler && (
          <span className="ruler-label" role="status">
            {distanceFeet(ruler.from, ruler.to, map)} ft
          </span>
        )}
        <button type="button" className="btn btn-quiet" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}>
          −
        </button>
        <span className="muted small">{Math.round(scale * 100)}%</span>
        <button type="button" className="btn btn-quiet" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>
          +
        </button>
      </div>
      )}
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
