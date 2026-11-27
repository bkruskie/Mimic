import { decodeInvite, decodeLanCode, InviteError, LanCodeError, type LanOffer } from "@mimicbox/table";
import { useEffect, useState } from "react";
import { go } from "../App";
import { QrCode, QrScanner } from "../components/qr";
import { useApp } from "../lib/state";
import { inviteCodeFrom, useTable } from "../lib/table";

/** Joining a DM's game, from an invite link or on the DM's network without internet: choose a name and a character. */
export function JoinScreen({ code: initial }: { code: string | null }) {
  const table = useTable();
  const [mode, setMode] = useState<"link" | "network">("link");
  const [pasted, setPasted] = useState("");
  const code = initial ?? (pasted ? inviteCodeFrom(pasted) : null);
  let invite = null;
  let problem: string | null = null;
  if (code) {
    try {
      invite = decodeInvite(code);
    } catch (e) {
      problem = e instanceof InviteError ? e.message : "That invite link can't be read.";
    }
  }

  return (
    <main className="screen">
      <button className="btn btn-quiet" onClick={() => go({ name: "vault" })}>
        Back to the vault
      </button>
      {mode === "network" ? (
        <NetworkJoin onBack={() => setMode("link")} />
      ) : (
        <>
          <h1 style={{ marginTop: 12 }}>{invite ? `Join ${invite.campaign}` : "Join a game"}</h1>
          {!initial && (
            <>
              <label className="field" style={{ marginTop: 12 }}>
                <span>Invite link from your DM</span>
                <input className="input" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the link here" />
              </label>
              {!invite && (
                <div className="panel" style={{ marginTop: 16 }}>
                  <p style={{ marginTop: 0 }}>No internet at the table? If you're on the same Wi-Fi as the DM, you can join by scanning a code from the DM's screen.</p>
                  <button className="btn" onClick={() => setMode("network")}>
                    Join on the DM's network
                  </button>
                </div>
              )}
            </>
          )}
          {problem && <p className="notice">{problem}</p>}
          {invite && (
            <>
              <p className="muted">Your DM invited you to {invite.campaign}. Your character stays on this device; the DM gets a copy while you play.</p>
              <SeatPicker
                onJoin={async (characterId, playerName) => {
                  await table.join({ code: code!, characterId, playerName });
                  go({ name: "sheet", id: characterId });
                }}
              />
              {table.seat && table.seat.code !== code && <p className="muted small">Joining leaves your current game, {table.invite?.campaign}.</p>}
            </>
          )}
        </>
      )}
    </main>
  );
}

/** Your name at the table and the character you bring, then a button to join. */
function SeatPicker({ onJoin, busy = false }: { onJoin: (characterId: string, playerName: string) => Promise<void>; busy?: boolean }) {
  const { vault, entries } = useApp();
  const [playerName, setPlayerName] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (vault) void vault.getSetting<string>("playerName").then((n) => n && setPlayerName((p) => p || n));
  }, [vault]);
  useEffect(() => {
    if (!characterId && entries[0]) setCharacterId(entries[0].id);
  }, [entries, characterId]);
  return (
    <>
      <label className="field">
        <span>Your name at the table</span>
        <input className="input" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Sam" />
      </label>
      <h2 style={{ marginTop: 20 }}>Who are you bringing?</h2>
      {entries.length === 0 ? (
        <div className="panel">
          <p>Your vault is empty. Build a character first, then come back to join.</p>
          <button className="btn btn-primary" onClick={() => go({ name: "new" })}>
            Build a character
          </button>
        </div>
      ) : (
        <div className="choice-grid" role="group" aria-label="Character to bring">
          {entries.map((e) => (
            <button key={e.id} type="button" className="choice" aria-pressed={characterId === e.id} onClick={() => setCharacterId(e.id)}>
              <strong>{e.name}</strong>
              <small>{e.summary}</small>
            </button>
          ))}
        </div>
      )}
      <button
        className="btn btn-primary"
        style={{ marginTop: 20 }}
        disabled={!playerName.trim() || !characterId || busy || working}
        onClick={async () => {
          setWorking(true);
          try {
            await vault?.setSetting("playerName", playerName.trim());
            await onJoin(characterId!, playerName.trim());
          } finally {
            setWorking(false);
          }
        }}
      >
        {working ? "Joining…" : "Join the game"}
      </button>
    </>
  );
}

