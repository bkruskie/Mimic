# ADR 0005: The DM hosts from a browser page first

Date: 2026-11-26. Status: accepted (owner approved).

## Context

The plan has the DM host in a Tauri desktop app with a Rust core (Phase 3). The Rust toolchain can't be downloaded in the build environment (ADR 0001), the rules engine is TypeScript, and ADR 0004 removed every server, so signalling and WebRTC both work in a browser.

## Decision

- The DM's host is a page of the web app, `studio.html`, served beside the player app (`index.html`) and the table display (`display.html`). One build, three entry points and three bundles, so players never download DM code.
- Host logic is pure TypeScript in `packages/table` (`handlePlayerMessage`, `playerView`, `displayView`): the same code can run later inside a desktop app or a headless host.
- Campaigns are stored on the DM's device in their own IndexedDB database (`mimicbox-studio`).
- The table display on the DM's device talks to the host over a `BroadcastChannel`. It receives only the player-safe view and has no way to send commands.
- Players accept messages only from the device identity named in the invite link. Trystero verifies identities against each WebRTC connection's certificate.

## Consequences

- DMs need nothing installed: open the page, create a campaign, share the link.
- The game is hosted only while the DM's page is open. Players' sheets wait and reconnect by themselves.
- Browsers may evict site storage. The DM page should offer campaign export and backups (Phase 4).
- A desktop app stays possible for second screens, local-network play and always-on hosting; it would reuse `packages/table` unchanged.
