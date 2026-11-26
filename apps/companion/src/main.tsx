import "@fontsource-variable/fraunces/full.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppProvider } from "./lib/state";
import { TableProvider } from "./lib/table";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <TableProvider>
        <App />
      </TableProvider>
    </AppProvider>
  </StrictMode>,
);

// Offline support: register the service worker generated at build time.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* Offline mode is a bonus; the app still works online without it. */
    });
  });
}
