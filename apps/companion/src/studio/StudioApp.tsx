/**
 * The DM's page: campaigns kept on this device, and hosting one so players can join from their sheets.
 */
import { DiceSyntaxError, describeRoll, formatModifier, parseDice, roll as rollDice } from "@mimicbox/dice";
import { ABILITIES, ABILITY_NAMES, CONDITIONS, SKILLS, SKILL_IDS, derive, newId, srdContent as content } from "@mimicbox/ruleset-dnd5e";
import {
  CampaignImportError,
  HANDOUT_MAX_LENGTH,
  addCombatant,
  addDmRoll,
  columns,
  endCombat,
  initiativeOrder,
  nextTurn,
  previousTurn,
  removeCombatant,
  startCombat,
  updateCombatant,
  type Combat,
  type Effect,
  createCampaign,
  LanCodeError,
  campaignImageIds,
  exportCampaign,
  importCampaign,
  randomSecret,
  removeHandout,
  removeMember,
  replaceInvite,
  rows,
  saveToken,
  saveHandout,
  setActiveMap,
  setHandoutRevealed,
  type Handout,
  type Member,
  type SharedRoll,
} from "@mimicbox/table";
import { Markdown } from "../lib/markdown";
import { downloadJson, fileSafe } from "../lib/download";
import { QrCode, QrScanner } from "../components/qr";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackIcon } from "../lib/icons";
import { scaleHandoutImage } from "../lib/mapImages";
import { StoredImage } from "./pictures";
import { deleteCampaign, deleteImage, getCampaign, listCampaigns, loadImage, loadTiles, relaysFromAddress, saveCampaign, saveImage, saveTiles, type StudioCampaign } from "./store";
import { MapEditor, MapsPanel } from "./MapsPanel";
import { SessionPlay, SessionsPanel } from "./Sessions";
import { ScenePlay, ScenesPanel } from "./Scenes";
import { EncountersPanel, RunEncounters } from "./Encounters";
import { BestiaryAdd, StatBlock, useMonsters, type NewCombatant } from "./Bestiary";
import { Drawer } from "../components/Drawer";
import { PanelToggle, SidePanel, usePanelLayout, useWideTable } from "../components/SidePanel";
import { WorldPanel } from "./WorldPanel";
import { useHost } from "./useHost";

const route = () => /^#\/c\/([\w-]+)$/.exec(location.hash)?.[1] ?? null;

