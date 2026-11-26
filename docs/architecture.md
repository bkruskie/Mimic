# Mimic Box VTT — Architecture & Implementation Plan

Nov 26, 2026 · @Brett

## Summary

Mimic Box VTT should be built as a **host-anywhere, peer-to-peer platform**. The DM's desktop app is the authoritative game server and keeps campaign data on the DM's own disk. Mimic Box runs no servers of its own. Devices introduce themselves to each other through existing free public networks (Nostr relays, with MQTT and BitTorrent trackers as fallbacks) using the open-source Trystero approach, then connect directly over encrypted WebRTC. Game traffic and files never pass through any third party, so Mimic Box costs nothing to run, needs no accounts, and **users pay nothing**.

Decisions locked so far:

| Decision | Choice | Why |
| --- | --- | --- |
| Hosting model | Local-first: the DM's computer hosts, each player's device stores their own games and characters, public signalling networks only introduce them | Kit's local-first ownership with the Mimic Box brief's play-from-anywhere goal; no cloud accounts or cloud storage |
| Cost | Zero, for users and for the project | Owner requirement. There is no Mimic Box service and no project account anywhere; the static apps are hosted free on GitHub Pages |
| Remote-first | WebRTC between devices, signalling over public Nostr/MQTT/BitTorrent networks, public STUN, LAN and manual-code fallbacks (ADR 0004) | Works across most home routers and mobile data without port forwarding or any account |
| Three experiences | DM Studio, Player Companion, Tabletop Display: separate apps, one protocol | Each gets its own server-filtered view; the display never receives DM data |
| Modularity | Separate modules (Campaign, World, Characters, Tabletop, Encounters, Session, Assets, Rules, Identity) with their own tables, commands and events | Modules can be built, tested and replaced independently, and they set up a plugin system later |
| Rule systems | D&D 5e (2024, SRD 5.2.1), Pathfinder 2e Remaster, Neon Odyssey (as a 5e extension) | Owner requirement. Two very different engines prove the rules boundary on day one |
| Stack (provisional, confirmed in Phase 0) | Tauri 2 + Rust host core, TypeScript rules engine, React + TypeScript clients, PixiJS 8 maps, SQLite, Trystero-style public signalling, GitHub Pages | Matches the kit; every piece has a free tier or is open source |
| Product focus | Character sheet first: a free, offline, installable sheet for D&D 5e (2024), then the table is built around it | Owner direction. It is useful on day one with no DM and no network, and it builds the rules engine, local storage and design system that everything else reuses |

**The player app has three jobs:** taking part in live sessions, keeping a local copy of every game the player belongs to, and storing the characters the player creates. Characters belong to the player and live on their device; a campaign holds a working copy during play and sends accepted changes back.

The first release is the character sheet on its own: a player installs Mimic Box VTT on a phone, builds a character and plays with it at any table, with no DM app, no network and no sign-up. Connecting sheets to a DM's hosted game comes next, then the campaign tools and the map. The remote-connectivity spike still runs in Phase 0, so the networking design is tested before anything depends on it.

## Character sheet first

The first release of Mimic Box VTT is a character sheet a player can install on a phone and use at any table, for free, with no DM app, no network and no account. It is the Player Companion's Character tab grown into a standalone app, so every later feature plugs into the same sheet rather than replacing it.

Starting here makes sense for the architecture too. The sheet needs the rules engine, the ruleset schemas, local storage, the character vault and the design system, which are the pieces every other part reuses. It needs none of the risky networking, so it can ship and be used while the connection work is proven separately.

### What the first release does

| Area | First release | Later |
| --- | --- | --- |
| Rules | D&D 5e (2024) with SRD 5.2.1 content | Pathfinder 2e (Phase 2), Neon Odyssey after its release |
| Building | Guided builder: class, species, background, ability scores (standard array, point buy or rolled), choices, starting equipment | Templates, random character, import from other tools |
| Sheet | Abilities, saves, skills, AC, initiative, speed, passive scores, proficiencies, features and traits, all computed | Custom sheet layouts per ruleset |
| Rolling | Tap any number to roll it; advantage and disadvantage; roll history; manual entry for physical dice | Shared rolls in a DM's game |
| Play tracking | HP, temporary HP, death saves, hit dice, short and long rests, spell slots, limited-use features, conditions, exhaustion | Effects pushed by the DM |
| Spells | Prepared and known spells, slots, concentration, spell details | Spell cards on the table display |
| Inventory | Equipment, attunement, currency, weight, containers | Trading items with other players |
| Levelling | Level up to 20 with guided choices, including Eldritch Invocations, Metamagic, Mystic Arcanum and Epic Boons | Multiclassing (Phase 2) |
| Homebrew | Free-text notes and custom features | Homebrew items, feats and subclasses in forms (Phase 2) |
| Storage | Many characters in a local vault; export and import as `.mimicbox-character` files | Linking a second device; joining a game with a character |

The SRD covers the core classes, species, spells and equipment but not every subclass or option in the paid books, so a simple way to add your own options matters early and is the first item of Phase 2.

### Phone layout

- **Top bar, always visible**: name, HP bar with a quick damage and heal control, AC, initiative, speed and any active conditions.
- **Tabs along the bottom**: Actions (attacks, spells and features you can use now), Abilities and skills, Spells, Inventory, and Features and notes.
- **Roll anywhere**: tapping a modifier rolls it; a floating die opens a free roll pad; the roll history slides up from the bottom.
- **Explain any number**: a long press on a computed value shows where it comes from, for example armour 13, Dexterity +2 and a shield +2 make AC 17.
- **Tablet and desktop**: the same sheet in two or three columns, with nothing hidden behind tabs.

### How a character is stored

A character stores the choices the player made and the current state of play. Every computed number is worked out by the rules engine each time, never saved. That is what makes level-up, rules fixes and later the same character in a DM's game safe.

