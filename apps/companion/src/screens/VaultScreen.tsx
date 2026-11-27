import { ThemePicker } from "../components/ThemePicker";
import { exportVaultBackup, importVaultBackup, newId, type Character } from "@mimicbox/ruleset-dnd5e";
import { downloadJson } from "../lib/download";
import { useRef, useState } from "react";
import { go } from "../App";
import { content, summaryFor, useApp } from "../lib/state";

export function Portrait({ name, src }: { name: string; src: string | null }) {
  return <span className="portrait">{src ? <img src={src} alt="" /> : name.trim().charAt(0).toUpperCase() || "?"}</span>;
}

export function VaultScreen() {
  const { vault, vaultError, entries, refresh, storage, toast } = useApp();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [trash, setTrash] = useState<Awaited<ReturnType<NonNullable<typeof vault>["trash"]>>>([]);

  async function onImport(file: File) {
    setImportError(null);
    try {
      const raw = JSON.parse(await file.text());
      const { characters, problems } = importVaultBackup(raw, content);
      for (let c of characters) {
        if (entries.some((e) => e.id === c.id)) c = { ...c, id: newId(), name: `${c.name} (copy)` };
        await vault!.put(c, summaryFor(c));
      }
      await refresh();
      if (characters.length) toast(characters.length === 1 ? `Imported ${characters[0]!.name}` : `Imported ${characters.length} characters`);
      if (problems.length) setImportError(`Some characters weren't imported. ${problems.join(" ")}`);
    } catch (e) {
      setImportError(e instanceof SyntaxError ? "That file isn't valid JSON, so it can't be a character file." : (e as Error).message);
    }
  }

  async function backUpAll() {
    const all = await Promise.all(entries.map((e) => vault!.get<Character>(e.id)));
    const characters = all.filter((e): e is NonNullable<typeof e> => Boolean(e)).map((e) => e.doc);
    downloadJson(exportVaultBackup(characters, content), `Mimic Box backup ${new Date().toISOString().slice(0, 10)}.mimicbox-backup`);
    toast(`Backed up ${characters.length} character${characters.length === 1 ? "" : "s"}`);
  }

  async function openTrash() {
    setTrash(await vault!.trash());
    setShowTrash((s) => !s);
  }

  return (
    <main className="screen">
      <header className="vault-head">
        <img src="./icon.svg" alt="" />
        <div>
          <h1>Mimic Box</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Your characters, kept on this device.
          </p>
        </div>
      </header>

      {vaultError && <p className="notice">{vaultError}</p>}

      <div className="row" style={{ marginBottom: 20 }}>
        <button className="btn btn-primary" onClick={() => go({ name: "new" })} disabled={!vault}>
          Build a character
        </button>
        <button className="btn" onClick={() => fileInput.current?.click()} disabled={!vault}>
          Import a file
        </button>
        <button className="btn" onClick={() => go({ name: "join", code: null })} disabled={!vault}>
          Join a game
        </button>
        {entries.length > 0 && (
          <button className="btn" onClick={() => void backUpAll()}>
            Back up all characters
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".mimicbox-character,.mimicbox-backup,.json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = "";
          }}
        />
      </div>
      {importError && <p className="notice">{importError}</p>}

      {vault && entries.length === 0 && (
        <div className="empty panel">
          <img src="./icon.svg" alt="" />
          <h2>Your vault is empty</h2>
          <p className="muted">Build a character to start. Everything is saved on this device and works without an internet connection.</p>
        </div>
      )}

      <ul className="vault-list">
        {entries.map((e) => {
          const c = e.doc as unknown as Character;
          return (
            <li key={e.id}>
              <button className="vault-card" onClick={() => go({ name: "sheet", id: e.id })}>
                <Portrait name={c.name} src={c.portrait} />
                <span>
                  <span className="name">{e.name}</span>
                  <br />
                  <span className="muted small">{e.summary}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="section">
        <button className="btn btn-quiet" onClick={() => void openTrash()} disabled={!vault}>
          {showTrash ? "Hide deleted characters" : "Deleted characters"}
        </button>
        {showTrash && (
          <ul className="rows" style={{ marginTop: 8 }}>
            {trash.length === 0 && <li className="roll-row muted">Nothing deleted.</li>}
            {trash.map((t) => (
              <li key={t.id} className="roll-row">
                <span className="grow">
                  {t.name}
                  <br />
                  <span className="muted small">{t.summary}</span>
                </span>
                <button
                  className="btn"
                  onClick={async () => {
                    await vault!.restore(t.id);
                    setTrash(await vault!.trash());
                    await refresh();
                    toast(`Restored ${t.name}`);
                  }}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="row theme-row">
        <span className="muted small">Theme on this device</span>
        <ThemePicker />
      </div>
      <footer className="footer-note stack">
        {storage && !storage.persisted && (
          <p>
            This browser may clear saved data if the device runs low on space. Add Mimic Box to your home screen, and export
            characters you care about from their Notes tab.
          </p>
        )}
        <p>{content.pack.attribution}</p>
        <p>Mimic Box VTT is free and works offline. It is compatible with fifth edition and not affiliated with Wizards of the Coast.</p>
      </footer>
    </main>
  );
}
