# ADR 0002: Ship the character sheet first

Date: 2026-11-26. Status: accepted.

## Context

The handoff kit's first vertical slice was remote join plus a safe display: the riskiest networking work. The owner chose to centre the first release on the character sheet instead.

## Decision

Phase 1 is a standalone, offline character sheet for D&D 5e (2024) with SRD 5.2.1 content. Phase 2 deepens it (homebrew, levels 6 to 20 depth, Pathfinder 2e). Phase 3 is the kit's original slice: a DM-hosted session that sheets join.

The connectivity spike still runs early, in parallel, so the network design is tested before anything depends on it.

## Consequences

- Players get a useful app with no DM, network or account.
- The rules engine, content pipeline, on-device vault and design system are built and proven first; every later phase reuses them.
- Characters are created as player-owned vault documents from day one, so joining a game later attaches a working copy rather than migrating data.
