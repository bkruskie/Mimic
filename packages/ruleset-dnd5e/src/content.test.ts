import { beforeAll, describe, expect, it } from "vitest";
import { SPECIES_CHOICES } from "./mechanics.js";
import {
  createCharacter,
  derive,
  grantEquipment,
  loadSpells,
  resolveItem,
  srdContent as content,
  type Character,
} from "./index.js";

beforeAll(async () => {
  await loadSpells(content);
});

describe("SRD 5.2.1 pack", () => {
  it("has the full SRD set", () => {
    expect(content.classes).toHaveLength(12);
    expect(content.species).toHaveLength(9);
    expect(content.backgrounds).toHaveLength(4);
    expect(content.spells!.length).toBeGreaterThan(300);
    expect(content.pack.attribution).toMatch(/System Reference Document 5\.2\.1/);
  });

  it("every class has 20 levels, a subclass and level 1 features", () => {
    for (const c of content.classes) {
      expect(c.progression, c.id).toHaveLength(20);
      expect(c.subclasses.length, c.id).toBeGreaterThan(0);
      expect(c.features.some((f) => f.level === 1), c.id).toBe(true);
    }
  });

  it("every spell id the mechanics reference exists", () => {
    const ids = new Set(content.spells!.map((s) => s.id));
    for (const [species, def] of Object.entries(SPECIES_CHOICES)) {
      for (const o of def.options) {
        for (const id of [...(o.cantrips ?? []), ...Object.values(o.spells ?? {})]) expect(ids.has(id), `${species}/${o.id}: ${id}`).toBe(true);
      }
    }
    expect(ids.has("hunters-mark")).toBe(true);
    expect(ids.has("speak-with-animals")).toBe(true);
  });

  it("resolves most starting equipment to content", () => {
    const unresolved: string[] = [];
    for (const source of [...content.classes.map((c) => c.startingEquipment), ...content.backgrounds.map((b) => b.equipment)]) {
      for (const option of source) for (const item of option.items) if (!resolveItem(content, item.name)) unresolved.push(item.name);
    }
    // Only open-ended picks ("Musical Instrument of your choice", "Gaming Set (same as above)") may stay free text,
    // plus the Spellbook, which the SRD describes in the Wizard class rather than in the gear list.
    for (const name of unresolved) expect(name, name).toMatch(/choice|chosen|same as above|Artisan's Tools or|^Spellbook$/i);
  });
});

describe("every class and subclass derives cleanly at levels 1 to 5", () => {
  const spellIds = () => new Set(content.spells!.map((s) => s.id));
  for (const cls of content.classes) {
    for (let level = 1; level <= 5; level++) {
      it(`${cls.name} ${level}`, () => {
        let c: Character = createCharacter(content, { name: "Sweep", classId: cls.id, speciesId: "human", backgroundId: "soldier" });
        c = {
          ...c,
          build: {
            ...c.build,
            classes: [{ ...c.build.classes[0]!, level, subclass: level >= 3 ? cls.subclasses[0]!.id : null, choices: { landType: "temperate" } }],
          },
        };
        const opt = cls.startingEquipment[0]!;
        c = grantEquipment(c, content, opt.items, opt.gp);
        const s = derive(c, content);
        expect(s.level).toBe(level);
        expect(s.proficiencyBonus).toBe(level >= 5 ? 3 : 2);
        expect(s.hp.max.value).toBeGreaterThanOrEqual(level);
        expect(s.ac.value).toBeGreaterThanOrEqual(10);
        expect(s.attacks.length).toBeGreaterThan(0);
        const known = spellIds();
        for (const g of s.grantedSpells) expect(known.has(g.id), `granted spell ${g.id}`).toBe(true);
        if (s.spellcasting) {
          const listed = Object.values(s.spellcasting.list).flat();
          expect(listed.length).toBeGreaterThan(0);
          for (const id of listed) expect(known.has(id), id).toBe(true);
        }
        // Subclass pick appears exactly when it should.
        expect(s.pending.some((p) => p.kind === "subclass")).toBe(false);
      });
    }
  }
});