```json
{
  "id": "01J…",
  "ruleset": "dnd5e-2024",
  "schemaVersion": 1,
  "identity": { "name": "Wren Ashdown", "portrait": "sha256:…" },
  "build": {
    "abilityMethod": "pointBuy",
    "baseAbilities": { "str": 8, "dex": 15, "con": 14, "int": 10, "wis": 13, "cha": 12 },
    "species": "srd:human",
    "background": "srd:sage",
    "levels": [ { "class": "srd:rogue", "choices": { "skills": ["stealth", "perception", "acrobatics", "investigation"] } } ]
  },
  "state": { "hp": 9, "tempHp": 0, "hitDiceSpent": 0, "conditions": [], "slotsSpent": {} },
  "inventory": [ { "item": "srd:rapier", "qty": 1, "equipped": true } ],
  "notes": "…"
}
```

Characters live in the vault on the player's device (IndexedDB, with portraits in OPFS), are saved after every change, and can be exported as a single file at any time. The vault is the same one described under Local storage, so nothing is migrated when sheets later connect to a DM's game.

## Vision analysis

The handoff kit and the Mimic Box project description share a goal, one home for preparing and playing a campaign, but they disagree in five places. The local-first model settles each one as follows.

| Topic | Handoff kit says | Mimic Box description says | Resolution |
| --- | --- | --- | --- |
| Where the game lives | DM's computer, SQLite, local-first | "Cloud-based session hosting" | The authoritative host is a portable Rust core. It runs inside the DM desktop app by default, and later as a headless server the group can self-host (an always-on spare PC, a home server, a free VM). Same code, same data format. |
| Accounts | Local DM profile, guest invites | "User accounts and authentication" | No cloud accounts. Each device creates its own identity key on first run, the player app keeps the list of games the player has joined, and a QR code links a second device. Nothing to sign up for. |
| Scale | One host per campaign | "Multiple simultaneous campaigns and sessions", "scalability" | Scale comes free: every DM's machine is its own server. Public networks only carry a few signalling messages per join, never game traffic. |
| Community sharing | Out of scope for v1 | Long-term goal | Content packs are portable signed files from day one, so sharing later is a distribution problem, not a format change. |
| Rules | D&D first, rules modular | Multiple systems later | Owner now requires D&D, Pathfinder and Neon Odyssey, so the rules boundary is a Phase-0 deliverable, not a later refactor. |

Risks, highest first:

1. **Remote connectivity.** The whole product depends on a phone on mobile data reaching a laptop behind a home router. WebRTC with STUN handles most networks; strict NATs and UDP-blocking networks need a relay, and Mimic Box runs none. Those players switch networks, play on the DM's local network, or use a relay the group runs itself. This is spiked first, on real separate networks, and the share of failures is measured.
2. **Depending on public networks.** Signalling uses relays and trackers run by others, which can go offline or rate-limit. Mimic Box tries several at once across more than one network, lets the DM add their own, and always offers the local-network and manual-code paths.
3. **Secret leakage.** Fog of war that hides an image the player already downloaded is not secrecy. Hidden map areas are delivered as tiles only once revealed.
4. **Three rules engines.** Pathfinder 2e (three actions, four degrees of success, valued conditions) differs from 5e enough to break a 5e-shaped model. Both are modelled in Phase 0 before the character schema is fixed.
5. **Neon Odyssey licensing.** It is a 5e (2024) supplement from Avantris Entertainment, crowdfunded in 2026 and estimated to deliver in Q4 2027. Its rules text is proprietary, so Mimic Box can ship its mechanics engine but not its content without a licence (see Open decisions).
6. **Scope.** The vision covers a VTT, a world-building wiki, a character builder and a session planner. The roadmap delivers them as thin end-to-end slices and refuses placeholder features.

## Major subsystems

Mimic Box splits into ten functional modules plus three platform layers. Each module owns its own tables, exposes typed commands and queries, publishes domain events, and supplies a projector that decides what each audience may see. No module reads another module's tables; they talk through commands, events and stable IDs.

| Module | Owns | Typical commands | Consumed by | Built in |
| --- | --- | --- | --- | --- |
| Characters | Player characters, the vault, ownership, inventories, ruleset data documents | character.update, item.transfer, character.levelUp | Player Companion, later Encounters | Phase 1 |
| Rules | Ruleset plugins (dnd5e-2024, pf2e, neon-odyssey), content packs, dice engine | roll.request (evaluated), check, damage.apply | Characters, Encounters, Dice | Phase 0 spike, Phase 1 |
| Assets | Content-addressed binary files, thumbnails, map tiles, licences and provenance | asset.import, asset.fetch | Characters, Tabletop, World | Phase 1 (portraits), Phase 4 |
| Identity & Access | Device profiles, campaign members, roles, invites, devices, display credentials | invite.create, invite.revoke, member.remove | Every module (permission checks) | Phase 3 |
| Session | Session lifecycle, participants, scene pointer, live-state checkpoints, event log, chat | session.start, scene.activate, session.end | DM Studio, Player, Display | Phase 3 |
| Campaign | Campaigns, settings, enabled rulesets and content packs, backups | campaign.create, campaign.archive, backup.export | All content modules | Phase 3 (minimal), Phase 4 |
| Tabletop (VTT) | Maps, layers, map objects (tokens, walls, doors, lights, drawings), fog, measurement | token.move, fog.reveal, layer.setVisibility | Session, Encounters | Phase 3 (test token), Phase 5 |
| World | Lore entries, locations, factions, NPCs, quests, timelines, calendars, handouts, journals | entry.create, entry.reveal, quest.updateStatus | Session, Player journal | Phase 4 |
| Encounters & Combat | Encounter templates, combat instances, combatants, initiative, effects | combat.start, turn.advance, effect.apply | Session, Tabletop | Phase 6 |
| Planning | Adventures, session plans, ordered scenes, prep checklists | scene.reorder, plan.attach | DM Studio, Session | Phase 6 |

Platform layers under the modules:

- **Sync & Protocol**: the command/event envelope, sequencing, idempotency, per-audience streams, snapshots and replay.
- **Transport**: WebRTC data channels, local loopback for the DM's own windows, and a WebSocket path for development, LAN fallback and self-hosted tunnels. The game protocol never knows which one is in use.
- **Storage**: one SQLite database per campaign plus a content-addressed asset folder, with migrations owned per module.

