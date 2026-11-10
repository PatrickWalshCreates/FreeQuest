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

### The editor (work in progress)

```sh
pnpm editor           # in the browser at http://localhost:5174, with the sample projects
pnpm editor:desktop   # as a desktop app; needs Rust (https://rustup.rs)
```

So far it opens a project and lists its maps, tilesets, characters and database, with any problems
found. Map painting comes next.

Try the elder by the path, the house door, and the bridge. Saves are kept in your browser.

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
