/**
 * Map pixels, in the browser. The DM's image is scaled, cut into tiles and kept on the DM's device. Before a tile is
 * sent to anyone, every square they may not see is painted over on a canvas and the result re-encoded, so the
 * hidden pixels are not in what they receive.
 */
import { HANDOUT_IMAGE_EDGE, MAX_MAP_EDGE, TILE_SIZE, tileColumns, tileRows, type Rect } from "@mimicbox/table";

const QUALITY = 0.85;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file couldn't be opened as an image. Try a JPEG, PNG or WebP."));
    img.src = src;
  });
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw maps.");
  return [c, ctx];
}

/** Scales an image file and cuts it into tiles. Returns the size and the tiles as JPEG data URLs. */
export async function cutMap(file: File): Promise<{ width: number; height: number; tiles: Map<string, string> }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_MAP_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);
    const tiles = new Map<string, string>();
    for (let ty = 0; ty < tileRows({ height }); ty++) {
      for (let tx = 0; tx < tileColumns({ width }); tx++) {
        const w = Math.min(TILE_SIZE, width - tx * TILE_SIZE);
        const h = Math.min(TILE_SIZE, height - ty * TILE_SIZE);
        const [c, ctx] = canvas(w, h);
        ctx.drawImage(img, (tx * TILE_SIZE) / scale, (ty * TILE_SIZE) / scale, w / scale, h / scale, 0, 0, w, h);
        tiles.set(`${tx}:${ty}`, c.toDataURL("image/jpeg", QUALITY));
      }
    }
    return { width, height, tiles };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A tile with the given rectangles painted solid, re-encoded so the covered pixels are gone. */
export async function coverTile(tile: string, cover: Rect[]): Promise<string> {
  if (cover.length === 0) return tile;
  const img = await loadImage(tile);
  const [c, ctx] = canvas(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = "#120d14";
  for (const r of cover) ctx.fillRect(r.x, r.y, r.w, r.h);
  return c.toDataURL("image/jpeg", QUALITY);
}

/** Scales a picture for a handout and encodes it as JPEG on a white background (for transparent PNGs). */
export async function scaleHandoutImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, HANDOUT_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const [c, ctx] = canvas(Math.max(1, Math.round(img.naturalWidth * scale)), Math.max(1, Math.round(img.naturalHeight * scale)));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}
