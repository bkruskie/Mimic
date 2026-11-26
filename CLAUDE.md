# Working on Mimic Box VTT

Read `docs/architecture.md` before changing architecture, data models or the roadmap. Decisions are recorded in `docs/adr/`.

## Product truths

- Zero cost to use and to run. No accounts, no cloud database, no paid services. The only planned internet piece is a free connection broker that stores nothing.
- Local-first. Characters belong to the player and live on their device. The DM's computer will host games (Phase 3).
- Phase 1 is the character sheet: offline, installable, no DM and no network required.
- Rules live behind the ruleset boundary (`packages/ruleset-*`). D&D 5e (2024) first; Pathfinder 2e and Neon Odyssey follow.
- Ship only content we have rights to: SRD 5.2.1 (CC-BY-4.0, attribution required), Pathfinder ORC material later. Never bundle proprietary rulebook text or art.

## Engineering rules

1. Small vertical slices that run end to end. No placeholder buttons that imply missing features.
2. Characters store choices and play state; computed values are derived, never saved.
3. Every derived value carries its sources so the sheet can explain it.
4. Character operations are pure functions returning a new character.
5. Rules numbers live in `mechanics.ts`; text comes from the content pack. Do not hand-edit the JSON pack: change `tools/srd-import` and re-run it.
6. Validate imported files; reject newer schema versions with a clear message.
7. Write plain, specific interface copy in sentence case. Errors say what happened and what to do.
8. Never claim something works until it has been run: `pnpm check` and `pnpm test:e2e`.

## Commands

```sh
pnpm check        # type check, unit tests, build
pnpm test:e2e     # browser test (needs Chrome; CHROME_PATH to override)
node tools/srd-import/import.mjs <path to srd-5.2/en>   # rebuild the SRD content pack
node tools/icons/render.mjs                             # re-render app icons after editing icon.svg
```
