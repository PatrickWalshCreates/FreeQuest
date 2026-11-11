# FreeQuest

FreeQuest is a free, open-source (MIT) toolkit for making classic 2D role-playing games, an
alternative to RPG Maker MZ. It is a clean-room implementation: no RPG Maker code, assets or UI are
used.

> **Status: pre-alpha.** FreeQuest has a desktop editor (maps, events, database, tilesets,
> characters, assets) and exports games for the web and macOS. Games have tile maps, NPCs and
> events (messages, choices, switches, variables, branches, map transfers), a full RPG database
> with a safe formula language, turn-based battles, an in-game menu, save slots, and music and
> sound. File formats may still change (older projects are upgraded automatically).

**New here? Read [Getting started](docs/getting-started.md)**: build the editor and make a small
game in about half an hour.

## What's here

| Package                                          | Purpose                                                     |
| ------------------------------------------------ | ----------------------------------------------------------- |
| [`@freequest/schema`](packages/schema)           | Project file format: TypeScript types + JSON Schema         |
| [`@freequest/core`](packages/core)               | Engine logic (movement, collision, game loop), no rendering |
| [`@freequest/runtime`](packages/runtime)         | PixiJS player that runs a project in the browser            |
| [`@freequest/editor-core`](packages/editor-core) | Editor logic (opening, editing, saving projects), no UI     |
| [`apps/player-web`](apps/player-web)             | Minimal web app that plays the demo project                 |
| [`apps/editor`](apps/editor)                     | The editor (desktop app, also runs in a browser for dev)    |
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
pnpm build:editor-app # builds FreeQuest Editor.app (macOS; needs Rust: https://rustup.rs)
pnpm editor           # or: in the browser at http://localhost:5174, with the sample projects
pnpm editor:desktop   # or: the desktop app in development mode
```

- **Projects**: New project from a template (Starter or Demo), recent projects on the start screen.
- **Assets**: import images and sounds (copied into the project), see where each is used.
- **Tilesets and characters**: cut images into tiles or walking frames, mark walkable and
  drawn-above tiles, preview a character walking.

- **Maps**: paint tiles (pencil, rectangle, fill, eraser, pick), layers, a walkable overlay, and
  new / duplicate / resize / delete maps with their music and random battles.
- **Events**: place NPCs, signs and doors (Events tool, V), with pages, conditions and a command
  list (messages, choices, branches, battles, transfers…).
- **Database**: actors, classes, skills, items, equipment, states, enemies, troops and system
  settings, with formulas checked as you type.
- **Play** runs the game with your unsaved changes; **Play from here** starts on any cell.
- Copy and paste commands, events and database entries, also between projects; pick a door's
  destination on the map.
- Undo/redo (⌘Z / ⇧⌘Z) for everything, problems listed as you work, and ⌘S saves.

### Exporting a game

In the editor, **Export…** checks the game and exports it as a web game (upload the folder to
itch.io or any web host) or, on a Mac, as an app. The same works from the command line:

```sh
pnpm build                                          # once: builds the player games run in
pnpm freequest check samples/demo-project
pnpm freequest export web samples/demo-project --out ../my-game-web
pnpm build:mac-player                               # once, needs Rust: the Mac player app
pnpm freequest export mac samples/demo-project --out ../my-game-mac
```

See [docs/exporting.md](docs/exporting.md) for uploading to itch.io and sharing Mac apps.

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

Done: events and NPCs, database, battles, menus/saves/audio, the desktop editor, web and macOS
export, and the editor workflow (templates, assets, tileset and character editors, copy/paste).
Next candidates: parallel events and move routes, shops, an options screen, Windows/Linux builds,
and a plugin API. See [CLAUDE.md](CLAUDE.md) for details.

## License

[MIT](LICENSE)
