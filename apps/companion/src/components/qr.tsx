/**
 * QR codes: drawing them, and reading them with the camera. Reading uses the browser's BarcodeDetector where there
 * is one, and otherwise jsQR (Apache-2.0), loaded only when the camera opens.
 */
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useRef, useState } from "react";

export function QrCode({ text, label, level = "M" }: { text: string; label: string; level?: "L" | "M" }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, level);
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text, level]);
  // The SVG is generated here from our own text, not taken from anywhere else.
  return <div className={level === "L" ? "qr qr-dense" : "qr"} role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

interface Detector {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

async function makeReader(): Promise<(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Promise<string | null>> {
  const BD = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  if (BD) {
    try {
      const d = new BD({ formats: ["qr_code"] });
      return async (c) => (await d.detect(c))[0]?.rawValue ?? null;
    } catch {
      /* Fall back to jsQR below. */
    }
  }
  const { default: jsQR } = await import("jsqr");
  return async (c, ctx) => {
    const img = ctx.getImageData(0, 0, c.width, c.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

/** A camera view that reads QR codes until `accept` returns true for one. */
export function QrScanner({ accept, onClose }: { accept: (text: string) => boolean; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        setProblem("The camera couldn't be opened. Allow camera access for this page, or paste the code instead.");
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      const read = await makeReader();
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      const tick = async () => {
        if (stopped) return;
        if (v.videoWidth) {
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const text = await read(c, ctx).catch(() => null);
          if (text && acceptRef.current(text)) return;
        }
        timer = window.setTimeout(() => void tick(), 200);
      };
      void tick();
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div className="stack">
      {problem ? <p className="notice">{problem}</p> : <video ref={video} className="qr-camera" muted playsInline aria-label="Camera" />}
      <button type="button" className="btn" onClick={onClose}>
        Stop the camera
      </button>
    </div>
  );
}
