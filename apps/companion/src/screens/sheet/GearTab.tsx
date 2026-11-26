import { newId, type Currency, type InventoryItem } from "@mimicbox/ruleset-dnd5e";
import { useMemo, useState } from "react";
import { Markdown } from "../../lib/markdown";
import { content } from "../../lib/state";
import { Drawer, type SheetProps } from "../SheetScreen";

const COINS: (keyof Currency)[] = ["pp", "gp", "ep", "sp", "cp"];

function detailFor(item: InventoryItem): string {
  if (!item.ref) return "";
  if (item.ref.kind === "weapon") {
    const w = content.weapons.find((x) => x.id === item.ref!.id);
    return w ? `${w.damage} ${w.damageType}${w.propertiesText ? `. ${w.propertiesText}` : ""}. Mastery: ${w.mastery}.` : "";
  }
  if (item.ref.kind === "armor") {
    const a = content.armor.find((x) => x.id === item.ref!.id);
    if (!a) return "";
    if (a.category === "shield") return "+2 AC.";
    return `AC ${a.baseAc}${a.addDex ? ` + Dex${a.maxDex !== null ? ` (max ${a.maxDex})` : ""}` : ""}. ${a.category[0]!.toUpperCase()}${a.category.slice(1)} armor${a.stealthDisadvantage ? ", Disadvantage on Stealth" : ""}.`;
  }
  return "";
}

export function GearTab({ character, update }: SheetProps) {
  const [adding, setAdding] = useState(false);
  const setItem = (id: string, patch: Partial<InventoryItem> | null) =>
    update((c) => ({
      ...c,
      updatedAt: new Date().toISOString(),
      inventory: patch === null ? c.inventory.filter((i) => i.id !== id) : c.inventory.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  const equipable = (i: InventoryItem) => i.ref?.kind === "weapon" || i.ref?.kind === "armor";

  return (
    <>
      <section className="section">
        <h2>Coins</h2>
        <div className="ability-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
          {COINS.map((k) => (
            <label key={k} className="ability" style={{ display: "block" }}>
              <span className="abbr">{k.toUpperCase()}</span>
              <input
                className="input"
                style={{ textAlign: "center", marginTop: 4, padding: "6px 4px", minHeight: 40 }}
                type="number"
                inputMode="numeric"
                min={0}
                value={character.currency[k]}
                onChange={(e) =>
                  update((c) => ({ ...c, updatedAt: new Date().toISOString(), currency: { ...c.currency, [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) } }))
                }
              />
            </label>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="spread">
          <h2>Inventory</h2>
          <button className="btn" onClick={() => setAdding(true)}>
            Add an item
          </button>
        </div>
        {character.inventory.length === 0 && <p className="muted">Nothing carried yet. Add an item to start.</p>}
        <ul className="rows" style={{ marginTop: 10 }}>
          {character.inventory.map((i) => {
            const gear = i.ref?.kind === "gear" ? content.gear.find((g) => g.id === i.ref!.id) : null;
            return (
              <li key={i.id} className="resource">
                <div className="spread">
                  <span>
                    <strong>{i.name}</strong>
                    <br />
                    <span className="muted small">{detailFor(i)}</span>
                  </span>
                  {equipable(i) && (
                    <button className="chip" aria-pressed={i.equipped} onClick={() => setItem(i.id, { equipped: !i.equipped })}>
                      {i.equipped ? "Equipped" : "Equip"}
                    </button>
                  )}
                </div>
                <div className="spread" style={{ marginTop: 6 }}>
                  <span className="stepper">
                    <button aria-label={`One fewer ${i.name}`} onClick={() => (i.quantity <= 1 ? setItem(i.id, null) : setItem(i.id, { quantity: i.quantity - 1 }))}>
                      −
                    </button>
                    <output>{i.quantity}</output>
                    <button aria-label={`One more ${i.name}`} onClick={() => setItem(i.id, { quantity: i.quantity + 1 })}>
                      +
                    </button>
                  </span>
                  <button className="btn btn-quiet" onClick={() => setItem(i.id, null)}>
                    Remove
                  </button>
                </div>
                {gear && (
                  <details className="small" style={{ marginTop: 6 }}>
                    <summary className="muted" style={{ cursor: "pointer" }}>
                      What it does
                    </summary>
                    <Markdown text={gear.text} />
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {adding && (
        <AddItemDrawer
          onClose={() => setAdding(false)}
          onAdd={(item) => {
            update((c) => ({ ...c, updatedAt: new Date().toISOString(), inventory: [...c.inventory, item] }));
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

function AddItemDrawer({ onClose, onAdd }: { onClose: () => void; onAdd: (item: InventoryItem) => void }) {
  const [q, setQ] = useState("");
  const all = useMemo(
    () => [
      ...content.weapons.map((w) => ({ kind: "weapon" as const, id: w.id, name: w.name, note: `${w.damage} ${w.damageType}` })),
      ...content.armor.map((a) => ({ kind: "armor" as const, id: a.id, name: a.name, note: a.category === "shield" ? "Shield" : `${a.category} armor` })),
      ...content.gear.map((g) => ({ kind: "gear" as const, id: g.id, name: g.name, note: g.cost })),
    ],
    [],
  );
  const matches = q.trim() ? all.filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30) : [];
  return (
    <Drawer title="Add an item" onClose={onClose}>
      <label className="field">
        <span>Search the SRD equipment, or type any item name</span>
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ul className="rows" style={{ marginTop: 10 }}>
        {matches.map((m) => (
          <li key={`${m.kind}:${m.id}`}>
            <button className="roll-row" onClick={() => onAdd({ id: newId(), ref: { kind: m.kind, id: m.id }, name: m.name, quantity: 1, equipped: false })}>
              <span className="grow">{m.name}</span>
              <span className="muted small" style={{ textTransform: "capitalize" }}>
                {m.note}
              </span>
            </button>
          </li>
        ))}
        {q.trim() && (
          <li>
            <button className="roll-row" onClick={() => onAdd({ id: newId(), ref: null, name: q.trim(), quantity: 1, equipped: false })}>
              <span className="grow">Add "{q.trim()}" as your own item</span>
            </button>
          </li>
        )}
      </ul>
    </Drawer>
  );
}
