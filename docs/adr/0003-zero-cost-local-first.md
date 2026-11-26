# ADR 0003: Zero cost and local-first storage

Date: 2026-11-26. Status: accepted.

## Context

The owner requires the application to cost nothing to use or to run, and to keep data as local as possible.

## Decision

- No accounts and no cloud database. Each device creates its own identity key.
- Player data (characters, notes, joined games) lives in the browser's IndexedDB and Origin Private File System; the app requests persistent storage and offers file export.
- The DM's computer will be the master copy for campaigns.
- ~~The only internet service planned is a connection broker on Cloudflare's free tier.~~ Superseded by ADR 0004: Mimic Box runs no internet service at all.
- The player app is a static site, hostable for free.

## Consequences

- Browsers can evict site data under storage pressure, especially on iOS for sites not added to the home screen. The app tells players this and makes export one tap away.
- Code signing for desktop apps costs money; the desktop host may ship unsigned with clear install steps until a free signing programme is available.
