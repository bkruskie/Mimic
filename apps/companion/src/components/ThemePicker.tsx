import { setThemeChoice, useThemeChoice, type ThemeChoice } from "../lib/theme";

const CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "device", label: "Match device" },
];

/** Dark, light or the device's own setting, for this device. */
export function ThemePicker() {
  const choice = useThemeChoice();
  return (
    <div className="theme-picker" role="group" aria-label="Theme">
      {CHOICES.map((c) => (
        <button key={c.id} type="button" aria-pressed={choice === c.id} onClick={() => setThemeChoice(c.id)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}
