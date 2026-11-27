/**
 * Pictures the DM adds to handouts and world entries: kept on this device by id, and sent to players only when
 * what they belong to is shown.
 */
import { newId } from "@mimicbox/ruleset-dnd5e";
import { useEffect, useRef, useState } from "react";
import { scaleHandoutImage } from "../lib/mapImages";
import { deleteImage, loadImage, saveImage } from "./store";

/** A picture kept on this device. */
export function StoredImage({ id, alt }: { id: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadImage(id).then((d) => live && setSrc(d ?? null), () => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [id]);
  return src ? <img className="handout-image" src={src} alt={alt} /> : null;
}

/**
 * Tracks pictures added while editing, so cancelling or replacing a picture doesn't leave copies behind.
 * Call `kept(id)` after saving with the picture that stays, and `discard()` on cancel.
 */
export function useDraftPictures() {
  const added = useRef(new Set<string>());
  return {
    add: (id: string) => added.current.add(id),
    kept: (id: string | null, previous: string | null) => {
      for (const x of added.current) if (x !== id) void deleteImage(x);
      added.current.clear();
      if (previous && previous !== id) void deleteImage(previous);
    },
    discard: () => {
      for (const x of added.current) void deleteImage(x);
      added.current.clear();
    },
  };
}

/** Add, replace or remove a picture. `onAdd` gets the id of a picture just stored on this device. */
export function PicturePicker({ imageId, label, onAdd, onRemove }: { imageId: string | null; label: string; onAdd: (id: string) => void; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="field">
      <span>Picture</span>
      {imageId && <StoredImage id={imageId} alt={label} />}
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Adding the picture…" : imageId ? "Replace picture" : "Add a picture"}
        </button>
        {imageId && (
          <button type="button" className="btn btn-quiet" onClick={onRemove}>
            Remove picture
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={label}
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const id = newId();
            await saveImage(id, await scaleHandoutImage(file));
            onAdd(id);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
