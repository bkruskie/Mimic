# ADR 0001: Write the rules engine in TypeScript

Date: 2026-11-26. Status: accepted.

## Context

The architecture plan proposed rules written in Rust, compiled natively for the DM host and to WebAssembly for clients, so the host and the player app run identical rules code.

The owner then set the first release to be a standalone character sheet. All of its rules run in the player app; there is no host yet. The build environment used to start the project also could not download the Rust WebAssembly target, so a Rust-to-WebAssembly path could not be built or tested there.

## Decision

Rulesets are TypeScript packages (`packages/ruleset-dnd5e`). They are pure functions over plain data with no browser dependencies, so the same code can run anywhere a JavaScript engine runs.

When the Rust host arrives in Phase 3, it runs the ruleset inside an embedded JavaScript engine (QuickJS through `rquickjs` is the first candidate) to stay the single authority on results. That integration is a Phase 3 spike.

## Consequences

- One language for the player app and the rules; content-pack and homebrew authors work in the most widely known language.
- The Rust host takes on an embedded-JS dependency. If that proves too slow or too heavy, the fallback is a small Node or Bun sidecar process, or porting hot paths.
- The ruleset must stay free of DOM and Node APIs. `packages/ruleset-dnd5e` imports only `@mimicbox/dice` and its JSON content.
