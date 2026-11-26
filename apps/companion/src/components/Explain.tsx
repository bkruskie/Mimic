import { formatModifier } from "@mimicbox/dice";
import type { Sourced } from "@mimicbox/ruleset-dnd5e";

/** "Where does this number come from?" A collapsed breakdown of a computed value. */
export function Explain({ label, value, plain = false }: { label: string; value: Sourced; plain?: boolean }) {
  return (
    <details className="small muted" style={{ marginTop: 6 }}>
      <summary style={{ cursor: "pointer" }}>{label}</summary>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        {value.sources.map((s, i) => (
          <li key={i}>
            {s.label}: {plain && i === 0 ? s.value : formatModifier(s.value)}
          </li>
        ))}
        <li>
          <strong>Total: {plain ? value.value : formatModifier(value.value)}</strong>
        </li>
      </ul>
    </details>
  );
}
