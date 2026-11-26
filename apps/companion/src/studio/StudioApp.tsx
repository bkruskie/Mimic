/**
 * The DM's page: campaigns kept on this device, and hosting one so players can join from their sheets.
 */
import { DiceSyntaxError, describeRoll, formatModifier, parseDice, roll as rollDice } from "@mimicbox/dice";
import { ABILITIES, ABILITY_NAMES, SKILLS, SKILL_IDS, derive, newId, srdContent as content } from "@mimicbox/ruleset-dnd5e";
import {
  CampaignImportError,
  HANDOUT_MAX_LENGTH,
  addDmRoll,
  createCampaign,
  exportCampaign,
  importCampaign,
  randomSecret,
  removeHandout,
  removeMember,
  replaceInvite,
  saveHandout,
  setHandoutRevealed,
  type Handout,
  type Member,
  type SharedRoll,
} from "@mimicbox/table";
import { Markdown } from "../lib/markdown";
import { downloadJson, fileSafe } from "../lib/download";
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackIcon } from "../lib/icons";
import { deleteCampaign, getCampaign, listCampaigns, relaysFromAddress, saveCampaign, type StudioCampaign } from "./store";
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
      const { campaign, problems } = importCampaign(JSON.parse(await file.text()), content, { room: randomSecret(), key: randomSecret() });
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
  return (
    <>
      <header className="sheet-top">
        <div className="sheet-top-inner wide">
          <div className="sheet-title">
            <a className="btn btn-quiet" href="#/" aria-label="Back to your campaigns" style={{ padding: 6, minHeight: 40 }}>
              <BackIcon width={22} height={22} />
            </a>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>{campaign.name}</h1>
              <div className="muted small">
                {host.status === "hosting"
                  ? `Hosting. ${here} of ${members.length} player${members.length === 1 ? "" : "s"} here.`
                  : host.status === "starting"
                    ? "Starting to host…"
                    : "Couldn't reach the signalling networks. Check this device is online, then reload the page."}
              </div>
            </div>
            <button className="btn" onClick={() => window.open(`display.html#${campaign.id}`, `mimicbox-display-${campaign.id}`)}>
              Open table display
            </button>
          </div>
        </div>
      </header>
      <main className="screen wide">
        {importProblems && <p className="notice">{importProblems}</p>}
        {imported && <p className="notice notice-todo">Imported. Send your players the invite link below: links from before the import don't work.</p>}
        <div className="sheet-grid studio-grid">
          <div className="sheet-col">
            <section className="section">
              <h2>Party</h2>
              {members.length === 0 && <p className="muted">No one has joined yet. Send your players the invite link.</p>}
              {members.map((m) => (
                <MemberCard
                  key={m.userId}
                  member={m}
                  here={host.connected.includes(m.userId)}
                  onRemove={() => update((c) => ({ ...c, ...removeMember(c, m.userId) }))}
                />
              ))}
            </section>
            <Handouts
              handouts={campaign.handouts ?? []}
              onSave={(h) => update((c) => ({ ...c, ...saveHandout(c, h) }))}
              onReveal={(id, revealed) => update((c) => ({ ...c, ...setHandoutRevealed(c, id, revealed) }))}
              onRemove={(id) => update((c) => ({ ...c, ...removeHandout(c, id) }))}
            />
          </div>
          <div className="sheet-col">
            <section className="section panel">
              <h2>Invite players</h2>
              {host.inviteUrl ? (
                <>
                  <p className="muted small" style={{ marginTop: 4 }}>
                    Players open this link on their phone or computer and choose a character. Anyone with the link can join, so share it only with your group.
                  </p>
                  <div className="invite">
                    <QrCode text={host.inviteUrl} />
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
                <p className="muted">Preparing the invite link…</p>
              )}
            </section>
            <DmDice onRoll={(r) => update((c) => ({ ...c, ...addDmRoll(c, r, newId) }))} />
            <RollLog rolls={campaign.rolls} />
            <section className="section">
              <h2>Backup</h2>
              <p className="muted small" style={{ marginTop: 4 }}>
                Your campaign lives only in this browser. Download a backup now and then, or to move to another computer. The file includes your players' characters, so keep it private.
              </p>
              <button className="btn" onClick={() => downloadJson(exportCampaign(campaign), `${fileSafe(campaign.name, "campaign")}.mimicbox-campaign`)}>
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
          </div>
        </div>
      </main>
    </>
  );
}

function QrCode({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  // The SVG is generated here from the invite link, not taken from anywhere else.
  return <div className="qr" role="img" aria-label="QR code of the invite link" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function MemberCard({ member, here, onRemove }: { member: Member; here: boolean; onRemove: () => void }) {
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
  onSave: (h: Pick<Handout, "id" | "title" | "body">) => void;
  onReveal: (id: string, revealed: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; title: string; body: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
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
              <Markdown text={h.body} />
            </details>
            <div className="row" style={{ marginTop: 8 }}>
              <button className={h.revealed ? "btn" : "btn btn-primary"} onClick={() => onReveal(h.id, !h.revealed)}>
                {h.revealed ? "Hide again" : "Show to the party"}
              </button>
              <button className="btn btn-quiet" onClick={() => setEditing({ id: h.id, title: h.title, body: h.body })}>
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
            if (!editing.title.trim()) return;
            onSave({ id: editing.id, title: editing.title.trim(), body: editing.body });
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
          <div className="row">
            <button className="btn btn-primary" disabled={!editing.title.trim()}>
              Save handout
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          <p className="muted small">Saving doesn't show it to anyone. Use Show to the party when you're ready.</p>
        </form>
      ) : (
        <button className="btn" style={{ marginTop: 10 }} onClick={() => setEditing({ id: newId(), title: "", body: "" })}>
          Write a handout
        </button>
      )}
    </section>
  );
}
