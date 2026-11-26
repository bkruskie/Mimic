/**
 * App-wide state: the vault, the content pack, the character being viewed, and the roll drawer.
 * Characters autosave to the vault a moment after every change.
 */
import { describeRoll, roll as rollDice, type RollResult } from "@mimicbox/dice";
import { Vault, requestPersistence, type RollEntry, type StorageStatus, type VaultEntry } from "@mimicbox/local-store";
import { derive, newId, srdContent, type Character, type Content, type DerivedSheet } from "@mimicbox/ruleset-dnd5e";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export const content: Content = srdContent;

export function summaryFor(c: Character): string {
  try {
    const s = derive(c, content);
    return `${s.classSummary}, ${s.speciesName}`;
  } catch {
    return "Needs attention";
  }
}

export interface RollRequest {
  label: string;
  expression: string;
}

export interface ShownRoll {
  label: string;
  result: RollResult;
  breakdown: string;
  flag?: "crit" | "fumble";
}

interface AppState {
  vault: Vault | null;
  vaultError: string | null;
  entries: VaultEntry[];
  refresh: () => Promise<void>;
  storage: StorageStatus | null;
  toast: (message: string) => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [vault, setVault] = useState<Vault | null>(null);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    Vault.open()
      .then(async (v) => {
        if (!alive) return;
        setVault(v);
        setEntries(await v.list());
      })
      .catch((e: Error) => setVaultError(e.message));
    requestPersistence()
      .then(setStorage)
      .catch(() => setStorage(null));
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (vault) setEntries(await vault.list());
  }, [vault]);

  const toast = useCallback((message: string) => {
    setToastText(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(null), 2600);
  }, []);

  const value = useMemo(() => ({ vault, vaultError, entries, refresh, storage, toast }), [vault, vaultError, entries, refresh, storage, toast]);
  return (
    <AppContext.Provider value={value}>
      {children}
      {toastText && (
        <div className="toast" role="status">
          {toastText}
        </div>
      )}
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider.");
  return ctx;
}

/** Loads one character, derives its sheet, and saves every change after a short pause. */
export function useCharacter(id: string) {
  const { vault, refresh } = useApp();
  const [character, setCharacter] = useState<Character | null>(null);
  const [missing, setMissing] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<Character | null>(null);

  useEffect(() => {
    if (!vault) return;
    vault.get<Character>(id).then((entry) => {
      if (entry) setCharacter(entry.doc);
      else setMissing(true);
    });
  }, [vault, id]);

  const flush = useCallback(async () => {
    const c = pending.current;
    if (!c || !vault) return;
    pending.current = null;
    await vault.put(c, summaryFor(c));
    await refresh();
  }, [vault, refresh]);

  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  const update = useCallback(
    (next: Character | ((c: Character) => Character)) => {
      setCharacter((prev) => {
        if (!prev) return prev;
        const value = typeof next === "function" ? next(prev) : next;
        pending.current = value;
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void flush(), 400);
        return value;
      });
    },
    [flush],
  );

  const sheet: DerivedSheet | null = useMemo(() => (character ? derive(character, content) : null), [character]);
  return { character, sheet, update, missing };
}

/** Rolls dice, records the roll in the character's history, and returns it for display. */
export function useRoller(characterId: string | null) {
  const { vault } = useApp();
  const [shown, setShown] = useState<ShownRoll | null>(null);
  const [history, setHistory] = useState<RollEntry[]>([]);

  const loadHistory = useCallback(async () => {
    if (vault && characterId) setHistory(await vault.rolls(characterId, 30));
  }, [vault, characterId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const roll = useCallback(
    async (req: RollRequest) => {
      const result = rollDice(req.expression);
      const flag = result.naturalD20 === 20 ? "crit" : result.naturalD20 === 1 ? "fumble" : undefined;
      const shownRoll: ShownRoll = { label: req.label, result, breakdown: describeRoll(result), ...(flag ? { flag } : {}) };
      setShown(shownRoll);
      if (vault && characterId) {
        const entry: RollEntry = {
          id: newId(),
          characterId,
          at: result.rolledAt,
          label: req.label,
          expression: req.expression,
          total: result.total,
          breakdown: shownRoll.breakdown,
          ...(flag ? { flag } : {}),
        };
        await vault.addRoll(entry);
        await loadHistory();
      }
    },
    [vault, characterId, loadHistory],
  );

  return { roll, shown, close: () => setShown(null), history, reopen: setShown };
}
