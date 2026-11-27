# Interface design rules

Mimic Box should feel like Roll20 at the table and World Anvil in the world: simple and direct during play, deep and explorable when preparing. These rules apply to every screen. A change that breaks one needs a reason written in its pull request.

The first sketches of this direction are on the design canvas "Mimic Box: interface direction" (DM Play mode, a world entry in Prepare mode, a player's journal on a phone).

## Space

1. **No dead space.** Every area of the screen has a job. Empty margins, decorative panels and blank columns are removed, not filled.
2. **The map is the table.** In play, the map takes the largest area on every device. Everything else sits beside it, over it or one tap away, never in front of it for long.
3. **Finished things fold away.** A panel whose work is done shrinks to a line or a pill. For example, the invite becomes "4 of 4 players" once the party is in.
4. **Prepare and play are separate.** Prep tools (world, maps, handouts, backups) never crowd the play screen. Play shows only what a session needs, with prepared items pinned and revealed in one tap.

## Screens and orientation

Every screen is built for all four shapes, and tested at each:

| Shape | Layout |
| --- | --- |
| Phone, portrait | One area at a time, chosen with bottom tabs (Sheet, Map, Journal, Party). The map is one tap away and keeps its zoom and position. |
| Phone, landscape | The map fills the screen; the sheet or other panels slide in from the side over it. |
| Tablet | The map plus one side panel the user can resize or fold away. |
| Laptop, desktop, TV | Map in the middle, panels on one or both sides, all adjustable. The table display uses the whole screen for the map. |

- Panels can be resized and folded, and the app remembers each person's layout on their device.
- Touch targets are at least 44 pixels; nothing depends on hover.
- Text never runs wider than about 80 characters, even on wide screens.

## Controls

1. **Every control earns its place.** A button exists because it does something the person would miss. Rare actions move into menus; actions that belong together merge.
2. **One obvious next step.** Each screen has at most one primary button at a time.
3. **Show the state, not a setting.** Secrets look secret everywhere: content only the DM can see wears a dashed violet outline, so nobody has to read a label to know.
4. **Plain words.** Sentence case, specific verbs, and errors that say what happened and what to do (see CLAUDE.md).

## Depth

1. **The world is pages, not lists.** An entry has a large picture, a trail showing where it sits, and links to other entries.
2. **Players get the same depth for what they know.** Their journal uses the same pages, showing only what has been revealed.

## Later polish

Textured surfaces, themes per game system (warm brass for D&D, deep red and gold for Pathfinder, synthwave for Neon Odyssey) and richer motion come once the structure above is in place. The polish goes on top of the layout rules here; it never adds dead space or buries the map.
