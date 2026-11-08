# FreeQuest

FreeQuest is a free, open-source (MIT) toolkit for making classic 2D role-playing games, an
alternative to RPG Maker MZ. It is a clean-room implementation: no RPG Maker code, assets or UI are
used.

> **Status: early pre-alpha.** FreeQuest can load a project, walk a character around tile maps,
> talk to NPCs (messages, choices, switches, variables, conditional branches) and move between maps.
> No battles, menus, saving or editor yet. File formats will change.

## What's here

| Package                                        | Purpose                                                     |
| ---------------------------------------------- | ----------------------------------------------------------- |
| [`@freequest/schema`](packages/schema)         | Project file format: TypeScript types + JSON Schema         |
| [`@freequest/core`](packages/core)             | Engine logic (movement, collision, game loop), no rendering |
| [`@freequest/runtime`](packages/runtime)       | PixiJS player that runs a project in the browser            |
| [`apps/player-web`](apps/player-web)           | Minimal web app that plays the demo project                 |
| [`samples/demo-project`](samples/demo-project) | A tiny sample game                                          |

## Running it

You need [Node.js](https://nodejs.org/) 22+ and [pnpm](https://pnpm.io/).

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173. Walk with the arrow keys or WASD, talk with Enter/Space/Z, cancel with
Escape/X. Try the elder by the path and the house door.

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
