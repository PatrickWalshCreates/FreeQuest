# FreeQuest

FreeQuest is a free, open-source (MIT) toolkit for making classic 2D role-playing games, an
alternative to RPG Maker MZ. It is a clean-room implementation: no RPG Maker code, assets or UI are
used.

> **Status: early pre-alpha.** FreeQuest can load a project, walk a character around tile maps,
> talk to NPCs (messages, choices, switches, variables, conditional branches), move between maps,
> and has a full RPG database (heroes, classes, skills, items, equipment, states, enemies) with a
> safe formula language for damage, turn-based battles (random encounters and scripted fights), an
> in-game menu, save slots, and music and sound. No editor yet. File formats will change.

## What's here

| Package                                          | Purpose                                                     |
| ------------------------------------------------ | ----------------------------------------------------------- |
| [`@freequest/schema`](packages/schema)           | Project file format: TypeScript types + JSON Schema         |
| [`@freequest/core`](packages/core)               | Engine logic (movement, collision, game loop), no rendering |
| [`@freequest/runtime`](packages/runtime)         | PixiJS player that runs a project in the browser            |
| [`@freequest/editor-core`](packages/editor-core) | Editor logic (opening, editing, saving projects), no UI     |
| [`apps/player-web`](apps/player-web)             | Minimal web app that plays the demo project                 |
| [`apps/editor`](apps/editor)                     | The editor (desktop app, work in progress)                  |
| [`samples/demo-project`](samples/demo-project)   | A tiny sample game                                          |

## Running it

You need [Node.js](https://nodejs.org/) 22+ and [pnpm](https://pnpm.io/).

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173 and press a key to start (browsers only allow sound after a key press).

| Key               | Action                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| Arrow keys / WASD | Walk, move cursors                                                         |
| Enter / Space / Z | Talk, confirm                                                              |
| Escape / X        | Cancel; on the map, open the menu (items, skills, equipment, status, save) |
| C / Tab           | Open the menu                                                              |
| F9                | Debug panel (development builds): party, inventory, switches, variables    |

Try the elder by the path, the house door, and the bridge. Saves are kept in your browser.

### The editor

```sh
pnpm editor           # in the browser at http://localhost:5174, with the sample projects
pnpm editor:desktop   # as a desktop app; needs Rust (https://rustup.rs)
```

- **Maps**: paint tiles (pencil, rectangle, fill, eraser, pick), layers, a walkable overlay, and
  new / duplicate / resize / delete maps with their music and random battles.
- **Events**: place NPCs, signs and doors (Events tool, V), with pages, conditions and a command
  list (messages, choices, branches, battles, transfers…).
- **Database**: actors, classes, skills, items, equipment, states, enemies, troops and system
  settings, with formulas checked as you type.
- **Play** runs the game with your unsaved changes; **Play from here** starts on any cell.
- Undo/redo (⌘Z / ⇧⌘Z) for everything, problems listed as you work, and ⌘S saves.

### Exporting a game

```sh
pnpm build                                                     # once: builds the player games run in
pnpm freequest check samples/demo-project                      # list any problems
pnpm freequest export web samples/demo-project --out ../my-game-web
```

The web export is a folder to upload to any static host (itch.io works); `index.html` starts the
game. It has to be served by a web server, so double-clicking `index.html` won't work.

On a Mac, games can also be exported as an app (needs Rust once, to build the player app):

```sh
pnpm build:mac-player
pnpm freequest export mac samples/demo-project --out ../my-game-mac
```

The app plays offline and keeps saves as files. It's signed ad-hoc, not with an Apple developer ID,
so players open it the first time with right-click → Open.

Other commands: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.

## Project files

A FreeQuest project is a folder of plain, human-readable JSON plus image files. It's designed to
diff cleanly in git:

```
my-game/
  project.json                 # manifest
  data/maps/map001.json        # one file per map
  data/tilesets/overworld.json
  data/characters/hero.json
  assets/...                   # images, referenced by relative path
```

Every file carries a `formatVersion` so older projects can be migrated automatically. JSON Schemas
live in [`packages/schema/json`](packages/schema/json).

## Roadmap

Events and NPCs → database (actors, items, skills, ...) → turn-based battles → menus, saving and
audio → desktop editor (Tauri) → web/desktop export. See [CLAUDE.md](CLAUDE.md) for details.

## License

[MIT](LICENSE)