/** Joining without internet (ADR 0006): scan the DM's code, choose a character, then show the DM your reply. */
function NetworkJoin({ onBack }: { onBack: () => void }) {
  const table = useTable();
  const [text, setText] = useState("");
  const [offer, setOffer] = useState<{ code: string; offer: LanOffer } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<{ code: string; characterId: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === "function";

  const read = async (value: string) => {
    setError(null);
    try {
      setOffer({ code: value, offer: await decodeLanCode(value, "offer") });
      setScanning(false);
    } catch (e) {
      setError(e instanceof LanCodeError ? e.message : "That code can't be read.");
    }
  };

  // Once the DM has scanned the reply, the sheet is connected: go to it.
  useEffect(() => {
    if (reply && table.seat?.lan && table.status === "connected") go({ name: "sheet", id: reply.characterId });
  }, [reply, table.seat, table.status]);

  if (reply) {
    return (
      <>
        <h1 style={{ marginTop: 12 }}>Show the DM your reply</h1>
        <p className="muted">Hold your screen up to the DM's camera. Your sheet connects to {offer?.offer.campaign} as soon as they scan it.</p>
        <QrCode text={reply.code} label="QR code of your reply" level="L" />
        <div className="row" style={{ marginTop: 12 }}>
          <input className="input" readOnly value={reply.code} aria-label="Your reply" onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 0 }} />
          <button
            className="btn"
            onClick={() => {
              if (canShare) void navigator.share({ text: reply.code }).catch(() => undefined);
              else
                void navigator.clipboard?.writeText(reply.code).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
            }}
          >
            {canShare ? "Share" : copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="muted small" role="status">
          {table.status === "connected" ? "Connected." : "Waiting for the DM to scan your reply…"}
        </p>
        <button className="btn" onClick={() => go({ name: "sheet", id: reply.characterId })}>
          Go to my sheet
        </button>
      </>
    );
  }

  return (
    <>
      <h1 style={{ marginTop: 12 }}>{offer ? `Join ${offer.offer.campaign}` : "Join on the DM's network"}</h1>
      {!offer ? (
        <>
          <p className="muted">Be on the same Wi-Fi as the DM's computer. On the DM's screen, they choose Add a player without internet and show you a code.</p>
          {scanning ? (
            <QrScanner
              accept={(value) => {
                if (!value.includes("MB-LAN1.")) return false;
                void read(value);
                return true;
              }}
              onClose={() => setScanning(false)}
            />
          ) : (
            <button className="btn btn-primary" onClick={() => setScanning(true)}>
              Scan the DM's code
            </button>
          )}
          <form
            className="row"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void read(text);
            }}
          >
            <input className="input" style={{ flex: 1, minWidth: 0 }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Code from the DM" placeholder="Or paste the DM's code" />
            <button className="btn" disabled={!text.trim()}>
              Read the code
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="muted">Your character stays on this device; the DM gets a copy while you play.</p>
          <SeatPicker
            onJoin={async (characterId, playerName) => {
              setError(null);
              try {
                setReply({ code: await table.joinOnNetwork(offer.code, characterId, playerName), characterId });
              } catch (e) {
                setError(e instanceof LanCodeError ? e.message : "This browser couldn't make a reply. Check Wi-Fi is on, then scan the DM's code again.");
              }
            }}
          />
          {table.seat && table.invite?.campaign !== offer.offer.campaign && <p className="muted small">Joining leaves your current game, {table.invite?.campaign}.</p>}
        </>
      )}
      {error && <p className="notice">{error}</p>}
      <button className="btn btn-quiet" style={{ marginTop: 16 }} onClick={onBack}>
        Use an invite link instead
      </button>
    </>
  );
}
