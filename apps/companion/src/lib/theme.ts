/**
 * The colour theme is a choice for this device, not the campaign: a bright room or a projector wants Parchment,
 * a dim table wants the dark chest, which is the default. "device" follows the operating system. The sheet, the studio and the table
 * display share it, so a display opened from the studio matches it and follows when it changes.
 */
import { useSyncExternalStore } from "react";

export type ThemeChoice = "dark" | "light" | "device";
const KEY = "mimicbox:theme";
const media = () => window.matchMedia?.("(prefers-color-scheme: light)");

export function themeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "device" ? v : "dark";
  } catch {
    return "dark";
  }
}

function apply() {
  const choice = themeChoice();
  const theme = choice === "device" ? (media()?.matches ? "light" : "dark") : choice;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--meta-theme").trim() || "#241a26");
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();

export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "dark") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the theme still changes for this page.
  }
  apply();
}

/** Applies the theme now and keeps it current: the device setting, and other windows changing it. */
export function startTheme() {
  apply();
  media()?.addEventListener("change", apply);
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) apply();
  });
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    themeChoice,
    () => "dark",
  );
}
