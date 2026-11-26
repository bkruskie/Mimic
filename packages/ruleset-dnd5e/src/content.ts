import armor from "../content/srd-5.2.1/armor.json";
import backgrounds from "../content/srd-5.2.1/backgrounds.json";
import classes from "../content/srd-5.2.1/classes.json";
import feats from "../content/srd-5.2.1/feats.json";
import gear from "../content/srd-5.2.1/gear.json";
import pack from "../content/srd-5.2.1/pack.json";
import rulesText from "../content/srd-5.2.1/rules-text.json";
import species from "../content/srd-5.2.1/species.json";
import weapons from "../content/srd-5.2.1/weapons.json";
import type {
  ArmorDef,
  BackgroundDef,
  ClassDef,
  Content,
  FeatDef,
  GearDef,
  InventoryItem,
  SpeciesDef,
  SpellDef,
  WeaponDef,
} from "./types.js";

/** The SRD 5.2.1 pack without spells. Call `loadSpells` to add them. */
export const srdContent: Content = {
  pack,
  classes: classes as ClassDef[],
  species: species as SpeciesDef[],
  backgrounds: backgrounds as BackgroundDef[],
  feats: feats as FeatDef[],
  weapons: weapons as WeaponDef[],
  armor: armor as ArmorDef[],
  gear: gear as GearDef[],
  rulesText,
};

let spellsPromise: Promise<SpellDef[]> | null = null;
/** Loads the spell list (about 380 KB) on demand and attaches it to the content. */
export function loadSpells(content: Content = srdContent): Promise<SpellDef[]> {
  if (content.spells) return Promise.resolve(content.spells);
  spellsPromise ??= import("../content/srd-5.2.1/spells.json").then((m) => {
    content.spells = (m.default ?? m) as SpellDef[];
    return content.spells;
  });
  return spellsPromise;
}

export function findClass(content: Content, id: string): ClassDef {
  const found = content.classes.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown class "${id}".`);
  return found;
}
export function findSpecies(content: Content, id: string): SpeciesDef {
  const found = content.species.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown species "${id}".`);
  return found;
}
export function findBackground(content: Content, id: string): BackgroundDef {
  const found = content.backgrounds.find((b) => b.id === id);
  if (!found) throw new Error(`Unknown background "${id}".`);
  return found;
}
export function findFeat(content: Content, id: string): FeatDef | undefined {
  return content.feats.find((f) => f.id === id);
}
export function findSpell(content: Content, id: string): SpellDef | undefined {
  return content.spells?.find((s) => s.id === id);
}

const singular = (name: string): string[] => {
  const n = name.trim();
  const out = [n];
  if (/ies$/i.test(n)) out.push(n.replace(/ies$/i, "y"));
  if (/es$/i.test(n)) out.push(n.replace(/es$/i, ""));
  if (/s$/i.test(n)) out.push(n.replace(/s$/i, ""));
  return out;
};

/**
 * Matches an item name from the SRD's equipment lists ("4 Handaxes", "Arcane Focus (Quarterstaff)") to content.
 * Returns null when nothing matches; the item is then kept as a free-text inventory entry.
 */
export function resolveItem(content: Content, name: string): InventoryItem["ref"] {
  const inner = /\(([^)]+)\)/.exec(name)?.[1];
  const stripped = name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const candidates = [name, ...(inner ? [inner] : []), stripped];
  // The SRD lists "Traveler's Clothes" in packages but "Clothes, Traveler's" in the gear list.
  const clothes = /^(.+?)\s+Clothes$/i.exec(stripped);
  if (clothes) candidates.push(`Clothes, ${clothes[1]}`);
  // Arrows, Bolts, Bullets and Needles are rows of the Ammunition entry.
  if (/^(arrows?|bolts?|bullets?|needles?)$/i.test(stripped)) candidates.push("Ammunition");
  for (const candidate of candidates) {
    for (const form of singular(candidate)) {
      const key = form.toLowerCase();
      const weapon = content.weapons.find((w) => w.name.toLowerCase() === key);
      if (weapon) return { kind: "weapon", id: weapon.id };
      const armorPiece = content.armor.find((a) => a.name.toLowerCase() === key || a.name.toLowerCase() === `${key} armor`);
      if (armorPiece) return { kind: "armor", id: armorPiece.id };
      const item = content.gear.find((g) => g.name.toLowerCase() === key);
      if (item) return { kind: "gear", id: item.id };
    }
  }
  return null;
}
