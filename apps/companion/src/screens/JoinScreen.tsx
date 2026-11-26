import { decodeInvite, InviteError } from "@mimicbox/table";
import { useEffect, useState } from "react";
import { go } from "../App";
import { useApp } from "../lib/state";
import { inviteCodeFrom, useTable } from "../lib/table";

/** Joining a DM's game from an invite link: choose a name and the character you'll bring. */
export function JoinScreen({ code: initial }: { code: string | null }) {
  const { vault, entries } = useApp();
  const table = useTable();
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
  const [playerName, setPlayerName] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(null);
  useEffect(() => {
    if (vault) void vault.getSetting<string>("playerName").then((n) => n && setPlayerName((p) => p || n));
  }, [vault]);
  useEffect(() => {
    if (!characterId && entries[0]) setCharacterId(entries[0].id);
  }, [entries, characterId]);

  return (
    <main className="screen">
      <button className="btn btn-quiet" onClick={() => go({ name: "vault" })}>
        Back to the vault
      </button>
      <h1 style={{ marginTop: 12 }}>{invite ? `Join ${invite.campaign}` : "Join a game"}</h1>
      {!initial && (
        <label className="field" style={{ marginTop: 12 }}>
          <span>Invite link from your DM</span>
          <input className="input" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the link here" />
        </label>
      )}
      {problem && <p className="notice">{problem}</p>}
      {invite && (
        <>
          <p className="muted">Your DM invited you to {invite.campaign}. Your character stays on this device; the DM gets a copy while you play.</p>
          <label className="field">
            <span>Your name at the table</span>
            <input className="input" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Sam" />
          </label>
          <h2 style={{ marginTop: 20 }}>Who are you bringing?</h2>
          {entries.length === 0 ? (
            <div className="panel">
              <p>Your vault is empty. Build a character first, then open the invite link again.</p>
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
            disabled={!playerName.trim() || !characterId}
            onClick={async () => {
              await vault?.setSetting("playerName", playerName.trim());
              await table.join({ code: code!, characterId: characterId!, playerName: playerName.trim() });
              go({ name: "sheet", id: characterId! });
            }}
          >
            Join the game
          </button>
          {table.seat && table.seat.code !== code && <p className="muted small">Joining leaves your current game, {table.invite?.campaign}.</p>}
        </>
      )}
    </main>
  );
}