The Session module is the only one that knows a game is live. Every other module works the same during preparation and during play, which is what lets the DM prep offline and keeps play from being a separate code path.

## System architecture

Every device talks to one authoritative host, and public signalling networks only introduce them. The DM's machine runs the host core and the DM's own windows. Players and remote displays load a static web app and open an encrypted peer-to-peer channel to that host.

*Diagram: system topology (DM host, signalling, players). See the live doc: https://claude.ai/artifact/8zvVCJ6iUVejZxPU7AXyXB. It was drawn with a Cloudflare broker, which ADR 0004 replaces with public signalling networks.*

Game data flows only between each device and the DM's host, encrypted. Public signalling networks only help devices find each other, and see only encrypted introductions.

### The three experiences

| Experience | Runs on | Audience it receives | Connects by | Can do |
| --- | --- | --- | --- | --- |
| DM Studio | Tauri desktop app (Windows, macOS, Linux) | DM: everything, including secrets | Loopback channel with a local secret | Prepare, edit, run the session, reveal, override |
| Player Companion | Browser or installed PWA on phone, tablet, laptop | Player: own characters, revealed content, player-visible map | WebRTC from the Mimic Box web app, or LAN fallback | Act for own characters, roll, move own tokens, journal |
| Tabletop Display | A second Tauri window on the TV/projector, or any browser (smart TV, spare laptop) with a display code | Display profile: a chosen layout of player-visible state only | Loopback (local window) or WebRTC (remote screen) | Nothing. It is read-only and cannot send game commands |

The display is not a mirror. It is a separate client with its own credential and its own camera (pan, zoom, layout), and the host builds its view from scratch. A DM can run several displays with different profiles, for example the battle map on the table and an initiative strip on a wall TV.

### How a player reaches the host

1. When the DM starts hosting, the host derives a room ID from the session's invite key and listens for joiners on several public signalling relays at once. No router ports are opened and nothing is registered anywhere.
2. The DM shares a link such as `bkruskie.github.io/Mimic/#join=…` or a QR code. The part after `#` never leaves the player's browser; it carries the room key, the invite secret and the host's certificate fingerprint.
3. The player's browser loads the Companion from the static site, joins the same room on the same relays, and exchanges the WebRTC offer, answer and network candidates with the host. These messages are encrypted with the room key, so relay operators see only that two devices met, their IP addresses and the timing.
4. The browser checks that the host's certificate matches the fingerprint from the link, so even a hostile relay cannot impersonate the host.
5. Inside the encrypted channel the player presents the invite secret. The host checks it, binds the player to a membership and character, and sends a filtered snapshot.

Connection paths are tried in order: same-network address, then direct internet using public STUN servers (free, no account). There is no hosted relay. If no direct path works, the player sees a plain explanation and three ways forward: switch network (for example from mobile data to home Wi-Fi), join on the DM's local network, or use a relay the group runs itself (a TURN address is a setting).

When public signalling is unreachable, two fallbacks need nothing on the internet beyond the two devices:

- **Local network**: the host serves the Companion itself on the home network and players join from a QR code over a plain local WebSocket (Phase 4, with secure-context limits documented). No internet needed at all.
- **Manual codes**: the DM and player trade connection codes by QR code or by pasting them into any chat app. Slow, but it depends on nothing.

