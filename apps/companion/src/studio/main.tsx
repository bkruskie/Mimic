import "@fontsource-variable/fraunces/full.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "../styles.css";
import { registerOffline } from "../lib/offline";
import { prefetchBestiary } from "./Bestiary";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioApp } from "./StudioApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioApp />
  </StrictMode>,
);

registerOffline();
prefetchBestiary();
