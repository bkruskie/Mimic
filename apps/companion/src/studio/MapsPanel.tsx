/**
 * The DM's maps: add an image, line up the grid, reveal and hide squares, place tokens, and choose which map the
 * players see. The DM always sees the whole image; squares players can't see are shaded.
 */
import { newId } from "@mimicbox/ruleset-dnd5e";
import {
  actingTokenId,
  addMap,
  columns,
  cycleDoor,
  explore,
  removeMap,
  removeToken,
  revealAll,
  rows,
  saveToken,
  setActiveMap,
  setExplore,
  setGrid,
  setRevealed,
  setWalls,
  PIN_TEXT_MAX,
  gridKind,
  placePin,
  removePin,
  type GridKind,
  type PinLayer,
  type MapScene,
  type Token,
} from "@mimicbox/table";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapView, type MapTool } from "../components/MapView";
import { cutMap } from "../lib/mapImages";
import { deleteTiles, loadTiles, saveTiles, type StudioCampaign } from "./store";

const PARTY_COLORS = ["#7FA66B", "#C9973F", "#6FA3C7", "#B08AD6", "#E0A15A", "#8FC9B5"];
const CREATURE_COLOR = "#D9476B";

export function MapsPanel({ campaign, update, onTilesChanged }: { campaign: StudioCampaign; update: (fn: (c: StudioCampaign) => StudioCampaign) => void; onTilesChanged: (mapId: string) => void }) {
  const maps = campaign.maps ?? [];
  const [selected, setSelected] = useState<string | null>(maps[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const map = maps.find((m) => m.id === selected) ?? null;

  async function addFromFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const { width, height, tiles } = await cutMap(file);
      const id = newId();
      await saveTiles(id, tiles);
      const size = Math.max(32, Math.round(Math.max(width, height) / 30));
      const party = Object.values(campaign.members).filter((m) => m.character);
      const scene: MapScene = {
        id,
        name: file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Map",
        width,
        height,
        grid: { size, offsetX: 0, offsetY: 0 },
        revealed: [],
        tokens: party.map((m, i) => ({ id: newId(), name: m.character!.name, x: i, y: 0, memberId: m.userId, hidden: false, color: PARTY_COLORS[i % PARTY_COLORS.length]! })),
      };
      update((c) => ({ ...c, ...addMap(c, scene) }));
      onTilesChanged(id);
      setSelected(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section panel" aria-label="Maps">
      <div className="spread">
        <h2>Maps</h2>
        <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy ? "Preparing the map…" : "Add a map"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          aria-label="Map image"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void addFromFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="notice">{error}</p>}
      {maps.length === 0 && <p className="muted small">Add a battle map image (JPEG, PNG or WebP). It stays on this device; players get only the squares you reveal.</p>}
      {maps.length > 0 && (
        <div className="row" role="group" aria-label="Your maps" style={{ marginTop: 8 }}>
          {maps.map((m) => (
            <button key={m.id} className="chip" aria-pressed={m.id === selected} onClick={() => setSelected(m.id)}>
              {m.name}
              {campaign.activeMapId === m.id ? " (players see this)" : ""}
            </button>
          ))}
        </div>
      )}
      {map && <MapEditor key={map.id} campaign={campaign} map={map} update={update} onDeleted={() => setSelected(null)} />}
    </section>
  );
}

/**
 * One map's tools and view. In Play mode (`play`) it keeps what a session needs (tools, pins, exploring, tokens)
 * and leaves grid setup and deleting the map to Prepare.
 */
export function MapEditor({
  campaign,
  map,
  update,
  onDeleted,
  play = false,
}: {
  campaign: StudioCampaign;
  map: MapScene;
  update: (fn: (c: StudioCampaign) => StudioCampaign) => void;
  onDeleted: () => void;
  play?: boolean;
}) {
  const [tiles, setTiles] = useState<{ tx: number; ty: number; url: string }[]>([]);
  const [tool, setTool] = useState<MapTool>("move");
  const [grid, setGridDraft] = useState({ size: String(map.grid.size), offsetX: String(map.grid.offsetX), offsetY: String(map.grid.offsetY), kind: gridKind(map) });
  const kind = gridKind(map);
  // With no grid, fog, walls and doors still use invisible squares; the tools call them areas.
  const cellWord = kind === "square" ? "squares" : kind === "none" ? "areas" : "hexes";
  const cellOne = kind === "square" ? "square" : kind === "none" ? "area" : "hex";
  const [creature, setCreature] = useState("");
  const [hiddenCreature, setHiddenCreature] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pinText, setPinText] = useState("");
  const [pinLayer, setPinLayer] = useState<PinLayer>("dm");
  const [pinHint, setPinHint] = useState<string | null>(null);
  // What the DM shows on their own map. Players' views never change with these.
  const [show, setShow] = useState({ shading: true, walls: true, myPins: true });
  const live = campaign.activeMapId === map.id;
  const revealed = useMemo(() => new Set(map.revealed), [map.revealed]);
  const walls = useMemo(() => new Set(map.walls ?? []), [map.walls]);
  const exploring = map.explore?.on ?? false;
  const [radius, setRadius] = useState(String(map.explore?.radius ?? 0));
  const missingParty = Object.values(campaign.members).filter((m) => m.character && !map.tokens.some((t) => t.memberId === m.userId));

  useEffect(() => {
    void loadTiles(map.id).then((all) =>
      setTiles(
        [...all].map(([key, url]) => {
          const [tx, ty] = key.split(":").map(Number);
          return { tx: tx!, ty: ty!, url };
        }),
      ),
    );
  }, [map.id]);

  const center = { x: Math.floor(columns(map) / 2), y: Math.floor(rows(map) / 2) };
  const addToken = (t: Omit<Token, "id">) => update((c) => ({ ...c, ...saveToken(c, map.id, { ...t, id: newId() }) }));

  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <div className="row">
        <button className={live ? "btn" : "btn btn-primary"} onClick={() => update((c) => ({ ...c, ...setActiveMap(c, live ? null : map.id) }))}>
          {live ? "Stop showing this map" : "Show this map to players"}
        </button>
        <span className="muted small" style={{ alignSelf: "center" }}>
          {map.revealed.length} of {columns(map) * rows(map)} {cellWord} revealed
        </span>
      </div>
      <div className="row" role="group" aria-label="Map tool">
        {(
          [
            ["move", "Move tokens"],
            ["reveal", `Reveal ${cellWord}`],
            ["hide", `Hide ${cellWord}`],
            ["wall", "Draw walls"],
            ["door", "Doors"],
            ["erase", "Erase walls"],
            ["pin", "Pins"],
            ["measure", "Measure"],
          ] as const
        ).map(([t, name]) => (
          <button key={t} className="chip" aria-pressed={tool === t} onClick={() => setTool(t)}>
            {name}
          </button>
        ))}
        <button className="chip chip-quiet" onClick={() => update((c) => ({ ...c, ...revealAll(c, map.id, true) }))}>
          Reveal all
        </button>
        <button className="chip chip-quiet" onClick={() => update((c) => ({ ...c, ...revealAll(c, map.id, false) }))}>
          Hide all
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {
          {
            move: kind === "none" ? "Drag any token anywhere." : `Drag any token to a ${cellOne}.`,
            reveal: `Drag across ${cellWord} to show them to players.`,
            hide: `Drag across ${cellWord} to hide them again.`,
            wall: `Drag across ${cellWord} that block sight. Players never see walls; they only affect exploring.`,
            door: `Tap a ${cellOne} to add a closed door, tap again to open it, and again to close it.`,
            erase: "Drag across walls and doors to remove them.",
            pin: `Tap a ${cellOne} to place the pin there. Tap a pin's ${cellOne} again to remove it. Players see their pins once the ${cellOne} is revealed.`,
            measure: kind === "square" ? "Drag from one square to another to measure. Diagonal steps count 5 feet." : kind === "none" ? "Drag between any two points to measure in a straight line." : "Drag from one hex to another to measure. Each hex counts 5 feet.",
            view: "",
          }[tool]
        }
      </p>
      {tool === "pin" && (
        <div className="row" style={{ alignItems: "end" }}>
          <label className="field" style={{ flex: 1, minWidth: 180 }}>
            <span>Pin text</span>
            <input className="input" value={pinText} maxLength={PIN_TEXT_MAX} onChange={(e) => setPinText(e.target.value)} placeholder="Trap: poison needle" />
          </label>
          <div role="group" aria-label="Who sees the pin" className="row" style={{ gap: 6 }}>
            <button type="button" className="chip" aria-pressed={pinLayer === "dm"} onClick={() => setPinLayer("dm")}>
              Only you
            </button>
            <button type="button" className="chip" aria-pressed={pinLayer === "players"} onClick={() => setPinLayer("players")}>
              Players too
            </button>
          </div>
        </div>
      )}
      {pinHint && tool === "pin" && <p className="notice small">{pinHint}</p>}
      <MapView
        label={`${map.name}, as you see it`}
        map={map}
        tiles={tiles}
        tokens={map.tokens}
        revealed={show.shading ? revealed : undefined}
        tool={tool}
        canMove={() => tool === "move"}
        walls={show.walls ? walls : undefined}
        doors={show.walls ? (map.doors ?? []).map((d) => ({ x: d.index % columns(map), y: Math.floor(d.index / columns(map)), open: d.open })) : undefined}
        pins={(map.pins ?? []).filter((p) => show.myPins || p.layer === "players")}
        onPin={(x, y) => {
          const here = (map.pins ?? []).find((p) => p.x === x && p.y === y && p.layer === pinLayer);
          if (here) {
            setPinHint(null);
            update((c) => ({ ...c, ...removePin(c, map.id, here.id) }));
          } else if (!pinText.trim()) setPinHint("Type the pin's text first, then tap where it goes.");
          else {
            setPinHint(null);
            update((c) => ({ ...c, ...placePin(c, map.id, { id: newId(), x, y, label: pinText, layer: pinLayer }) }));
          }
        }}
        activeTokenId={campaign.activeMapId === map.id ? actingTokenId(campaign) : null}
        onMove={(t, x, y) => update((c) => ({ ...c, ...explore(saveToken(c, map.id, { ...t, x, y }), map.id) }))}
        onPaint={(cells, paintTool) =>
          update((c) => ({
            ...c,
            ...(paintTool === "wall" || paintTool === "erase" ? setWalls(c, map.id, cells, paintTool === "wall") : setRevealed(c, map.id, cells, paintTool === "reveal")),
          }))
        }
        onDoor={(x, y) => update((c) => ({ ...c, ...cycleDoor(c, map.id, x, y) }))}
      />
      <div className="row" role="group" aria-label="Show on your map" style={{ gap: 6, alignItems: "center" }}>
        <span className="muted small">On your map:</span>
        <button type="button" className="chip" aria-pressed={show.shading} onClick={() => setShow({ ...show, shading: !show.shading })}>
          Shading
        </button>
        <button type="button" className="chip" aria-pressed={show.walls} onClick={() => setShow({ ...show, walls: !show.walls })}>
          Walls and doors
        </button>
        <button type="button" className="chip" aria-pressed={show.myPins} onClick={() => setShow({ ...show, myPins: !show.myPins })}>
          Your pins
        </button>
      </div>
      <div className="row" style={{ alignItems: "end" }}>
        <label className="row" style={{ alignItems: "center", gap: 8, minHeight: 44 }}>
          <input
            type="checkbox"
            checked={exploring}
            onChange={(e) => update((c) => ({ ...c, ...setExplore(c, map.id, { on: e.target.checked, radius: Number(radius) || 0 }) }))}
          />
          <span>Reveal as the party explores</span>
        </label>
        <label className="field" style={{ width: 150 }}>
          <span>Sight in {cellWord}</span>
          <input
            className="input"
            inputMode="numeric"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            onBlur={() => update((c) => ({ ...c, ...setExplore(c, map.id, { on: exploring, radius: Number(radius) || 0 }) }))}
          />
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        When on, {cellWord} the party's tokens can see are revealed as they move. Walls and closed doors block sight; a sight of 0 means no limit. Revealed {cellWord} stay revealed.
      </p>
      {!play && (
      <details>
        <summary style={{ cursor: "pointer" }}>Grid</summary>
        <form
          className="row"
          style={{ alignItems: "end", marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            update((c) => ({ ...c, ...setGrid(c, map.id, { size: Number(grid.size) || map.grid.size, offsetX: Number(grid.offsetX) || 0, offsetY: Number(grid.offsetY) || 0, kind: grid.kind }) }));
          }}
        >
          <label className="field" style={{ width: 190 }}>
            <span>Grid shape</span>
            <select className="input" value={grid.kind} onChange={(e) => setGridDraft({ ...grid, kind: e.target.value as GridKind })}>
              <option value="square">Squares</option>
              <option value="hex-rows">Hexes in rows (pointed tops)</option>
              <option value="hex-columns">Hexes in columns (flat tops)</option>
              <option value="none">No grid</option>
            </select>
          </label>
          <label className="field" style={{ width: 110 }}>
            <span>{grid.kind === "square" ? "Square size (px)" : grid.kind === "hex-rows" ? "Hex width (px)" : grid.kind === "hex-columns" ? "Hex height (px)" : "Pixels per 5 feet"}</span>
            <input className="input" inputMode="numeric" value={grid.size} onChange={(e) => setGridDraft({ ...grid, size: e.target.value })} />
          </label>
          <label className="field" style={{ width: 90 }}>
            <span>Shift right</span>
            <input className="input" inputMode="numeric" value={grid.offsetX} onChange={(e) => setGridDraft({ ...grid, offsetX: e.target.value })} />
          </label>
          <label className="field" style={{ width: 90 }}>
            <span>Shift down</span>
            <input className="input" inputMode="numeric" value={grid.offsetY} onChange={(e) => setGridDraft({ ...grid, offsetY: e.target.value })} />
          </label>
          <button className="btn">Apply grid</button>
        </form>
        <p className="muted small">
          {grid.kind === "none"
            ? "Tokens move freely and distances are straight lines. Pixels per 5 feet sets the scale, and the size of the areas you reveal and wall off."
            : `Match the grid drawn on your map.${grid.kind === "square" ? "" : ` For hexes, the size is the distance between the centres of two neighbouring hexes in a ${grid.kind === "hex-columns" ? "column" : "row"}.`}`}{" "}
          Changing the grid hides everything again and clears walls and doors.
        </p>
      </details>
      )}
      <h3>Tokens</h3>
      <ul className="rows" aria-label="Tokens">
        {map.tokens.map((t) => (
          <li key={t.id} className="resource spread">
            <span>
              <span className="token-dot" style={{ background: t.color }} /> {t.name}
              <span className="muted small">{t.memberId ? ", player" : t.hidden ? ", hidden from players" : ""}</span>
            </span>
            <span className="row">
              {!t.memberId && (
                <button className="btn btn-quiet small" onClick={() => update((c) => ({ ...c, ...saveToken(c, map.id, { ...t, hidden: !t.hidden }) }))}>
                  {t.hidden ? "Reveal" : "Hide"}
                </button>
              )}
              <button className="btn btn-quiet small" aria-label={`Remove ${t.name}`} onClick={() => update((c) => ({ ...c, ...removeToken(c, map.id, t.id) }))}>
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
      {missingParty.length > 0 && (
        <button
          className="btn"
          onClick={() =>
            missingParty.forEach((m, i) => addToken({ name: m.character!.name, x: center.x + i, y: center.y, memberId: m.userId, hidden: false, color: PARTY_COLORS[(map.tokens.length + i) % PARTY_COLORS.length]! }))
          }
        >
          Add party tokens ({missingParty.map((m) => m.character!.name).join(", ")})
        </button>
      )}
      <form
        className="row"
        style={{ alignItems: "end" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!creature.trim()) return;
          addToken({ name: creature.trim().slice(0, 40), x: center.x, y: center.y, memberId: null, hidden: hiddenCreature, color: CREATURE_COLOR });
          setCreature("");
        }}
      >
        <label className="field" style={{ flex: 1, minWidth: 140 }}>
          <span>Creature token</span>
          <input className="input" value={creature} onChange={(e) => setCreature(e.target.value)} placeholder="Ogre" />
        </label>
        <label className="row" style={{ alignItems: "center", gap: 6, minHeight: 44 }}>
          <input type="checkbox" checked={hiddenCreature} onChange={(e) => setHiddenCreature(e.target.checked)} />
          <span>Hidden</span>
        </label>
        <button className="btn" disabled={!creature.trim()}>
          Add token
        </button>
      </form>
      {!play && (
      <div>
        {confirmDelete ? (
          <span className="row">
            <button
              className="btn btn-danger"
              onClick={() => {
                void deleteTiles(map.id);
                update((c) => ({ ...c, ...removeMap(c, map.id) }));
                onDeleted();
              }}
            >
              Delete {map.name}
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </span>
        ) : (
          <button className="btn btn-quiet" onClick={() => setConfirmDelete(true)}>
            Delete map
          </button>
        )}
      </div>
      )}
    </div>
  );
}
