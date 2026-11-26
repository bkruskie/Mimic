import { criticalNotation, d20Notation, formatModifier, parseDice, type RollMode } from "@mimicbox/dice";
import { CONDITIONS, applyDamage, heal, recordDeathSave, setExhaustion, setTempHp, toggleCondition, type Character, type DerivedSheet } from "@mimicbox/ruleset-dnd5e";
import { useEffect, useState, type ReactNode } from "react";
import { go } from "../App";
import { BackIcon, BagIcon, CloseIcon, D20Icon, ScrollIcon, SparkIcon, StarIcon, SwordIcon } from "../lib/icons";
import { content, useCharacter, useRoller, type ShownRoll } from "../lib/state";
import { useTable } from "../lib/table";
import { AbilitiesTab } from "./sheet/AbilitiesTab";
import { ActionsTab } from "./sheet/ActionsTab";
import { GearTab } from "./sheet/GearTab";
import { NotesTab } from "./sheet/NotesTab";
import { SpellsTab } from "./sheet/SpellsTab";
import { Portrait } from "./VaultScreen";

export interface RollAsk {
  label: string;
  expression: string;
  /** For d20 tests: the modifier, so the drawer can re-roll with Advantage or Disadvantage. */
  d20Modifier?: number;
  /** For attacks: the damage to roll next. */
  damage?: { label: string; expression: string };
}

export interface SheetProps {
  character: Character;
  sheet: DerivedSheet;
  update: (next: Character | ((c: Character) => Character)) => void;
  ask: (r: RollAsk) => void;
}

type Tab = "actions" | "abilities" | "spells" | "gear" | "notes";

/** How many columns the sheet gets: tabs on phones, every section side by side on tablets and desktops. */
function useColumns(): 1 | 2 | 3 {
  const query = (q: string) => typeof window !== "undefined" && window.matchMedia(q).matches;
  const measure = (): 1 | 2 | 3 => (query("(min-width: 1280px)") ? 3 : query("(min-width: 900px)") ? 2 : 1);
  const [cols, setCols] = useState(measure);
  useEffect(() => {
    const lists = ["(min-width: 1280px)", "(min-width: 900px)"].map((q) => window.matchMedia(q));
    const onChange = () => setCols(measure());
    lists.forEach((l) => l.addEventListener("change", onChange));
    return () => lists.forEach((l) => l.removeEventListener("change", onChange));
  }, []);
  return cols;
}

const TAB_LABELS: Record<Tab, string> = { actions: "Actions", abilities: "Skills", spells: "Spells", gear: "Gear", notes: "Notes" };

