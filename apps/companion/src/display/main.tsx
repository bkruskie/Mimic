import "@fontsource-variable/fraunces/full.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "../styles.css";
import { registerOffline } from "../lib/offline";
import { startTheme } from "../lib/theme";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DisplayApp } from "./DisplayApp";

startTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DisplayApp />
  </StrictMode>,
);

registerOffline();
