/**
 * The table display: a second screen (TV, projector, spare laptop) on the DM's device. It shows only the
 * player-safe view and never sends anything but a request for the current view.
 */
import { displayChannelName, type DisplayView } from "@mimicbox/table";
import { useEffect, useState } from "react";
import { Markdown } from "../lib/markdown";

export function DisplayApp() {
  const campaignId = location.hash.replace(/^#/, "");
  const [view, setView] = useState<DisplayView | null>(null);
  useEffect(() => {
    if (!campaignId) return;
    const ch = new BroadcastChannel(displayChannelName(campaignId));
    ch.onmessage = (e) => {
      const d = e.data as DisplayView;
      if (d?.t === "display" && Array.isArray(d.members)) setView(d);
    };
    ch.postMessage({ t: "display-hello" });
    return () => ch.close();
  }, [campaignId]);

  if (!view) {
    return (
      <main className="display idle">
        <img src="./icon.svg" alt="" />
        <p>Waiting for the DM's game. Open this screen from the DM page with Open table display.</p>
      </main>
    );
  }
  const latest = view.rolls.at(-1);
  return (
    <main className="display">
      <header className="display-head">
        <h1>{view.campaign}</h1>
        <button className="btn btn-quiet" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}>
          Full screen
        </button>
      </header>
      <div className="display-body">
        <section aria-label="Party" className="display-party">
          {view.members.filter((m) => m.character).length === 0 && <p className="muted">The party appears here as players join.</p>}
          {view.members
            .filter((m) => m.character)
            .map((m) => {
              const c = m.character!;
              const pct = c.hp.max ? Math.max(0, Math.min(100, (c.hp.current / c.hp.max) * 100)) : 0;
              return (
                <article key={m.userId} className={m.connected ? "display-card" : "display-card away"}>
                  <h2>{c.name}</h2>
                  <p className="muted">{c.classSummary}</p>
                  <div className="hp-bar big">
                    <span style={{ width: `${pct}%` }} className={pct <= 25 ? "low" : ""} />
                  </div>
                  <p className="display-stats">
                    <span>
                      HP {c.hp.current}/{c.hp.max}
                      {c.hp.temp ? ` +${c.hp.temp}` : ""}
                    </span>
                    <span>AC {c.ac}</span>
                  </p>
                  {c.conditions.length > 0 && <p className="display-conditions">{c.conditions.join(", ")}</p>}
                </article>
              );
            })}
        </section>
        <section aria-label="Rolls" className="display-rolls">
          {view.spotlight && (
            <article className="display-handout" aria-label={view.spotlight.title}>
              <h2>{view.spotlight.title}</h2>
              <Markdown text={view.spotlight.body} />
            </article>
          )}
          {latest && (
            <div className={`display-latest ${latest.flag ?? ""}`}>
              <span className="display-total">{latest.total}</span>
              <span>
                {latest.characterName}: {latest.label}
              </span>
            </div>
          )}
          <ul>
            {[...view.rolls]
              .reverse()
              .slice(1, 8)
              .map((r) => (
                <li key={r.id}>
                  <strong>{r.total}</strong> {r.characterName}: {r.label}
                </li>
              ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