export function SheetScreen({ id }: { id: string }) {
  const { character, sheet, update, missing } = useCharacter(id);
  const roller = useRoller(id);
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem(`tab:${id}`) as Tab | null) ?? "actions");
  const [lastAsk, setLastAsk] = useState<RollAsk | null>(null);
  const [drawer, setDrawer] = useState<"hp" | "conditions" | "dice" | "history" | "party" | null>(null);
  const cols = useColumns();
  const table = useTable();
  const atTable = table.seat?.characterId === id;
  const shareCharacter = table.shareCharacter;

  // While at a table, the DM's copy follows every change, a moment after it is made.
  useEffect(() => {
    if (!atTable || !character) return;
    const t = window.setTimeout(() => shareCharacter(character), 600);
    return () => window.clearTimeout(t);
  }, [atTable, character, shareCharacter]);

  useEffect(() => {
    try {
      sessionStorage.setItem(`tab:${id}`, tab);
    } catch {
      /* Private browsing can refuse storage; the tab just won't be remembered. */
    }
  }, [id, tab]);

  if (missing) {
    return (
      <main className="screen empty">
        <h1>That character isn't in your vault</h1>
        <p className="muted">It may have been deleted on this device.</p>
        <button className="btn" onClick={() => go({ name: "vault" })}>
          Go to the vault
        </button>
      </main>
    );
  }
  if (!character || !sheet) return <main className="screen muted">Opening the chest…</main>;

  const ask = (r: RollAsk, mode: RollMode = "normal") => {
    const expression = r.d20Modifier !== undefined ? d20Notation(r.d20Modifier, mode) : r.expression;
    const label = mode === "normal" ? r.label : `${r.label} (${mode === "advantage" ? "Advantage" : "Disadvantage"})`;
    setLastAsk(r);
    void rollAndShare(label, expression);
  };
  async function rollAndShare(label: string, expression: string) {
    const shown = await roller.roll({ label, expression });
    if (atTable && character) {
      table.shareRoll({ characterName: character.name, label, expression, total: shown.result.total, breakdown: shown.breakdown, ...(shown.flag ? { flag: shown.flag } : {}) });
    }
  }
  const props: SheetProps = { character, sheet, update, ask: (r) => ask(r) };
  const hpPct = sheet.hp.max.value ? Math.max(0, Math.min(100, (sheet.hp.current / sheet.hp.max.value) * 100)) : 0;

  return (
    <>
      <header className="sheet-top">
        <div className={cols > 1 ? "sheet-top-inner wide" : "sheet-top-inner"}>
          <div className="sheet-title">
            <button className="btn btn-quiet" style={{ padding: "6px", minHeight: 40 }} aria-label="Back to the vault" onClick={() => go({ name: "vault" })}>
              <BackIcon width={22} height={22} />
            </button>
            <Portrait name={character.name} src={character.portrait} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>{character.name}</h1>
              <div className="muted small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {sheet.classSummary}, {sheet.speciesName}
              </div>
            </div>
          </div>
          <div className="vitals">
            <button className="vital hp-vital" onClick={() => setDrawer("hp")} aria-label={`Hit points ${sheet.hp.current} of ${sheet.hp.max.value}. Change hit points.`}>
              <span className="label">Hit points</span>
              <span className="hp-value">
                {sheet.hp.current}
                <small> / {sheet.hp.max.value}</small>
              </span>
              {sheet.hp.temp > 0 && <span className="hp-temp"> +{sheet.hp.temp} temp</span>}
              <div className={`hp-bar ${hpPct <= 25 ? "low" : ""}`}>
                <i style={{ width: `${hpPct}%` }} />
              </div>
            </button>
            <div className="vital">
              <span className="label">AC</span>
              <span className="value">{sheet.ac.value}</span>
            </div>
            <button className="vital" onClick={() => ask({ label: "Initiative", expression: "", d20Modifier: sheet.initiative.value })}>
              <span className="label">Init</span>
              <span className="value">{formatModifier(sheet.initiative.value)}</span>
            </button>
            <div className="vital">
              <span className="label">Speed</span>
              <span className="value">{sheet.speed.value}</span>
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {character.state.conditions.map((c) => (
              <button key={c} className="chip chip-condition" onClick={() => setDrawer("conditions")}>
                {c}
              </button>
            ))}
            {character.state.exhaustion > 0 && (
              <button className="chip chip-condition" onClick={() => setDrawer("conditions")}>
                Exhaustion {character.state.exhaustion}
              </button>
            )}
            {character.state.heroicInspiration && <span className="chip" aria-pressed="true">Heroic Inspiration</span>}
            {atTable && (
              <button className={`chip chip-table ${table.status}`} onClick={() => setDrawer("party")}>
                {tableStatusText(table.status, table.invite?.campaign ?? "the game")}
              </button>
            )}
            <button className="chip" onClick={() => setDrawer("conditions")}>
              {character.state.conditions.length || character.state.exhaustion ? "Edit conditions" : "Add a condition"}
            </button>
          </div>
        </div>
      </header>

      <main className={cols > 1 ? "screen wide" : "screen"} style={{ paddingTop: 8 }}>
        {sheet.pending.length > 0 && (cols > 1 || tab !== "notes") && (
          <button
            className="notice notice-todo"
            style={{ width: "100%", textAlign: "left", border: 0, marginTop: 8 }}
            onClick={() => (cols > 1 ? document.getElementById("todo")?.scrollIntoView({ behavior: "smooth", block: "start" }) : setTab("notes"))}
          >
            {sheet.pending.length === 1 ? sheet.pending[0]!.message : `${sheet.pending.length} choices are still open.`} Finish them {cols > 1 ? "under To do" : "in Notes"}.
          </button>
        )}
        {cols === 1 ? (
          <>
            {tab === "actions" && <ActionsTab {...props} />}
            {tab === "abilities" && <AbilitiesTab {...props} />}
            {tab === "spells" && <SpellsTab {...props} />}
            {tab === "gear" && <GearTab {...props} />}
            {tab === "notes" && <NotesTab {...props} onHistory={() => setDrawer("history")} />}
          </>
        ) : (
          <div className="sheet-grid">
            {(cols === 3
              ? [["abilities"], ["actions", "spells"], ["gear", "notes"]]
              : [["abilities", "gear"], ["actions", "spells", "notes"]]
            ).map((column, i) => (
              <div key={i} className="sheet-col">
                {column.map((section) => (
                  <div key={section} className="sheet-block" aria-label={TAB_LABELS[section as Tab]} role="region">
                    {section === "actions" && <ActionsTab {...props} />}
                    {section === "abilities" && <AbilitiesTab {...props} />}
                    {section === "spells" && <SpellsTab {...props} />}
                    {section === "gear" && <GearTab {...props} />}
                    {section === "notes" && <NotesTab {...props} onHistory={() => setDrawer("history")} />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </main>

      <button className="die-fab" aria-label="Roll dice" onClick={() => setDrawer("dice")}>
        <D20Icon />
      </button>

      {cols === 1 && (
        <nav className="tabbar" aria-label="Sheet sections">
          {(
            [
              ["actions", SwordIcon],
              ["abilities", StarIcon],
              ["spells", SparkIcon],
              ["gear", BagIcon],
              ["notes", ScrollIcon],
            ] as const
          ).map(([t, Icon]) => (
            <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
              <Icon />
              {TAB_LABELS[t]}
            </button>
          ))}
        </nav>
      )}

      {roller.shown && (
        <RollDrawer
          shown={roller.shown}
          ask={lastAsk}
          onClose={roller.close}
          onAgain={(mode) => lastAsk && ask(lastAsk, mode)}
          onDamage={(crit) => {
            if (!lastAsk?.damage) return;
            const d = lastAsk.damage;
            setLastAsk({ label: d.label, expression: d.expression });
            void rollAndShare(crit ? `${d.label} (critical)` : d.label, crit ? criticalNotation(d.expression) : d.expression);
          }}
          onHistory={() => {
            roller.close();
            setDrawer("history");
          }}
        />
      )}
      {drawer === "hp" && <HpDrawer {...props} onClose={() => setDrawer(null)} />}
      {drawer === "party" && <PartyDrawer onClose={() => setDrawer(null)} />}
      {drawer === "conditions" && <ConditionsDrawer {...props} onClose={() => setDrawer(null)} />}
      {drawer === "dice" && (
        <DiceDrawer
          onClose={() => setDrawer(null)}
          onRoll={(expression, label) => {
            setDrawer(null);
            ask({ label, expression });
          }}
        />
      )}
      {drawer === "history" && (
        <Drawer title="Roll history" onClose={() => setDrawer(null)}>
          {roller.history.length === 0 && <p className="muted">No rolls yet. Tap any number on the sheet to roll it.</p>}
          <ul className="history">
            {roller.history.map((h) => (
              <li key={h.id}>
                <span className={`t ${h.flag ?? ""}`}>{h.total}</span>
                <span className="grow">
                  {h.label}
                  <br />
                  <span className="breakdown small">{h.breakdown}</span>
                </span>
                <span className="muted small">{new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        </Drawer>
      )}
    </>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="btn btn-quiet" style={{ padding: 6 }} aria-label="Close" onClick={onClose}>
            <CloseIcon width={22} height={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RollDrawer({
  shown,
  ask,
  onClose,
  onAgain,
  onDamage,
  onHistory,
}: {
  shown: ShownRoll;
  ask: RollAsk | null;
  onClose: () => void;
  onAgain: (mode: RollMode) => void;
  onDamage: (crit: boolean) => void;
  onHistory: () => void;
}) {
  return (
    <Drawer title={shown.label} onClose={onClose}>
      <div className={`roll-result ${shown.flag ?? ""}`} aria-live="polite">
        <div className="total" key={shown.result.rolledAt}>
          {shown.result.total}
        </div>
        {shown.flag && <div className="flag">{shown.flag === "crit" ? "Natural 20" : "Natural 1"}</div>}
        <p className="breakdown">
          {shown.result.expression}: {shown.breakdown}
        </p>
      </div>
      <div className="row" style={{ justifyContent: "center" }}>
        {ask?.damage && (
          <>
            <button className="btn btn-primary" onClick={() => onDamage(shown.flag === "crit")}>
              {shown.flag === "crit" ? "Roll critical damage" : "Roll damage"}
            </button>
            {shown.flag !== "crit" && (
              <button className="btn" onClick={() => onDamage(true)}>
                Critical damage
              </button>
            )}
          </>
        )}
        {ask?.d20Modifier !== undefined && (
          <>
            <button className="btn" onClick={() => onAgain("advantage")}>
              Advantage
            </button>
            <button className="btn" onClick={() => onAgain("disadvantage")}>
              Disadvantage
            </button>
          </>
        )}
        {ask && ask.d20Modifier === undefined && (
          <button className="btn" onClick={() => onAgain("normal")}>
            Roll again
          </button>
        )}
        <button className="btn btn-quiet" onClick={onHistory}>
          History
        </button>
      </div>
    </Drawer>
  );
}

function HpDrawer({ character, sheet, update, onClose }: SheetProps & { onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const ds = character.state.deathSaves;
  return (
    <Drawer title="Hit points" onClose={onClose}>
      <p className="muted" style={{ marginTop: -6 }}>
        {sheet.hp.current} of {sheet.hp.max.value}
        {sheet.hp.temp ? `, plus ${sheet.hp.temp} temporary` : ""}
      </p>
      <label className="field">
        <span>Amount</span>
        <input className="input" type="number" inputMode="numeric" min={0} autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={!n} onClick={() => (update((c) => applyDamage(c, content, n)), setAmount(""))}>
          Take damage
        </button>
        <button className="btn" disabled={!n} onClick={() => (update((c) => heal(c, content, n)), setAmount(""))}>
          Heal
        </button>
        <button className="btn" disabled={!n} onClick={() => (update((c) => setTempHp(c, Math.max(c.state.tempHp, n))), setAmount(""))}>
          Set temporary HP
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        Damage comes off temporary HP first. Temporary HP don't stack: the higher amount stays.
      </p>
      {sheet.hp.current === 0 && (
        <section className="section panel">
          <h3>Death saving throws</h3>
          <p className="small">
            Successes {ds.successes} of 3, failures {ds.failures} of 3.
            {ds.failures >= 3 ? " Your character has died." : ds.successes >= 3 ? " You're stable." : ""}
          </p>
          <div className="row">
            <button className="btn" onClick={() => update((c) => recordDeathSave(c, "success"))}>
              Success
            </button>
            <button className="btn" onClick={() => update((c) => recordDeathSave(c, "failure"))}>
              Failure
            </button>
            <button className="btn" onClick={() => update((c) => recordDeathSave(c, "critical-success"))}>
              Natural 20: wake with 1 HP
            </button>
            <button className="btn" onClick={() => update((c) => recordDeathSave(c, "critical-failure"))}>
              Natural 1: two failures
            </button>
          </div>
        </section>
      )}
    </Drawer>
  );
}

function ConditionsDrawer({ character, update, onClose }: SheetProps & { onClose: () => void }) {
  return (
    <Drawer title="Conditions" onClose={onClose}>
      <div className="row">
        {CONDITIONS.map((c) => (
          <button key={c} className="chip" aria-pressed={character.state.conditions.includes(c)} onClick={() => update((ch) => toggleCondition(ch, c))}>
            {c}
          </button>
        ))}
      </div>
      <section className="section">
        <h3>Exhaustion</h3>
        <p className="muted small" style={{ marginTop: 4 }}>
          Each level: −2 to D20 Tests and −5 ft. Speed. Level 6 is death. A Long Rest removes one level.
        </p>
        <div className="stepper">
          <button aria-label="Lower exhaustion" onClick={() => update((c) => setExhaustion(c, c.state.exhaustion - 1))}>
            −
          </button>
          <output>{character.state.exhaustion}</output>
          <button aria-label="Raise exhaustion" onClick={() => update((c) => setExhaustion(c, c.state.exhaustion + 1))}>
            +
          </button>
        </div>
      </section>
      <section className="section">
        <label className="row">
          <input
            type="checkbox"
            checked={character.state.heroicInspiration}
            onChange={(e) => update((c) => ({ ...c, state: { ...c.state, heroicInspiration: e.target.checked } }))}
          />
          Heroic Inspiration
        </label>
      </section>
    </Drawer>
  );
}

function DiceDrawer({ onClose, onRoll }: { onClose: () => void; onRoll: (expression: string, label: string) => void }) {
  const [count, setCount] = useState(1);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer title="Roll dice" onClose={onClose}>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="muted small">How many</span>
        <span className="stepper">
          <button aria-label="Fewer dice" onClick={() => setCount((n) => Math.max(1, n - 1))}>
            −
          </button>
          <output>{count}</output>
          <button aria-label="More dice" onClick={() => setCount((n) => Math.min(20, n + 1))}>
            +
          </button>
        </span>
      </div>
      <div className="dice-pad">
        {[4, 6, 8, 10, 12, 20, 100].map((d) => (
          <button key={d} onClick={() => onRoll(`${count}d${d}`, `${count}d${d}`)}>
            d{d}
          </button>
        ))}
        <button onClick={() => onRoll("2d20kh1", "d20 with Advantage")} aria-label="d20 with Advantage">
          Adv
        </button>
      </div>
      <form
        className="section"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            parseDice(custom);
            onRoll(custom.trim(), custom.trim());
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label className="field">
          <span>Any roll, such as 2d6+3 or 4d6dl1</span>
          <input className="input" value={custom} onChange={(e) => (setCustom(e.target.value), setError(null))} autoCapitalize="off" autoCorrect="off" />
        </label>
        {error && <p className="notice">{error}</p>}
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={!custom.trim()}>
          Roll
        </button>
      </form>
    </Drawer>
  );
}

function tableStatusText(status: ReturnType<typeof useTable>["status"], campaign: string): string {
  switch (status) {
    case "connected":
      return `At ${campaign}`;
    case "waiting":
      return `Waiting for the DM of ${campaign}`;
    case "connecting":
      return `Connecting to ${campaign}`;
    case "denied":
      return `${campaign}: not let in`;
    case "error":
      return `${campaign}: can't connect`;
    default:
      return campaign;
  }
}

function PartyDrawer({ onClose }: { onClose: () => void }) {
  const table = useTable();
  const campaign = table.invite?.campaign ?? "The game";
  return (
    <Drawer title={campaign} onClose={onClose}>
      {table.problem ? (
        <p className="notice">{table.problem}</p>
      ) : (
        <p className="muted small" style={{ marginTop: 0 }}>
          {table.status === "connected"
            ? "Connected to your DM. Your sheet and rolls are shared with the table as you play."
            : table.status === "waiting"
              ? "Waiting for your DM's app. It connects by itself when the DM starts hosting."
              : "Connecting…"}
        </p>
      )}
      <h3>Party</h3>
      {table.party.length === 0 && <p className="muted">No one else yet.</p>}
      <ul className="rows" aria-label="Party">
        {table.party.map((m) => (
          <li key={m.userId} className="resource">
            <div className="spread">
              <span>
                <strong>{m.character?.name ?? m.playerName}</strong>
                <br />
                <span className="muted small">
                  {m.character ? `${m.character.classSummary}, played by ${m.playerName}` : `${m.playerName} hasn't shared a character yet`}
                </span>
              </span>
              <span className={m.connected ? "small" : "muted small"}>{m.connected ? "Here" : "Away"}</span>
            </div>
            {m.character && (
              <div className="muted small" style={{ marginTop: 6 }}>
                HP {m.character.hp.current} of {m.character.hp.max}
                {m.character.hp.temp ? ` (+${m.character.hp.temp} temporary)` : ""}, AC {m.character.ac}
                {m.character.conditions.length ? `, ${m.character.conditions.join(", ")}` : ""}
              </div>
            )}
          </li>
        ))}
      </ul>
      <h3 style={{ marginTop: 16 }}>Table rolls</h3>
      {table.rolls.length === 0 && <p className="muted">No rolls shared yet.</p>}
      <ul className="history" aria-label="Table rolls">
        {[...table.rolls].reverse().map((r) => (
          <li key={r.id}>
            <span className={`t ${r.flag ?? ""}`}>{r.total}</span>
            <span className="grow">
              {r.characterName}: {r.label}
              <br />
              <span className="breakdown small">{r.breakdown}</span>
            </span>
          </li>
        ))}
      </ul>
      <button className="btn" style={{ marginTop: 16 }} onClick={() => void table.leave().then(onClose)}>
        Leave the game
      </button>
    </Drawer>
  );
}
