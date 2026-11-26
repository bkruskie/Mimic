# Mimic Box VTT

A free, local-first tabletop roleplaying platform. Players keep their characters on their own devices; the DM's computer hosts the game; nothing costs anything to use or run.

**Status: Phases 1 to 3 done; Phase 4 and combat under way.** A character sheet for D&D 5e (2024 rules, SRD 5.2.1 content) that installs to a phone's home screen and works fully offline, and a first table: the DM hosts a game from a browser page and players join from their sheets with an invite link. The full plan is in [docs/architecture.md](docs/architecture.md).

## What works today

- Build a level 1 character in a guided builder: any SRD class, species and background; standard array, point buy, 4d6 or your own scores; skills, Expertise, Weapon Mastery, Fighting Style, Divine and Primal Orders; starting equipment; cantrips, prepared spells and Magic Initiate.
- A computed sheet: abilities, saves, skills, passive scores, AC, initiative, speed, HP, attacks and spellcasting, with a breakdown of where each number comes from.
- Tap any number to roll it, with Advantage, Disadvantage, damage and critical damage from the result, plus a free dice pad and a roll history.
- Track HP, temporary HP, death saves, conditions, Exhaustion, limited-use features, spell slots and Pact Magic; Short and Long Rests.
- Level up to 20 with average or rolled HP, including multiclassing. New choices (subclass, Ability Score Improvements, Eldritch Invocations, Metamagic, Epic Boons) appear under To do.
- Homebrew: your own features, attacks, subclasses and bonuses, each shown where the numbers are explained.
- Phone, tablet and desktop layouts.
- Play at a DM's table: the DM opens `studio.html`, creates a campaign and shares the invite link or QR code. Players join from their sheet; the DM sees the party's sheets and rolls, can roll in secret, and can open a read-only table display (`display.html`) on a second screen. Devices meet through public Nostr relays and connect directly; nothing is stored on a server.
- The DM can deal damage, heal, give temporary hit points and set conditions on a connected player's sheet; the player is told what changed.
- Maps: the DM adds a battle map image, lines up the grid, reveals squares and places tokens. Players see only revealed squares (the hidden parts are painted over before the picture leaves the DM's device) and drag their own token; anyone can measure distances. The DM can draw walls and doors and have squares revealed as the party explores; players open and close doors next to their token. In combat, the acting token glows on every map. The table display shows the map too.
- Combat: the DM starts a fight with the party, adds creatures (hidden or not) and steps through turns; players roll initiative from their sheet and see when it's their turn.
- Handouts: the DM writes letters and clues in private and shows them to the party and the table display when ready.
- Backups: the DM downloads a campaign file to keep or move to another computer; players back up every character in one file.
- Inventory with equip toggles and SRD item lookup, coins, notes and a portrait.
- Characters live in a vault on the device (IndexedDB), with a trash you can restore from, and export or import as `.mimicbox-character` files.

Not yet: multiclassing, homebrew forms, Pathfinder 2e, Neon Odyssey, and anything that needs a DM or a network.

## Run it

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm dev          # the character sheet at http://localhost:5173
pnpm check        # type check, unit tests, production build
pnpm test:e2e     # builds, then drives the sheet and a hosted game (DM and two players) in Chrome
```

The production build in `apps/companion/dist` is a static site. Host it anywhere (GitHub Pages, any static host, a USB stick); it uses relative paths.

## Repository

```text
apps/companion/          Player app: the character sheet (React, Vite, PWA)
packages/dice/           Dice notation parser and secure roller
packages/ruleset-dnd5e/  D&D 5e (2024) rules engine and the SRD 5.2.1 content pack
packages/local-store/    On-device vault (IndexedDB)
tools/srd-import/        Converts a Markdown copy of the SRD into the content pack
tools/icons/             Renders the app icon to PNG
tests/e2e/               Browser test of the whole character flow
docs/                    Architecture plan and decision records
```

## Content and licences

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode. See [NOTICE.md](NOTICE.md).

Fonts: Fraunces and Atkinson Hyperlegible, both under the SIL Open Font Licence. The app icon and interface icons were drawn for this project.

Mimic Box's own code is under the [MIT licence](LICENSE). The SRD content pack in `packages/ruleset-dnd5e/content` stays under CC-BY-4.0 with its attribution.
