/**
 * Offline support: registers the service worker generated at build time. Every page (sheet, studio, display) does
 * this, so a DM who only ever opened the studio can still prepare with no connection.
 */
export function registerOffline(): void {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* Offline mode is a bonus; the app still works online without it. */
    });
  });
}
