/** A panel that slides up over the screen: on phones from the bottom, on wide screens as a dialog. Escape closes it. */
import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "../lib/icons";

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="btn btn-quiet" style={{ padding: 6 }} aria-label="Close" onClick={onClose}>
            <CloseIcon width={22} height={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
