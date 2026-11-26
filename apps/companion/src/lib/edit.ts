/** Pure edits the builder and sheet apply to a character. Each returns a new character. */
import {
  emptyClassEntry,
  findBackground,
  findSpecies,
  type Character,
  type ClassEntry,
  type Content,
  type FeatChoice,
} from "@mimicbox/ruleset-dnd5e";

const stamp = (c: Character): Character => ({ ...c, updatedAt: new Date().toISOString() });

export function setClass(c: Character, classId: string): Character {
  if (c.build.classes[0]?.id === classId) return c;
  return stamp({
    ...c,
    build: {
      ...c.build,
      classes: [emptyClassEntry(classId)],
      feats: c.build.feats.filter((f) => !f.source.startsWith("class:") && !f.source.startsWith("asi:")),
    },
    spells: { cantrips: [], prepared: [] },
  });
}

export function updateClassEntry(c: Character, patch: Partial<ClassEntry>, index = 0): Character {
  const classes = c.build.classes.map((e, i) => (i === index ? { ...e, ...patch } : e));
  return stamp({ ...c, build: { ...c.build, classes } });
}

export function setSpecies(c: Character, content: Content, speciesId: string): Character {
  if (c.build.species.id === speciesId) return c;
  const sp = findSpecies(content, speciesId);
  return stamp({
    ...c,
    build: {
      ...c.build,
      species: { id: sp.id, size: sp.sizes[0] ?? "medium", option: null, spellAbility: null, skill: null },
      feats: c.build.feats.filter((f) => f.source !== "species"),
    },
  });
}

export function setBackground(c: Character, content: Content, backgroundId: string): Character {
  if (c.build.background.id === backgroundId) return c;
  const bg = findBackground(content, backgroundId);
  const feat: FeatChoice = {
    id: bg.feat.id,
    source: "background",
    ...(bg.feat.id === "magic-initiate"
      ? { magicInitiate: { list: (bg.feat.option ?? "wizard").toLowerCase() as "cleric" | "druid" | "wizard", ability: "int", cantrips: [], spell: null } }
      : {}),
  };
  return stamp({
    ...c,
    build: {
      ...c.build,
      background: { id: bg.id, abilityIncreases: {} },
      feats: [...c.build.feats.filter((f) => f.source !== "background"), feat],
    },
  });
}

/** Replaces (or removes, with null) the feat granted by a source such as "species" or "asi:fighter:4". */
export function setFeatAt(c: Character, source: string, feat: Omit<FeatChoice, "source"> | null): Character {
  const others = c.build.feats.filter((f) => f.source !== source);
  return stamp({ ...c, build: { ...c.build, feats: feat ? [...others, { ...feat, source }] : others } });
}

export function patchFeatAt(c: Character, source: string, patch: Partial<FeatChoice>): Character {
  return stamp({ ...c, build: { ...c.build, feats: c.build.feats.map((f) => (f.source === source ? { ...f, ...patch } : f)) } });
}

export function toggle<T>(list: T[], item: T, max = Infinity): T[] {
  if (list.includes(item)) return list.filter((x) => x !== item);
  if (list.length >= max) return list;
  return [...list, item];
}

/** Resizes an image file to a small square portrait data URL, so it fits comfortably in the on-device vault. */
export async function portraitFromFile(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