export function StudioApp() {
  const [id, setId] = useState(route);
  useEffect(() => {
    const on = () => setId(route());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return id ? <CampaignLoader key={id} id={id} /> : <CampaignList />;
}

function CampaignList() {
  const [campaigns, setCampaigns] = useState<StudioCampaign[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listCampaigns().then(setCampaigns, (e: Error) => setError(e.message));
  }, []);
  const fileInput = useRef<HTMLInputElement>(null);
  async function onImport(file: File) {
    setError(null);
    try {
      const { campaign, problems, tiles, images } = importCampaign(JSON.parse(await file.text()), content, { room: randomSecret(), key: randomSecret() });
      for (const [mapId, t] of Object.entries(tiles)) await saveTiles(mapId, new Map(Object.entries(t)));
      for (const [id, data] of Object.entries(images)) await saveImage(id, data);
      const taken = (campaigns ?? []).some((c) => c.id === campaign.id);
      const c: StudioCampaign = { ...campaign, ...(taken ? { id: newId(), name: `${campaign.name} (copy)` } : {}), relays: relaysFromAddress() };
      await saveCampaign(c);
      sessionStorage.setItem(`imported:${c.id}`, "1");
      if (problems.length) sessionStorage.setItem(`import-problems:${c.id}`, problems.join(" "));
      location.hash = `#/c/${c.id}`;
    } catch (e) {
      setError(e instanceof SyntaxError ? "That file isn't valid JSON, so it can't be a campaign." : e instanceof CampaignImportError ? e.message : "That campaign file couldn't be read.");
    }
  }
  async function create() {
    const c: StudioCampaign = { ...createCampaign({ id: newId(), name: name.trim(), room: randomSecret(), key: randomSecret() }), relays: relaysFromAddress() };
    await saveCampaign(c);
    location.hash = `#/c/${c.id}`;
  }
  return (
    <main className="screen">
      <header className="vault-head">
        <img src="./icon.svg" alt="" />
        <div>
          <h1>Mimic Box for DMs</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Host a game from this browser. Campaigns stay on this device; players join from their own sheets.
          </p>
        </div>
      </header>
      {error && <p className="notice">{error}</p>}
      <section className="section panel">
        <h2>New campaign</h2>
        <form
          className="row"
          style={{ marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void create();
          }}
        >
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            <span>Campaign name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="The Sunken Bell" maxLength={80} />
          </label>
          <button className="btn btn-primary" style={{ alignSelf: "end" }} disabled={!name.trim()}>
            Create campaign
          </button>
        </form>
      </section>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => fileInput.current?.click()}>
          Import a campaign
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".mimicbox-campaign,.json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = "";
          }}
        />
      </div>
      {campaigns && campaigns.length > 0 && (
        <section className="section">
          <h2>Your campaigns</h2>
          <ul className="rows">
            {campaigns.map((c) => (
              <li key={c.id} className="resource spread">
                <span>
                  <strong>{c.name}</strong>
                  <br />
                  <span className="muted small">
                    {Object.keys(c.members).length} player{Object.keys(c.members).length === 1 ? "" : "s"}
                  </span>
                </span>
                <a className="btn" href={`#/c/${c.id}`}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted small" style={{ marginTop: 24 }}>
        Players use the <a href="./">Mimic Box sheet</a>. Nothing here needs an account, and no server stores your game.
      </p>
    </main>
  );
}

function CampaignLoader({ id }: { id: string }) {
  const [c, setC] = useState<StudioCampaign | null | undefined>(undefined);
  useEffect(() => {
    getCampaign(id).then((x) => setC(x ?? null), () => setC(null));
  }, [id]);
  if (c === undefined) return <main className="screen muted">Opening the campaign…</main>;
  if (c === null)
    return (
      <main className="screen empty">
        <h1>That campaign isn't on this device</h1>
        <a className="btn" href="#/">
          See your campaigns
        </a>
      </main>
    );
  return <CampaignScreen initial={c} />;
}

function CampaignScreen({ initial }: { initial: StudioCampaign }) {
  const host = useHost(initial);
  const { campaign, update } = host;
  const members = Object.values(campaign.members).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const here = members.filter((m) => host.connected.includes(m.userId)).length;
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importProblems] = useState(() => sessionStorage.getItem(`import-problems:${initial.id}`));
  const [imported] = useState(() => sessionStorage.getItem(`imported:${initial.id}`) === "1");
  // Prepare and Play (docs/design.md): prep tools never crowd the play screen. Both are remembered per campaign.
  const [mode, setMode] = useStoredChoice<Mode>(`studio-mode:${initial.id}`, MODES, "prepare");
  const [prep, setPrep] = useStoredChoice<PrepTab>(`studio-prep:${initial.id}`, PREP_TABS, members.length ? "world" : "players");
  const wide = useWideTable();
  const [panel, setPanel] = usePanelLayout(`mimicbox:play-layout:${initial.id}`, ["play"] as const, { open: true, width: 440, tab: "play" });
  const activeMap = (campaign.maps ?? []).find((m) => m.id === campaign.activeMapId) ?? null;
  const [openSession, setOpenSession] = useState<string | null>(null);
  const sessionPlay = (
    <SessionPlay
      campaign={campaign}
      update={update}
      onRecap={(id) => {
        setOpenSession(id);
        setMode("prepare");
        setPrep("sessions");
      }}
    />
  );
  const status =
    host.status === "hosting"
      ? members.length
        ? `${here} of ${members.length} player${members.length === 1 ? "" : "s"} here`
        : "Invite players"
      : host.status === "starting"
        ? "Starting to host…"
        : host.status === "offline"
          ? "Offline"
          : "Can't reach the network";
  const combatPanel = (
    <CombatPanel
      combat={campaign.combat ?? null}
      canStart={members.some((m) => m.character)}
      onStart={() => update((c) => ({ ...c, ...startCombat(c, newId) }))}
      onEnd={() => update((c) => ({ ...c, ...endCombat(c) }))}
      onNext={() => update((c) => ({ ...c, ...nextTurn(c) }))}
      onPrevious={() => update((c) => ({ ...c, ...previousTurn(c) }))}
      canPlace={Boolean(campaign.activeMapId)}
      onAdd={(list, place) =>
        update((c) => {
          let next = c;
          list.forEach((x, i) => {
            if (place && next.activeMapId) {
              const map = (next.maps ?? []).find((m) => m.id === next.activeMapId)!;
              // Several at once stand side by side from the middle of the map, five to a row.
              const cx = Math.min(columns(map) - 1, Math.floor(columns(map) / 2) + (i % 5));
              const cy = Math.min(rows(map) - 1, Math.floor(rows(map) / 2) + Math.floor(i / 5));
              const tokenId = newId();
              next = { ...next, ...saveToken(next, map.id, { id: tokenId, name: x.name, x: cx, y: cy, memberId: null, hidden: x.hidden, color: "#D9476B" }) };
              next = { ...next, ...addCombatant(next, { ...x, tokenId }) };
            } else next = { ...next, ...addCombatant(next, x) };
          });
          return next;
        })
      }
      onRoll={(r) => update((c) => ({ ...c, ...addDmRoll(c, r, newId) }))}
      onChange={(id, patch) => update((c) => ({ ...c, ...updateCombatant(c, id, patch) }))}
      onRemove={(id) => update((c) => ({ ...c, ...removeCombatant(c, id) }))}
    />
  );
  const partySection = (
    <section className="section">
      <h2>Party</h2>
      {members.length === 0 && <p className="muted">No one has joined yet. Send your players the invite link.</p>}
      {members.map((m) => (
        <MemberCard
          key={m.userId}
          member={m}
          here={host.connected.includes(m.userId)}
          onEffect={(e) => host.sendEffect(m.userId, e)}
          onRemove={() => update((c) => ({ ...c, ...removeMember(c, m.userId) }))}
        />
      ))}
    </section>
  );
  const revealHandout = (id: string, revealed: boolean) => update((c) => ({ ...c, ...setHandoutRevealed(c, id, revealed) }));
  const dice = (
    <>
      <DmDice onRoll={(r) => update((c) => ({ ...c, ...addDmRoll(c, r, newId) }))} />
      <RollLog rolls={campaign.rolls} />
    </>
  );
  const inviteSection = (
    <section className="section panel">
      <h2>Invite players</h2>
      {host.inviteUrl ? (
        <>
          <p className="muted small" style={{ marginTop: 4 }}>
            Players open this link on their phone or computer and choose a character. Anyone with the link can join, so share it only with your group.
          </p>
          <div className="invite">
            <QrCode text={host.inviteUrl} label="QR code of the invite link" />
            <div className="stack" style={{ minWidth: 0, flex: 1 }}>
              <input className="input" readOnly value={host.inviteUrl} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
              <div className="row">
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    navigator.clipboard?.writeText(host.inviteUrl!).then(
                      () => setCopied(true),
                      () => setCopied(false),
                    )
                  }
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setCopied(false);
                    update((c) => ({ ...c, ...replaceInvite(c, randomSecret(), randomSecret()) }));
                  }}
                >
                  Replace link
                </button>
              </div>
              <p className="muted small">Replacing the link stops the old one working. Players already in the party need the new link too.</p>
            </div>
          </div>
        </>
      ) : (
        <p className="muted">{host.status === "offline" ? "The invite link appears when this computer is back online." : "Preparing the invite link…"}</p>
      )}
      <LanInvite start={host.startLanPlayer} connected={host.connected} />
    </section>
  );

  return (
    <div className={`studio ${mode}`}>
      <header className="studio-bar">
        <a className="btn btn-quiet table-bar-btn" href="#/" aria-label="Back to your campaigns">
          <BackIcon width={22} height={22} />
        </a>
        <h1 className="studio-name">{campaign.name}</h1>
        <div role="group" aria-label="Mode" className="mode-switch">
          {MODES.map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "prepare" ? "Prepare" : "Play"}
            </button>
          ))}
        </div>
        <span className="table-bar-gap" />
        <button
          className={`chip studio-players ${host.status}`}
          onClick={() => {
            setMode("prepare");
            setPrep("players");
          }}
          title="Invite players"
        >
          {status}
        </button>
        {mode === "play" && wide && <PanelToggle open={panel.open} onToggle={() => setPanel((l) => ({ ...l, open: !l.open }))} />}
        <button className="btn table-bar-btn" onClick={() => window.open(`display.html#${campaign.id}`, `mimicbox-display-${campaign.id}`)}>
          Open table display
        </button>
      </header>
      {host.status === "offline" && <p className="notice studio-notice">You're offline. Keep preparing: everything saves on this computer. Players on this Wi-Fi can join with Add a player without internet.</p>}
      {host.status === "error" && <p className="notice studio-notice">Couldn't reach the signalling networks. Check this device is online, then reload the page.</p>}
      {importProblems && <p className="notice studio-notice">{importProblems}</p>}
      {imported && <p className="notice notice-todo studio-notice">Imported. Send your players the new invite link (under Players): links from before the import don't work.</p>}

      {mode === "prepare" ? (
        <div className="studio-prepare">
          <nav className="prep-tabs" aria-label="Prepare">
            {PREP_TABS.map((t) => (
              <button key={t} className="chip" aria-current={prep === t ? "page" : undefined} aria-pressed={prep === t} onClick={() => setPrep(t)}>
                {PREP_NAMES[t]}
              </button>
            ))}
          </nav>
          <main className="prep-body">
            {prep === "world" && <WorldPanel campaign={campaign} update={update} />}
            {prep === "maps" && <MapsPanel campaign={campaign} update={update} onTilesChanged={host.forgetTiles} />}
            {prep === "encounters" && <EncountersPanel campaign={campaign} update={update} />}
            {prep === "handouts" && (
              <Handouts
                handouts={campaign.handouts ?? []}
                onSave={(h) => {
                  const old = campaign.handouts?.find((x) => x.id === h.id)?.imageId;
                  update((c) => ({ ...c, ...saveHandout(c, h) }));
                  if (old && old !== h.imageId) void deleteImage(old);
                }}
                onReveal={revealHandout}
                onRemove={(id) => {
                  const old = campaign.handouts?.find((x) => x.id === id)?.imageId;
                  update((c) => ({ ...c, ...removeHandout(c, id) }));
                  if (old) void deleteImage(old);
                }}
              />
            )}
            {prep === "scenes" && <ScenesPanel campaign={campaign} update={update} />}
            {prep === "sessions" && <SessionsPanel campaign={campaign} update={update} open={openSession} onOpen={setOpenSession} />}
            {prep === "players" && (
              <>
                {inviteSection}
                {partySection}
              </>
            )}
            {prep === "campaign" && (
              <>
                <section className="section">
                  <h2>Backup</h2>
                  <p className="muted small" style={{ marginTop: 4 }}>
                    Your campaign lives only in this browser. Download a backup now and then, or to move to another computer. The file includes your players' characters, so keep it private.
                  </p>
                  <button
                    className="btn"
                    onClick={async () => {
                      const tiles: Record<string, Record<string, string>> = {};
                      for (const m of campaign.maps ?? []) tiles[m.id] = Object.fromEntries(await loadTiles(m.id));
                      const images: Record<string, string> = {};
                      for (const id of campaignImageIds(campaign)) {
                        const data = await loadImage(id);
                        if (data) images[id] = data;
                      }
                      downloadJson(exportCampaign(campaign, tiles, images), `${fileSafe(campaign.name, "campaign")}.mimicbox-campaign`);
                    }}
                  >
                    Download a backup
                  </button>
                </section>
                <section className="section">
                  {confirmDelete ? (
                    <div className="row">
                      <button
                        className="btn btn-danger"
                        onClick={async () => {
                          await deleteCampaign(campaign.id);
                          location.hash = "#/";
                        }}
                      >
                        Delete {campaign.name} from this device
                      </button>
                      <button className="btn" onClick={() => setConfirmDelete(false)}>
                        Keep it
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn-quiet" onClick={() => setConfirmDelete(true)}>
                      Delete campaign
                    </button>
                  )}
                </section>
              </>
            )}
          </main>
        </div>
      ) : (
        <div className={`studio-play ${wide ? "wide" : ""}`}>
          <main className="play-map">
            {activeMap ? (
              <MapEditor key={activeMap.id} campaign={campaign} map={activeMap} update={update} onDeleted={() => undefined} play />
            ) : (
              <NoMapInPlay campaign={campaign} onShow={(id) => update((c) => ({ ...c, ...setActiveMap(c, id) }))} onPrepare={() => {
                setMode("prepare");
                setPrep("maps");
              }} />
            )}
          </main>
          {(wide ? panel.open : true) &&
            (wide ? (
              <SidePanel width={panel.width} onWidth={(width) => setPanel((l) => ({ ...l, width }))} label="Play panel">
                {sessionPlay}
                <ScenePlay campaign={campaign} update={update} />
                {combatPanel}
                <RunEncounters campaign={campaign} update={update} />
                <ReadyToReveal handouts={campaign.handouts ?? []} onReveal={revealHandout} />
                {partySection}
                {dice}
              </SidePanel>
            ) : (
              <aside className="play-below" aria-label="Play panel">
                {sessionPlay}
                <ScenePlay campaign={campaign} update={update} />
                {combatPanel}
                <RunEncounters campaign={campaign} update={update} />
                <ReadyToReveal handouts={campaign.handouts ?? []} onReveal={revealHandout} />
                {partySection}
                {dice}
              </aside>
            ))}
        </div>
      )}
    </div>
  );
}

const MODES = ["prepare", "play"] as const;
type Mode = (typeof MODES)[number];
const PREP_TABS = ["world", "maps", "encounters", "handouts", "scenes", "sessions", "players", "campaign"] as const;
type PrepTab = (typeof PREP_TABS)[number];
const PREP_NAMES: Record<PrepTab, string> = { world: "World", maps: "Maps", encounters: "Encounters", handouts: "Handouts", scenes: "Scenes", sessions: "Sessions", players: "Players", campaign: "Campaign" };

/** A choice remembered on this device, such as the studio's mode. */
function useStoredChoice<T extends string>(key: string, options: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key) as T | null;
      return v && options.includes(v) ? v : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Not remembered in private browsing. */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/** Play mode with no map shown: pick one of the prepared maps, or go and prepare one. */
function NoMapInPlay({ campaign, onShow, onPrepare }: { campaign: StudioCampaign; onShow: (id: string) => void; onPrepare: () => void }) {
  const maps = campaign.maps ?? [];
  return (
    <div className="play-empty">
      <h2>No map on the table</h2>
      {maps.length ? (
        <>
          <p className="muted">Show one of your maps to the players:</p>
          <div className="row" style={{ justifyContent: "center" }}>
            {maps.map((m) => (
              <button key={m.id} className="btn" onClick={() => onShow(m.id)}>
                Show {m.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="muted">You haven't added a map yet.</p>
      )}
      <button className="btn btn-quiet" onClick={onPrepare}>
        Prepare a map
      </button>
    </div>
  );
}

/** Handouts one tap from the table: show or hide each without leaving Play. */
function ReadyToReveal({ handouts, onReveal }: { handouts: Handout[]; onReveal: (id: string, revealed: boolean) => void }) {
  return (
    <section className="section" aria-label="Ready to reveal">
      <h2>Handouts</h2>
      {handouts.length === 0 && <p className="muted small">Write handouts in Prepare; they wait here to be shown.</p>}
      <ul className="rows">
        {handouts.map((h) => (
          <li key={h.id} className="resource spread">
            <span>
              {h.title}
              <br />
              <span className="muted small">{h.revealed ? "Shown to the party" : "Only you"}</span>
            </span>
            <button className={h.revealed ? "btn btn-quiet" : "btn"} aria-label={`${h.revealed ? "Hide" : "Show"} ${h.title}`} onClick={() => onReveal(h.id, !h.revealed)}>
              {h.revealed ? "Hide" : "Show"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type LanStep =
  | { at: "idle" }
  | { at: "making" }
  | { at: "code"; code: string; accept: (reply: string) => Promise<{ player: string }>; cancel: () => void; scanning: boolean; reply: string; busy: boolean }
  | { at: "connecting"; player: string };

/** Adding a player on this network without internet: show a code, then read the player's reply (ADR 0006). */
function LanInvite({
  start,
  connected,
}: {
  start: () => Promise<{ code: string; accept: (reply: string) => Promise<{ player: string }>; cancel: () => void }>;
  connected: string[];
}) {
  const [step, setStep] = useState<LanStep>({ at: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelRef.current?.(), []);
  useEffect(() => {
    if (step.at === "connecting" && connected.includes(step.player)) setStep({ at: "idle" });
  }, [step, connected]);
  const finish = async (reply: string) => {
    if (step.at !== "code" || step.busy) return;
    setError(null);
    setStep({ ...step, busy: true, scanning: false });
    try {
      const { player } = await step.accept(reply);
      cancelRef.current = null;
      setStep({ at: "connecting", player });
    } catch (e) {
      setError((e as Error).message);
      setStep({ ...step, busy: false, scanning: false });
    }
  };
  if (step.at === "idle" || step.at === "making") {
    return (
      <div className="stack" style={{ marginTop: 16 }}>
        <h3>No internet?</h3>
        <p className="muted small">Players on the same Wi-Fi as this computer can join without internet. You scan each other's codes; their phone needs to have opened Mimic Box once before.</p>
        <button
          className="btn"
          disabled={step.at === "making"}
          onClick={async () => {
            setError(null);
            setCopied(false);
            setStep({ at: "making" });
            try {
              const s = await start();
              cancelRef.current = s.cancel;
              setStep({ at: "code", ...s, scanning: false, reply: "", busy: false });
            } catch (e) {
              setStep({ at: "idle" });
              setError(e instanceof LanCodeError ? e.message : "This browser couldn't make a code. Try again, or use the invite link instead.");
            }
          }}
        >
          {step.at === "making" ? "Making a code…" : "Add a player without internet"}
        </button>
        {error && <p className="error small">{error}</p>}
      </div>
    );
  }
  if (step.at === "connecting") {
    return (
      <div className="stack" style={{ marginTop: 16 }}>
        <h3>No internet?</h3>
        <p className="muted small" role="status">
          Connecting to the player… If nothing happens within a minute, check you're both on the same Wi-Fi and start again.
        </p>
        <button className="btn" onClick={() => setStep({ at: "idle" })}>
          Start again
        </button>
      </div>
    );
  }
  return (
    <div className="stack" style={{ marginTop: 16 }} aria-label="Add a player without internet" role="group">
      <p className="muted small">Adding a player on this Wi-Fi without internet. One code per player.</p>
      <h3>1. The player scans this</h3>
      <p className="muted small">On their phone: Join a game, then Join on the DM's network.</p>
      <QrCode text={step.code} label="QR code for the player" level="L" />
      <div className="row">
        <input className="input" readOnly value={step.code} aria-label="Code for the player" onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 0 }} />
        <button
          className="btn"
          onClick={() =>
            navigator.clipboard?.writeText(step.code).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <h3>2. Scan their reply</h3>
      {step.scanning ? (
        <QrScanner
          accept={(text) => {
            if (!text.includes("MB-LAN1.")) return false;
            void finish(text);
            return true;
          }}
          onClose={() => setStep({ ...step, scanning: false })}
        />
      ) : (
        <button className="btn btn-primary" disabled={step.busy} onClick={() => setStep({ ...step, scanning: true })}>
          Scan their reply
        </button>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void finish(step.reply);
        }}
      >
        <input className="input" style={{ flex: 1, minWidth: 0 }} value={step.reply} onChange={(e) => setStep({ ...step, reply: e.target.value })} aria-label="Player's reply" placeholder="Or paste their reply code" />
        <button className="btn" disabled={!step.reply.trim() || step.busy}>
          Connect
        </button>
      </form>
      {error && <p className="error small">{error}</p>}
      <button
        className="btn btn-quiet"
        onClick={() => {
          step.cancel();
          cancelRef.current = null;
          setStep({ at: "idle" });
          setError(null);
        }}
      >
        Cancel
      </button>
    </div>
  );
}

function MemberCard({ member, here, onEffect, onRemove }: { member: Member; here: boolean; onEffect: (e: Effect) => boolean; onRemove: () => void }) {
  const [amount, setAmount] = useState("");
  const n = Number.parseInt(amount, 10);
  const valid = Number.isInteger(n) && n > 0 && n <= 999;
  const send = (e: Effect) => {
    if (onEffect(e)) setAmount("");
  };
  const sheet = useMemo(() => (member.character ? derive(member.character, content) : null), [member.character]);
  const [confirm, setConfirm] = useState(false);
  const c = member.character;
  const hpPct = sheet ? Math.max(0, Math.min(100, (sheet.hp.current / sheet.hp.max.value) * 100)) : 0;
  return (
    <article className="panel member" aria-label={c?.name ?? member.playerName}>
      <div className="spread">
        <span>
          <strong className="member-name">{c?.name ?? member.playerName}</strong>
          <br />
          <span className="muted small">{sheet ? `${sheet.classSummary}, ${sheet.speciesName}. Played by ${member.playerName}` : `${member.playerName} hasn't shared a character yet`}</span>
        </span>
        <span className={here ? "presence here" : "presence"}>{here ? "Here" : "Away"}</span>
      </div>
      {sheet && c && (
        <>
          <div className="member-vitals">
            <div>
              <span className="label">HP</span>
              <span className="value">
                {sheet.hp.current}
                <small> / {sheet.hp.max.value}</small>
                {sheet.hp.temp ? <small> +{sheet.hp.temp}</small> : null}
              </span>
              <div className="hp-bar">
                <span style={{ width: `${hpPct}%` }} />
              </div>
            </div>
            <div>
              <span className="label">AC</span>
              <span className="value">{sheet.ac.value}</span>
            </div>
            <div>
              <span className="label">Passive Perception</span>
              <span className="value">{sheet.passive.perception}</span>
            </div>
            {sheet.spellcasting && (
              <div>
                <span className="label">Spell save DC</span>
                <span className="value">{sheet.spellcasting.saveDc.value}</span>
              </div>
            )}
          </div>
          {(c.state.conditions.length > 0 || c.state.exhaustion > 0) && (
            <p className="small" style={{ margin: "8px 0 0" }}>
              {[...c.state.conditions, ...(c.state.exhaustion ? [`Exhaustion ${c.state.exhaustion}`] : [])].join(", ")}
            </p>
          )}
          {here ? (
            <div className="row dm-effects" style={{ marginTop: 10 }} role="group" aria-label={`Change ${c.name}'s hit points`}>
              <input
                className="input init-input"
                inputMode="numeric"
                aria-label={`Amount for ${c.name}`}
                value={amount}
                placeholder="0"
                onChange={(e) => setAmount(e.target.value)}
              />
              <button className="btn" disabled={!valid} onClick={() => send({ kind: "damage", amount: n })}>
                Damage
              </button>
              <button className="btn" disabled={!valid} onClick={() => send({ kind: "heal", amount: n })}>
                Heal
              </button>
              <button className="btn btn-quiet" disabled={!valid} onClick={() => send({ kind: "temp", amount: n })}>
                Temporary HP
              </button>
            </div>
          ) : (
            <p className="muted small" style={{ margin: "8px 0 0" }}>
              Away: damage and conditions can be sent once {member.playerName} is back.
            </p>
          )}
          {here && (
            <details className="small" style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer" }}>Conditions</summary>
              <div className="row" style={{ marginTop: 8 }} role="group" aria-label={`${c.name}'s conditions`}>
                {CONDITIONS.map((cond) => (
                  <button key={cond} className="chip" aria-pressed={c.state.conditions.includes(cond)} onClick={() => send({ kind: "condition", condition: cond, on: !c.state.conditions.includes(cond) })}>
                    {cond}
                  </button>
                ))}
              </div>
            </details>
          )}
          <details className="small" style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer" }}>Saves and skills</summary>
            <p style={{ margin: "6px 0" }}>
              {ABILITIES.map((a) => `${ABILITY_NAMES[a].slice(0, 3)} ${formatModifier(sheet.abilities[a].save.value)}`).join(", ")}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              {SKILL_IDS.filter((s) => sheet.skills[s].proficiency === "proficient" || sheet.skills[s].proficiency === "expertise")
                .map((s) => `${SKILLS[s].name} ${formatModifier(sheet.skills[s].total.value)}`)
                .join(", ") || "No skill proficiencies"}
            </p>
          </details>
        </>
      )}
      <div style={{ marginTop: 8 }}>
        {confirm ? (
          <span className="row">
            <button className="btn btn-danger" onClick={onRemove}>
              Remove {member.playerName}
            </button>
            <button className="btn" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="btn btn-quiet small" onClick={() => setConfirm(true)}>
            Remove from party
          </button>
        )}
      </div>
    </article>
  );
}

function DmDice({ onRoll }: { onRoll: (r: Omit<SharedRoll, "id" | "at">) => void }) {
  const [label, setLabel] = useState("");
  const [expression, setExpression] = useState("1d20");
  let problem: string | null = null;
  try {
    parseDice(expression);
  } catch (e) {
    problem = e instanceof DiceSyntaxError ? e.message : "That isn't a dice roll.";
  }
  const go = (visibility: "public" | "dm") => {
    const result = rollDice(expression);
    const flag = result.naturalD20 === 20 ? "crit" : result.naturalD20 === 1 ? "fumble" : undefined;
    onRoll({ by: "DM", characterName: "DM", label: label.trim() || expression, expression, total: result.total, breakdown: describeRoll(result), visibility, ...(flag ? { flag } : {}) });
  };
  return (
    <section className="section panel">
      <h2>Roll</h2>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="field" style={{ flex: 2, minWidth: 140 }}>
          <span>For</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Goblin attack" />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 100 }}>
          <span>Dice</span>
          <input className="input" value={expression} onChange={(e) => setExpression(e.target.value)} />
        </label>
      </div>
      {problem && <p className="notice small">{problem}</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn btn-primary" disabled={Boolean(problem)} onClick={() => go("public")}>
          Roll for the table
        </button>
        <button className="btn" disabled={Boolean(problem)} onClick={() => go("dm")}>
          Roll in secret
        </button>
      </div>
      <p className="muted small">Secret rolls stay on this device. Players and the table display never receive them.</p>
    </section>
  );
}

function RollLog({ rolls }: { rolls: SharedRoll[] }) {
  return (
    <section className="section">
      <h2>Rolls</h2>
      {rolls.length === 0 && <p className="muted">Rolls your players make on their sheets appear here.</p>}
      <ul className="history" aria-label="Rolls">
        {[...rolls].reverse().map((r) => (
          <li key={r.id}>
            <span className={`t ${r.flag ?? ""}`}>{r.total}</span>
            <span className="grow">
              {r.characterName === "DM" ? "DM" : `${r.characterName} (${r.by})`}: {r.label}
              {r.visibility === "dm" && <span className="chip" style={{ marginLeft: 6, padding: "0 8px" }}>Only you</span>}
              <br />
              <span className="breakdown small">{r.breakdown}</span>
            </span>
            <span className="muted small">{new Date(r.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Handouts({
  handouts,
  onSave,
  onReveal,
  onRemove,
}: {
  handouts: Handout[];
  onSave: (h: Pick<Handout, "id" | "title" | "body" | "imageId">) => void;
  onReveal: (id: string, revealed: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; title: string; body: string; imageId: string | null } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [picture, setPicture] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const pictureInput = useRef<HTMLInputElement>(null);
  // Pictures added in the editor and not yet saved; dropped if the edit is cancelled.
  const unsaved = useRef(new Set<string>());
  const cancel = () => {
    for (const id of unsaved.current) void deleteImage(id);
    unsaved.current.clear();
    setEditing(null);
    setPicture({ busy: false, error: null });
  };
  return (
    <section className="section">
      <h2>Handouts</h2>
      <p className="muted small" style={{ marginTop: 4 }}>
        Letters, clues and notes. Each one stays on this device until you show it; then the party and the table display get it.
      </p>
      {handouts.map((h) =>
        editing?.id === h.id ? null : (
          <article key={h.id} className="panel handout-card" aria-label={h.title}>
            <div className="spread">
              <strong className="member-name">{h.title}</strong>
              <span className={h.revealed ? "presence here" : "presence"}>{h.revealed ? "Shown to the party" : "Only you"}</span>
            </div>
            <details className="small" style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer" }}>Read</summary>
              {h.imageId && <StoredImage id={h.imageId} alt={h.title} />}
              <Markdown text={h.body} />
            </details>
            <div className="row" style={{ marginTop: 8 }}>
              <button className={h.revealed ? "btn" : "btn btn-primary"} onClick={() => onReveal(h.id, !h.revealed)}>
                {h.revealed ? "Hide again" : "Show to the party"}
              </button>
              <button className="btn btn-quiet" onClick={() => setEditing({ id: h.id, title: h.title, body: h.body, imageId: h.imageId ?? null })}>
                Edit
              </button>
              {confirm === h.id ? (
                <button className="btn btn-danger" onClick={() => onRemove(h.id)}>
                  Delete {h.title}
                </button>
              ) : (
                <button className="btn btn-quiet" onClick={() => setConfirm(h.id)}>
                  Delete
                </button>
              )}
            </div>
          </article>
        ),
      )}
      {editing ? (
        <form
          className="panel stack handout-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editing.title.trim() || picture.busy) return;
            onSave({ id: editing.id, title: editing.title.trim(), body: editing.body, imageId: editing.imageId });
            for (const id of unsaved.current) if (id !== editing.imageId) void deleteImage(id);
            unsaved.current.clear();
            setEditing(null);
          }}
        >
          <label className="field">
            <span>Title</span>
            <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={120} placeholder="The ferryman's letter" />
          </label>
          <label className="field">
            <span>Text</span>
            <textarea
              className="input"
              style={{ minHeight: 160 }}
              value={editing.body}
              maxLength={HANDOUT_MAX_LENGTH}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              placeholder="Use **bold** and *italic*. A blank line starts a new paragraph."
            />
          </label>
          <div className="field">
            <span>Picture</span>
            {editing.imageId && <StoredImage id={editing.imageId} alt={`Picture for ${editing.title || "this handout"}`} />}
            <div className="row">
              <button type="button" className="btn" disabled={picture.busy} onClick={() => pictureInput.current?.click()}>
                {picture.busy ? "Adding the picture…" : editing.imageId ? "Replace picture" : "Add a picture"}
              </button>
              {editing.imageId && (
                <button type="button" className="btn btn-quiet" onClick={() => setEditing({ ...editing, imageId: null })}>
                  Remove picture
                </button>
              )}
            </div>
            <input
              ref={pictureInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Handout picture"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setPicture({ busy: true, error: null });
                try {
                  const id = newId();
                  await saveImage(id, await scaleHandoutImage(file));
                  unsaved.current.add(id);
                  setEditing((cur) => (cur ? { ...cur, imageId: id } : cur));
                  setPicture({ busy: false, error: null });
                } catch (err) {
                  setPicture({ busy: false, error: (err as Error).message });
                }
              }}
            />
            {picture.error && <p className="error small">{picture.error}</p>}
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={!editing.title.trim() || picture.busy}>
              Save handout
            </button>
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
          </div>
          <p className="muted small">Saving doesn't show it to anyone. Use Show to the party when you're ready.</p>
        </form>
      ) : (
        <button className="btn" style={{ marginTop: 10 }} onClick={() => setEditing({ id: newId(), title: "", body: "", imageId: null })}>
          Write a handout
        </button>
      )}
    </section>
  );
}

function CombatPanel({
  combat,
  canStart,
  canPlace,
  onStart,
  onEnd,
  onNext,
  onPrevious,
  onAdd,
  onChange,
  onRemove,
  onRoll,
}: {
  combat: Combat | null;
  canStart: boolean;
  canPlace: boolean;
  onStart: () => void;
  onEnd: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onAdd: (list: NewCombatant[], placeOnMap: boolean) => void;
  onChange: (id: string, patch: { initiative?: number | null; hidden?: boolean; hp?: { current: number; max: number } | null }) => void;
  onRemove: (id: string) => void;
  onRoll: (r: Omit<SharedRoll, "id" | "at">) => void;
}) {
  const [statFor, setStatFor] = useState<string | null>(null);
  const monsters = useMonsters(Boolean(statFor));
  const [name, setName] = useState("");
  const [mod, setMod] = useState("0");
  const [hp, setHp] = useState("");
  const [hidden, setHidden] = useState(false);
  const [place, setPlace] = useState(true);
  const [confirmEnd, setConfirmEnd] = useState(false);
  if (!combat) {
    return (
      <section className="section panel">
        <h2>Combat</h2>
        <p className="muted small" style={{ marginTop: 4 }}>
          Starting combat adds every player's character and asks them to roll initiative on their sheet.
        </p>
        <button className="btn btn-primary" disabled={!canStart} onClick={onStart}>
          Start combat
        </button>
        {!canStart && <p className="muted small">Players join and share a character first.</p>}
      </section>
    );
  }
  const order = initiativeOrder(combat.combatants);
  const modifier = Number.parseInt(mod, 10);
  const maxHp = Number.parseInt(hp, 10);
  return (
    <section className="section panel" aria-label="Combat">
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2>Combat, round {combat.round}</h2>
        <span className="row">
          <button className="btn" onClick={onPrevious} disabled={combat.turnId === null}>
            Previous
          </button>
          <button className="btn btn-primary" onClick={onNext} disabled={order.length === 0}>
            {combat.turnId === null ? "First turn" : "Next turn"}
          </button>
        </span>
      </div>
      <ol className="initiative dm-initiative" aria-label="Initiative order">
        {order.map((c) => (
          <li key={c.id} aria-current={c.id === combat.turnId ? "true" : undefined}>
            <input
              className="input init-input"
              inputMode="numeric"
              aria-label={`${c.name} initiative`}
              value={c.initiative ?? ""}
              placeholder="–"
              onChange={(e) => {
                const v = e.target.value.trim();
                const n = Number.parseInt(v, 10);
                onChange(c.id, { initiative: v === "" || Number.isNaN(n) ? null : n });
              }}
            />
            <span className="grow">
              {c.monsterId ? (
                <button className="wiki-link" aria-label={`Stat block for ${c.name}`} title="Open the stat block" onClick={() => setStatFor(c.id)}>
                  {c.name}
                </button>
              ) : (
                c.name
              )}
              <br />
              <span className="muted small">
                {c.memberId ? (c.initiative === null ? "Player, waiting for their roll" : "Player") : c.hidden ? "Hidden from players" : "Creature"}
                {c.ac ? `, AC ${c.ac}` : ""}
              </span>
            </span>
            {(c.hp || !c.memberId) && (
            <span className="combat-controls">
            {c.hp && (
              <span className="row" style={{ gap: 4, alignItems: "center", flexWrap: "nowrap" }}>
                <button className="btn btn-quiet" aria-label={`${c.name} loses 1 HP`} onClick={() => onChange(c.id, { hp: { ...c.hp!, current: Math.max(0, c.hp!.current - 1) } })}>
                  −
                </button>
                <input
                  className="input init-input"
                  inputMode="numeric"
                  aria-label={`${c.name} hit points`}
                  value={c.hp.current}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (!Number.isNaN(n)) onChange(c.id, { hp: { ...c.hp!, current: Math.max(0, n) } });
                  }}
                />
                <span className="muted small">/ {c.hp.max}</span>
              </span>
            )}
            {!c.memberId && (
              <span className="combat-actions">
                <button className="btn btn-quiet small" onClick={() => onChange(c.id, { hidden: !c.hidden })}>
                  {c.hidden ? "Reveal" : "Hide"}
                </button>
                <button className="btn btn-quiet small" aria-label={`Remove ${c.name}`} onClick={() => onRemove(c.id)}>
                  Remove
                </button>
              </span>
            )}
            </span>
            )}
          </li>
        ))}
      </ol>
      <BestiaryAdd existing={combat.combatants.map((c) => c.name)} canPlace={canPlace} onAdd={onAdd} />
      {statFor &&
        (() => {
          const who = combat.combatants.find((c) => c.id === statFor);
          const monster = Array.isArray(monsters) ? monsters.find((m) => m.id === who?.monsterId) : undefined;
          return (
            <Drawer title={who?.name ?? "Stat block"} onClose={() => setStatFor(null)}>
              {!who ? <p className="muted">That creature has left the fight.</p> : monsters === "unavailable" ? <p className="notice">The stat block isn't on this computer yet. Open the studio once while online and the bestiary is kept for play without internet.</p> : !monster ? <p className="muted">Loading the stat block…</p> : <StatBlock monster={monster} who={who.name} hp={who.hp} onRoll={onRoll} />}
            </Drawer>
          );
        })()}
      <form
        className="row"
        style={{ marginTop: 12, alignItems: "end" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || Number.isNaN(modifier)) return;
          const roll = rollDice(`1d20${modifier >= 0 ? "+" : ""}${modifier}`).total;
          onAdd([{ id: newId(), name: name.trim(), initiative: roll, hidden, hp: maxHp > 0 ? { current: maxHp, max: maxHp } : null }], canPlace && place);
          setName("");
          setHp("");
        }}
      >
        <label className="field" style={{ flex: 2, minWidth: 140 }}>
          <span>Creature</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ogre" maxLength={60} />
        </label>
        <label className="field" style={{ width: 90 }}>
          <span>Init bonus</span>
          <input className="input" inputMode="numeric" value={mod} onChange={(e) => setMod(e.target.value)} />
        </label>
        <label className="field" style={{ width: 90 }}>
          <span>HP</span>
          <input className="input" inputMode="numeric" value={hp} onChange={(e) => setHp(e.target.value)} />
        </label>
        <label className="row" style={{ alignItems: "center", gap: 6, minHeight: 44 }}>
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          <span>Hidden</span>
        </label>
        {canPlace && (
          <label className="row" style={{ alignItems: "center", gap: 6, minHeight: 44 }}>
            <input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} />
            <span>Place on the map</span>
          </label>
        )}
        <button className="btn" disabled={!name.trim() || Number.isNaN(modifier)}>
          Add and roll
        </button>
      </form>
      <div style={{ marginTop: 12 }}>
        {confirmEnd ? (
          <span className="row">
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirmEnd(false);
                onEnd();
              }}
            >
              End combat
            </button>
            <button className="btn" onClick={() => setConfirmEnd(false)}>
              Keep fighting
            </button>
          </span>
        ) : (
          <button className="btn btn-quiet" onClick={() => setConfirmEnd(true)}>
            End combat
          </button>
        )}
      </div>
    </section>
  );
}