Each connection opens four channels: **control** (reliable, ordered: auth, commands, acknowledgements), **state** (reliable, ordered: the audience's event stream), **live** (unreliable: cursor pings, drag previews, measuring lines that can be dropped), and **assets** (reliable: chunked file transfer).

### What runs on the internet

| Piece | Runs on | Cost | Mimic Box's load | If it fails |
| --- | --- | --- | --- | --- |
| Web apps (Companion, Display, site) | GitHub Pages | Free for public repositories | Every page load; the app is cached offline after the first | Installed apps keep working; new players load from any static host or the DM's local network |
| Signalling | Public Nostr relays (default), MQTT brokers and BitTorrent trackers (fallbacks), through a Trystero-compatible client ([Trystero](https://github.com/dmotz/trystero)) | Free, no account | A handful of encrypted messages per join | Several relays are used at once; if all fail, local network or manual codes |
| STUN | Public STUN servers | Free, no account | Every connection | Several servers are listed; same-network connections need none |
| Relay (TURN) | None hosted. Optional: one the group runs | Free if self-run | Only players whose network blocks direct paths | The player is told why and offered the three ways forward above |

## Backend architecture

The backend is one Rust host core that runs inside the desktop app or as a headless server. There is no other backend: all game logic lives in the host core, and nothing on the internet sees game content.

### Host core: Rust workspace

| Crate | Responsibility |
| --- | --- |
| `mimicbox-kernel` | IDs (UUIDv7), clock, errors, the `Module` trait, the audience type, permission-check helpers |
| `mimicbox-protocol` | Envelope and message types. Single source of truth: TypeScript types and JSON Schemas are generated from it for the clients |
| `mimicbox-sync` | Command pipeline, idempotency store, per-audience event streams, snapshots, replay buffer |
| `mimicbox-store` | SQLite access (WAL mode), per-module migrations, transactions, backup and restore |
| `mimicbox-transport` | WebRTC data channels (sans-I/O library: str0m or webrtc-rs `rtc`, chosen in the Phase 0 spike), loopback channel, WebSocket for dev, LAN and self-hosted tunnels |
| `mod-identity`, `mod-campaign`, `mod-session`, `mod-tabletop`, `mod-assets`, `mod-world`, `mod-characters`, `mod-encounters`, `mod-planning` | One crate per module: its tables, commands, events, projector |
| `mimicbox-rules` + `ruleset-dnd5e`, `ruleset-pf2e`, `ruleset-neon-odyssey` | Rulesets are TypeScript packages (ADR 0001). The host runs them in an embedded JavaScript engine (QuickJS, spiked in Phase 3), so the phone and the host run the same rules code |
| `mimicbox-host` | Composes everything; library for the desktop app, binary for headless hosting |

Each module implements one contract: declare its migrations, handle the commands it owns and return domain events, project each event for each audience, and build a snapshot for an audience. Adding a module, or later a plugin, means implementing that contract, not editing the others.

### Command pipeline

One writer task per campaign processes commands in order, which keeps results deterministic and avoids locking bugs.

1. **Decode**: reject anything over the size limit (64 KB for commands) or failing schema validation.
2. **Authenticate**: the connection's identity and audience come from the channel, never from the message body.
3. **Deduplicate**: a `commandId` already processed returns the original result instead of applying again.
4. **Authorize and validate**: the owning module checks membership, ownership and visibility, and asks the Rules module for any game math.
5. **Commit**: state change and domain event are written in one SQLite transaction with a new campaign revision.
6. **Project**: every module's projector turns the event into zero or more audience events, for example a token moving into a hidden area becomes "token removed" for players and "token moved" for the DM.
7. **Fan out**: each audience stream appends its events with its own sequence number and sends them. A rejected command gets a typed error back to the sender only.

### Protocol

```json
{
  "v": 1,
  "kind": "command",
  "id": "01J…msg",
  "commandId": "01J…cmd",
  "type": "tabletop.token.move",
  "expectedRev": 418,
  "payload": { "tokenId": "01J…", "to": { "x": 12, "y": 7 } }
}
```

Server messages carry `stream` and `seq` instead. Sequence numbers are per audience stream, not global, so a player can detect a gap even though they never see the DM's hidden events. On reconnect the client sends its last `seq`; the host replays from a bounded buffer or sends a fresh filtered snapshot. Messages are JSON in early phases for easy debugging, with MessagePack as a later drop-in using the same schema.

### Local storage on every device

Every device stores as much as it can locally. The DM's computer is the master copy; every other device keeps its own copy of what it may see, plus whatever its owner creates, so it loads instantly, keeps working when the connection drops, and asks the network only for what changed.

| Device | Keeps locally | How | Authority |
| --- | --- | --- | --- |
| DM computer | Everything: each campaign as a folder `Name.mimicbox/` holding `campaign.db`, `assets/` named by content hash, map tiles, and rolling backups. A separate `library.db` holds reusable NPCs, monsters, items, maps, installed rulesets and content packs | SQLite + files | Master copy |
| Player phone or laptop | A local copy of every game they belong to: revealed lore and handouts, the party view, last session snapshot, recent event history, dice log, settings, and every asset ever received | IndexedDB for records, Origin Private File System for large files, `navigator.storage.persist()` requested on join | Their copy of each joined game; the host stays authoritative for shared campaign state |
| Player-private notes | Notes the player marks "only on this device" never leave it; notes marked "share with DM" sync to the host | IndexedDB | The player |
| Character vault | Every character the player creates (the home copy), across all campaigns, exportable as `.mimicbox-character` files and offered when joining a new campaign (DM approves the import) | IndexedDB, files | The player. A campaign uses a working copy during play, and accepted changes flow back to the vault |
| Display device | Asset cache and its last layout | Same as player | Cache |
| Headless host (optional) | Same as the DM computer | SQLite + files | Master copy while it hosts |
| Internet | Nothing. Public signalling relays briefly carry encrypted introductions and keep no Mimic Box data | — | None |

Assets are content-addressed: a 20 MB battle map crosses the network once per device, ever, and later sessions only check hashes. Players can open their character sheet, journal and handouts while offline; changes they make offline queue as commands and are submitted on reconnect, where the host accepts or rejects them against the current revision.

Browsers may clear site storage under pressure, and iOS is stricter for sites not added to the home screen, so the Companion prompts players to install it and treats its store as a cache that can always be rebuilt from the host. Player-owned data (characters and private notes) exists only on the player's device, so the app offers a one-tap export file and reminds players to keep one.

Backups use the same idea: a `.mimicboxbak` archive with a manifest, schema version and checksums, written to any folder the DM picks. Pointing it at a folder that already syncs to their own Dropbox, OneDrive, Google Drive or iCloud gives free off-site backup without Mimic Box storing anything.

### Signalling

The host and the Companion share one signalling module that speaks the Trystero room protocol over several public relays at once, with the room key from the invite link. Whether the Rust host implements that protocol natively (the relays speak plain WebSocket and JSON) or runs it in the desktop app's web view is decided in the Phase 0 connectivity spike. Relay lists are settings, so a group can add its own.

There is no sign-up anywhere. Every device, DM or player, creates an identity key pair on first run. Invites bind a member to that key, so the same device rejoins automatically, and a QR code from an existing device links a second one.

## Frontend architecture

Three separate React + TypeScript apps share one client core, one design system and one map renderer. They are separate builds so the Display and Companion never even ship the DM's editing code.

### Repository layout

```text
mimicbox/
  apps/
    studio/        DM Studio: React + Vite inside Tauri 2 (src-tauri/ holds the desktop shell)
    companion/     Player Companion: React PWA, mobile-first, service worker for offline
    display/       Tabletop Display: small read-only bundle, no editing code
    site/          Landing page and help docs (static)
  crates/          Rust host core, modules, rules engine, rulesets (see Backend)
  packages/
    protocol/      Generated TypeScript types and validators from mimicbox-protocol
    client-core/   Connection manager, transports, signalling, sync engine, offline queue
    local-store/   IndexedDB + OPFS persistence, storage-persistence requests, quotas
    map/           PixiJS 8 renderer, camera, grids, tools, fog, tile loader
    ruleset-dnd5e/ D&D 5e (2024) rules engine and SRD content (TypeScript)
    sheets/        Character and stat-block renderers, per ruleset
    ui/            Design system: tokens, themes, components, icons
  content/         Original demo campaign, maps, tokens, SRD/ORC data packs with licences
  docs/            ADRs, protocol reference, runbooks
  tests/           Integration, network, security, end-to-end
```

Tooling: pnpm workspaces and Turborepo for TypeScript, a Cargo workspace for Rust, Vitest and Playwright for tests. Packages are created when their first consumer needs them, not up front.

### Client core

- **Connection manager**: picks a transport (Tauri loopback for the DM's own windows, WebRTC otherwise), shows plain-language status, reconnects with backoff, and re-authenticates.
- **Sync engine**: a normalized store fed by the audience stream. It applies events in order, detects sequence gaps and requests a resync, and exposes selectors to React.
- **Commands**: every command gets a `commandId` and an optional optimistic preview (a dragged token moves at once). The preview is rolled back if the host rejects it, with the reason shown.
- **Offline queue and local store**: the last snapshot, the asset cache and queued commands persist in IndexedDB/OPFS, so a reload or a dropped connection shows the last known state instantly.

The DM Studio uses this same core over the loopback channel. It is just the client with the most permissions, which also means the Studio can later run in a browser against a headless host, and a co-DM can join remotely.

### Map renderer

`@mimicbox/map` wraps PixiJS 8 (WebGPU with a WebGL fallback) in a framework-free engine with a thin React wrapper. One renderer serves all three apps with quality tiers: the phone tier caps texture size and skips effects. It renders square, hex and gridless grids, layers, tokens, walls and doors, fog as a mask, measuring and templates. Map backgrounds stream as tiles, and players receive only the tiles they are allowed to see. Targets to confirm in the Phase 5 benchmark: 60 fps on a mid-range laptop and 30 fps on a mid-range phone with 200 tokens.

### The three interfaces

- **DM Studio, campaign workspace**: a left rail for Overview, World, Characters, Maps, Encounters, Sessions, Library and Settings, with a searchable command palette.
- **DM Studio, live session**: host status bar on top (hosting, 4 connected, direct or relayed, last sync) with the Open Display button; scene and encounter list on the left; map in the centre; inspector on the right; initiative and the dice and chat log along the bottom. A "See as player" toggle asks the host for a real player projection rather than hiding things locally.
- **Player Companion**: bottom tabs for Table, Character, Actions, Journal and Party; a roll button always in reach of the thumb; a turn banner when it is their turn; a connection pill that explains itself when tapped.
- **Tabletop Display**: full-screen profiles for Map, Map + initiative, Scene art, Handout and Spotlight. With nothing assigned it shows a neutral idle screen, never a DM view.

### Visual identity and assets

The default look is warm and readable rather than ornate: dark charcoal-brown surfaces, parchment text, a brass accent, and a light parchment theme for bright rooms and projectors. Each rule system gets a theme as a token set: warm brass for D&D, deep red and gold for Pathfinder (without copying Paizo's trade dress), and a dark synthwave magenta and cyan for Neon Odyssey. The campaign's system picks the theme, and the DM can override it.

Secrecy is visible at a glance: DM-only content wears a dashed violet "veil" outline with an eye-slash icon, everywhere it appears, and display-visible content shows a small screen badge. Colour never carries meaning alone.

Type: Fraunces for headings, Inter for interface text, JetBrains Mono for dice formulas, all under the SIL Open Font Licence. Accessibility: WCAG 2.2 AA contrast, 44-pixel touch targets, full keyboard paths, reduced-motion support.

Every shipped asset is original or openly licensed, with source and licence recorded on the asset:

- Interface icons from Lucide (ISC licence), plus Mimic Box's own dice (d4 to d100), condition and token-frame icons drawn for the project.
- A demo campaign written for Mimic Box, with maps generated by code and tokens drawn as original silhouettes, so first-run never shows an empty screen.
- No official D&D, Pathfinder or Neon Odyssey art, logos or rulebook text beyond what their licences allow.

## Rules engine

The platform knows about actors, items, effects, rolls and turns; a ruleset plugin decides what they mean. D&D 5e (2024) and Pathfinder 2e are built together from the start so neither shapes the core by accident, and Neon Odyssey is an extension of the 5e plugin rather than a third engine.

### How the core abstractions map to each system

| Core concept | D&D 5e (2024) | Pathfinder 2e Remaster | Neon Odyssey |
| --- | --- | --- | --- |
| Actor types | Character, creature | Character, creature, hazard | Inherits 5e, adds starship and vehicle actors |
| Check outcome (ordered degrees) | Fail / success, natural 20 and 1 special | Critical failure / failure / success / critical success, by beating the DC by 10 | Inherits 5e |
| Turn economy (resource pools reset each turn) | Action, bonus action, reaction, movement | Three actions, one reaction, multiple-attack penalty | Inherits 5e; starship turns use crew stations |
| Proficiency | Proficiency bonus by level | Untrained / trained / expert / master / legendary ranks | Inherits 5e |
| Conditions | Named, on or off, with durations | Many carry a value that ticks down (frightened 2) | Inherits 5e, adds starship conditions |
| Character building | Class, species, background, feats | Ancestry, heritage, background, class, many feat slots | Class skins over 5e classes, new Machinist class, new species |
| Content licence | SRD 5.2.1 under CC-BY-4.0 ([D&D Beyond](https://dndbeyond.com/srd)) | Remaster rules under the ORC licence ([Paizo](https://paizo.com/blog/pathfinder-infinite-and-the-orc-license)) | Proprietary, needs a licence from Avantris |

### What a ruleset plugin provides

1. **Schemas** for its actor, item, effect and content types, versioned, so old characters migrate instead of breaking.
2. **Derivation**: a pure function from base data plus active effects to the computed sheet (armour class, saves, modifiers, speeds).
3. **Resolution**: turns an action into rolls and a typed outcome, using the system's degrees of success.
4. **Turn economy, initiative and conditions**: the resource pools, the initiative policy, and the condition catalogue with values and durations.
5. **Progression**: the character-builder steps and level-up rules.
6. **Sheet layout**: a declarative description the generic sheet renderer can draw, plus optional custom components for complex screens such as PF2e's feat grid or a Neon Odyssey starship console.

Plugins are TypeScript packages with no browser or Node dependencies, so the same code runs in the player app and, inside an embedded JavaScript engine, in the Rust host (ADR 0001). In a hosted game the host's result is the authoritative one; the player's copy runs the standalone sheet and instant previews.

### Extension, content and homebrew

- A ruleset may `extend` another. Neon Odyssey declares `extends: dnd5e-2024` and adds its own actor types, the starship combat subsystem, class skins as data overlays on the base classes, and its conditions. Other 5e supplements can follow the same path.
- Rules code and rules content are separate. Content ships as signed **content packs** with licence and attribution metadata: an SRD 5.2.1 pack with the required attribution statement, and a Pathfinder ORC pack limited to ORC-licensed material, excluding Paizo's reserved setting material.
- Homebrew is data, not code: DMs build classes, monsters and items in forms, and formulas use a small safe expression language (for example `@abilities.str.mod + @prof`). Sandboxed WebAssembly plugins for custom mechanics come later, under the plugin phase.

### Dice

One dice engine serves every system: standard notation with keep and drop, exploding and rerolling dice (`2d20kh1+5`, `4d6dl1`), rolled on the host with a secure random source and logged with the full breakdown. Players at the table can enter a physical roll instead; it is recorded and marked as physical.

## Data models

Each campaign is one SQLite database whose tables are grouped by owning module, and every content entity carries an explicit visibility policy. Rules-specific data lives in versioned JSON documents validated by the ruleset's schema, so the relational model stays the same for every system.

Conventions for every table: UUIDv7 `id`; `created_at`, `updated_at`; a `rev` integer for optimistic concurrency; `archived_at` for soft delete; foreign keys enforced. Ruleset documents carry `ruleset_id` and `schema_version`, and unknown fields from imports are preserved, not dropped.

### Identity & Access

| Entity | Key fields | Relationships |
| --- | --- | --- |
| Profile | display\_name, public\_key | A device's own identity, created on first run; the same for DMs and players |
| Member | role (dm, co\_dm, player, observer), profile\_public\_key, display\_name, status | Belongs to the campaign; owns characters, journals, rolls |
| Device | kind, credential\_hash, last\_seen | Many per member, so a phone and a laptop can both rejoin |
| Invite | token\_hash, role, character\_id, expires\_at, max\_uses, revoked\_at | Creates a member, optionally pre-assigned to a character |
| DisplayProfile | name, layout, content rules, credential\_hash | Read-only identity for a TV or projector |

### Campaign, Planning, Session

| Entity | Key fields | Relationships |
| --- | --- | --- |
| Campaign | name, ruleset\_id, ruleset\_version, theme, settings | Root of everything in the database |
| CampaignPack | pack\_id, version | Content packs enabled for this campaign |
| Adventure | title, summary, order | Groups sessions and scenes |
| Session | number, title, status (planned, live, ended), scheduled\_at, current\_scene\_id, recap | Belongs to an adventure; has participants and an event log |
| Scene | order, map\_id, encounter\_id, player\_text, dm\_notes | Belongs to a session plan; points at a map, encounter, handouts |
| Participant | member\_id, device\_id, connected\_at, status | A member's presence in one live session |
| SessionEvent | seq, type, actor\_member\_id, payload | Ordered history of accepted changes, for reconnect, recap and undo |
| RollRecord | expression, breakdown, total, visibility (public, dm, self), physical | Who rolled what, for which actor |
| ChatMessage | from\_member\_id, scope (all, dm, member), body | Session chat and whispers |

### World

| Entity | Key fields | Relationships |
| --- | --- | --- |
| Entry | kind (region, settlement, location, dungeon, faction, npc, deity, item, lore, event), title, parent\_id, properties | One wiki-style record; parent\_id forms the place hierarchy (region to settlement to building) |
| EntryBlock | order, rich\_text, visibility | An entry is a list of blocks, each with its own visibility, so an NPC can have a public description and secret motives |
| EntryLink | from\_id, to\_id, relation (member of, rules, located in, rival of), visibility | Connects entries into a graph |
| Quest, Objective | status, giver\_entry\_id, objectives with status | Revealed to players step by step |
| Calendar, TimelineEvent | calendar definition; date, title, linked entries, visibility | Custom calendars and in-world history |
| Handout | title, rich\_text or asset, visibility | Shared to players or displays when revealed |
| Journal | author\_member\_id, scope (private, shared with DM, party), body | Player and DM notes |

### Characters and Rules

| Entity | Key fields | Relationships |
| --- | --- | --- |
| Character | vault\_id, name, portrait\_asset\_id, ruleset\_id, schema\_version, data (JSON) | The campaign's working copy of a player's character, linked to the original in the player's vault by vault\_id; the ruleset owns the shape of `data` |
| CharacterOwner | member\_id, permission (owner, editor, viewer) | Who controls or may see a character |
| InventoryItem | item\_ref (pack entry or campaign item), quantity, equipped, data | Belongs to a character or a container item |
| Creature | name, ruleset\_id, statblock (JSON), source\_pack\_entry | The campaign bestiary, including NPC stat blocks |
| Item | ruleset\_id, data (JSON) | Campaign-specific and homebrew items |
| ContentPack, PackEntry | ruleset\_id, version, licence, attribution, signature; key, type, data | Read-only rules content; stored in the app library and referenced by campaigns |

### Tabletop, Encounters, Assets

| Entity | Key fields | Relationships |
| --- | --- | --- |
| Map | grid (type, size, offset, units), width, height, background\_asset\_id, tiled | Has layers, objects, fog |
| MapLayer | kind (background, objects, tokens, dm, walls, lighting), order, default\_visibility | Belongs to a map |
| MapObject | kind (token, wall, door, window, light, drawing, label, template), geometry, properties, actor\_ref, controller\_member\_id, visibility | A token's actor\_ref points to a Character, Creature or Combatant |
| FogArea | scope (party or member), revealed geometry | Decides which tiles and objects each audience receives |
| Encounter, EncounterSlot | name, notes; creature\_id, count, placement | Prepared fights, linked to a scene and map |
| Combat | round, turn\_index, status | A live fight in a session |
| Combatant | actor\_kind, actor\_id, token\_id, initiative, hidden, defeated | Joins an actor to a combat |
| EffectInstance | target, condition\_key, value, duration, source | Conditions and effects, interpreted by the ruleset |
| Asset | sha256 (the ID), mime, size, dimensions, licence, source | Binary file in `assets/`, shared by hash |
| AssetRef | asset\_id, entity\_type, entity\_id | An audience may fetch an asset only if it can see an entity that references it |
| MapTile | map\_id, zoom, x, y, asset\_id | Tiles of large or secret map backgrounds |

### Persistent versus live

Token positions, HP, conditions and initiative are persisted as they change, so a crash loses nothing and the next session starts where the last ended. Pings, cursors, drag previews and measuring lines travel only on the live channel and are never stored. A session ends with an automatic recap draft built from its event log, which the DM can edit and reveal.

### Internet records

There is no cloud database and no Mimic Box server. Nothing about a campaign or a session is stored anywhere but on the devices that take part.

## Security and visibility

Secrets are protected by never sending them: the host builds a separate view for each audience, and a client can only ever hold what its view contains. Hiding things in the interface is never the protection.

### Audiences and visibility rules

Every connection has exactly one audience: **DM** (also co-DM), **Player** (a specific member), **Observer**, or **Display** (a specific display profile). Every visible thing, whether an entry block, map object, layer, handout or roll, has a visibility rule built from these grants:

| Grant | Who sees it |
| --- | --- |
| `dm` | DM and co-DMs only (the default for new prep content) |
| `everyone` | All members and displays |
| `party` | All players and observers in the campaign |
| `owners` | The members who control the linked character |
| `members` | A listed set of members |
| `displays` | A listed set of display profiles (or all) |
| `fog` | Visible where the audience's fog is revealed (map content only) |

Revealing is a command, not a toggle in the interface: it changes the grant, the projector emits the newly visible content to the affected audiences, and the history records who revealed what and when.

### Rules that close the usual leaks

- **Fog backgrounds**: secret-sensitive maps are cut into tiles, and an audience is sent a tile only once its fog area overlaps it. A player who inspects their browser finds only the revealed part.
- **Assets**: files are fetched by hash, but the host serves a hash only to an audience that can see an entity referencing it. Guessing a hash gets nothing.
- **Hidden tokens and combatants** are absent from player and display views, not flagged as hidden. Initiative shows them only once revealed.
- **Rolls** marked DM or self never reach other audiences, not even as "someone rolled".
- **Display credentials** are read-only by capability: the host rejects any command on a display connection.
- **Invites** are 128-bit random secrets carried in the link fragment, stored only as hashes, scoped by role, expiring, revocable and rate-limited. Short codes only find the route; they do not grant access alone.
- **Logs** never contain invite secrets, private notes or full character payloads.
- **Files** are served only from the campaign's asset folder by hash; paths from clients are never accepted.

### Required security tests

The kit's ten cases are kept and extended. Each runs against real projected payloads, not the interface:

- [ ] Player requests a DM-only layer, entry block, token or roll: nothing secret in any response
- [ ] Display connection sends any command: rejected, state unchanged
- [ ] Player moves another player's token or edits another character: rejected unless granted
- [ ] Revoked invite or removed member reconnects: denied
- [ ] Duplicate command resent after a dropped connection: applied once
- [ ] Malformed, oversized or out-of-order messages: rejected safely, no crash
- [ ] Asset request by guessed hash or path traversal: denied
- [ ] Guessed session code or route: reveals no campaign details
- [ ] Fog reveal: tiles outside the revealed area never sent
- [ ] Token walks into fog: removed from player views, position not leaked
- [ ] A signalling relay swaps in a fake host: player refuses, fingerprint mismatch
- [ ] A signalling relay reads the introductions: they are encrypted with the room key
- [ ] Backup restore: campaign, assets and references restored and checksums match

## Implementation roadmap

Nine phases, each ending in a gate that must pass on real devices before the next starts. The character sheet ships first; remote connectivity is spiked alongside it so the network design is tested before anything depends on it.

*Diagram: roadmap, 9 phases each with a gate. See the live doc: https://claude.ai/artifact/8zvVCJ6iUVejZxPU7AXyXB*

Phases 0 and 1 are the current focus. No calendar dates are set yet; each phase is sized after the one before it passes its gate.

### Phase 0: foundations and spikes

Each spike answers one risky question with a throwaway prototype and records the answer as an ADR.

1. **Rules spike (leads)**: model one 5e attack, one PF2e strike with four degrees of success, and one valued condition behind the plugin contract; done in TypeScript (ADR 0001); the remaining check is running the same ruleset inside the Rust host's embedded JavaScript engine in Phase 3.
2. **Storage spike**: request persistent storage and store 200 MB in OPFS on Android Chrome and iOS Safari, installed and not installed; record what survives a week and a low-storage event.
3. **Connectivity spike (in parallel, not blocking the sheet)**: a Rust host using str0m and, separately, webrtc-rs `rtc`, behind a home router; a phone on mobile data; signalling through public Nostr relays with a Trystero-compatible client, in the browser and from the Rust host. Record which path connects on at least three network types, how often no direct path exists, and how fast joins are.
4. **Desktop spike**: Tauri 2 opens a second window, moves it to an external monitor and goes full screen there (recent Tauri releases add `set_fullscreen_on_monitor`, [release notes](https://v2.tauri.app/release/tauri-runtime/v2.12.0/)), on Windows and macOS.
5. **Repository**: monorepo, CI (lint, type check, tests on Windows, macOS, Linux), protocol code generation, ADRs 001 to 010.

Gate: the 5e engine passes hand-checked reference characters, and a character-sized record survives on both phone platforms.

### Phase 1: character sheet MVP (the first release)

Scope: the "First release" column of the Character sheet table. A guided D&D 5e (2024) builder with SRD 5.2.1 content, a fully computed sheet, tap-to-roll, HP, rests, slots and conditions, spells, inventory, levels 1 to 5, and a vault with export and import, as an installable app that works offline.

Deliverables: the sheet screens in `apps/companion`, `packages/ruleset-dnd5e`, the SRD content pack with its attribution statement, the vault in `packages/local-store`, and the first `packages/ui` components with the default theme.

Tests: computed values checked against hand-built reference characters for every SRD class at levels 1 to 5; dice-engine distribution tests; the vault survives reloads, offline use and app updates; export then import round-trips exactly; layouts checked at a 360-pixel phone width and on a tablet.

Gate: a player builds a level 1 character on a phone in airplane mode, plays a real session with it, and levels it to 2 without help.

### Phases 2 to 8

- **Phase 2, character sheet depth**: homebrew items, feats and subclasses in forms; levels 6 to 20 (done) and multiclassing; the Pathfinder 2e ruleset and sheet; desktop and tablet layouts; linking a second device. Gate: one app holds a 5e and a PF2e character, both matching reference sheets.
- **Phase 3, connect to the table**: the kit's first vertical slice, with real characters. The DM desktop app hosts; players join by link or QR code from their sheet; the DM sees the party's sheets and shared rolls; a test token syncs; a separate display window shows only player-safe state; reconnects never repeat an action. Gate: the kit's definition of done, met on genuinely separate networks with no Mimic Box server.
- **Phase 4, campaign and world**: campaign library, asset import, the world wiki with per-block visibility, journals and handouts, LAN fallback, backups and restore. Gate: a DM preps a world fully offline, and a backup restores on another computer.
- **Phase 5, tabletop MVP**: maps, square, hex and gridless grids, layers, tokens with control rules, walls and doors, tiled fog reveal, measuring. Gate: players see only permitted content and move only their tokens; the phone benchmark passes.
- **Phase 6, encounters and planning**: adventures, scenes, encounter builder, initiative, conditions pushed to sheets, combat log, session recap. Gate: a real session runs without external tools.
- **Phase 7, presentation and atmosphere**: display profiles, several displays at once, lighting and line of sight, scene art, ambient audio. Gate: a hybrid session with a table display and remote players feels finished.
- **Phase 8, ecosystem**: content-pack sharing, sandboxed WebAssembly plugins, headless host image, map and dungeon generators, Discord links. Gate: a third party ships a pack or plugin without a Mimic Box release.

Neon Odyssey waits until its rules are published (estimated Q4 2027). The licence question is settled then, and it is built as a 5e extension; until that point the only work is keeping the `extends` hook in the 5e ruleset.

## Open decisions and assumptions

No decisions are waiting on the owner. Everything below the decided list is a reversible assumption Phase 0 proceeds on.

### Decided

- [x] **Neon Odyssey: wait for release** (Nov 26, 2026). No ruleset work and no licence outreach until its rules are published. Its text is never shipped without permission.
- [x] **A DM hosts for $0** (Nov 26, 2026). Hosting needs no account, card, domain, server or subscription from the DM. The host runs on the DM's own computer; devices find each other through free public signalling networks and public STUN servers; there is no hosted relay and no Mimic Box service. A DM can also host on the local network with no internet service at all.
- [x] **Desktop app ships unsigned** (Nov 26, 2026). Mimic Box is free and open source, so it pays for no signing certificate. Install instructions explain the "unknown developer" warning on Windows and macOS, and free open-source signing programmes can be applied for later.
- [x] **Code licence: MIT** (Nov 26, 2026). The SRD content pack stays under CC-BY-4.0 with its attribution.
- [x] **Hosting the sheet before Phase 3: GitHub Pages** (Nov 26, 2026). The character sheet is a static app, so it is published free from the existing GitHub repository; it stays there.
- [x] **No Cloudflare, no project servers** (Nov 26, 2026). Devices meet through public signalling networks (Trystero approach), with local-network and manual-code fallbacks. Players on networks that block direct connections switch networks, play locally, or use a relay their group runs. See ADR 0004.

### Assumptions in force

| Topic | Assumption |
| --- | --- |
| Desktop targets | Windows and macOS first-class from Phase 3, the first desktop release (the Phase 1 sheet runs in any modern browser); Linux supported, tested less often |
| Pathfinder edition | Pathfinder 2e Remaster; Starfinder 2e later on the same plugin |
| D&D baseline | 5e 2024 rules via SRD 5.2.1; 2014 rules possible later as a variant |
| Accounts | None. Identity is a key pair on each device |
| Session size | Up to 8 players, 2 observers and 3 displays per session; benchmarked at double that |
| Co-DMs | Data model supports them; interface arrives in Phase 6 |
| Physical play | Physical miniatures and dice are first-class: the DM can mirror miniature positions on the map, and rolls can be entered manually |
| Encryption at rest | Not in v1; Mimic Box recommends the operating system's disk encryption and says what it does and does not protect |
| Event history retention | Kept for the life of the campaign, compactable per session |
| Import formats | PNG, JPEG, WebP, PDF handouts and MP3/OGG audio first; video later |
| Voice and video | Not built; Discord links are an optional integration |

### Sources

- Handoff kit: README\_FIRST, PRODUCT\_BRIEF, CLAUDE.md, ARCHITECTURE, DATA\_MODEL, NETWORKING, REQUIREMENTS, SECURITY, ROADMAP, UX\_WORKFLOWS, TECH\_DECISIONS, OPEN\_QUESTIONS, prompts 00 to 04
- [Trystero](https://github.com/dmotz/trystero): serverless WebRTC matchmaking over Nostr, MQTT and BitTorrent (MIT)
- [D&D SRD 5.2.1](https://dndbeyond.com/srd)
- [Paizo: Pathfinder Infinite and the ORC License](https://paizo.com/blog/pathfinder-infinite-and-the-orc-license)
- Neon Odyssey: [EN World announcement](https://www.enworld.org/goto/post?id=9865783), [ICv2 funding report](https://icv2.com/articles/news/view/62562/neon-odyssey-rrtpg-funding-total-passes-both-cosmere-rpg-dungeon-crawler-carl-rpg), [Popverse feature list](https://www.thepopverse.com/gaming-kickstarter-ttrpg-legends-of-avantris-neon-odyssey)
- [Tauri runtime 2.12.0 release notes](https://v2.tauri.app/release/tauri-runtime/v2.12.0/)
- [str0m](https://docs.rs/str0m) and [webrtc-rs rtc](https://docs.rs/crate/rtc/0.20.0/source/README.md)
- [PixiJS v8](https://pixijs.com/blog/pixi-v8-launches)
