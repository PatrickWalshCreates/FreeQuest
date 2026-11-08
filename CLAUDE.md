# FreeQuest

A free, open-source (MIT) 2D RPG engine and editor, an alternative to RPG Maker MZ.
Status: pre-alpha. Solo project for now; keep it structured so others can contribute.

## Clean-room rule (non-negotiable)

Never copy RPG Maker code, assets, UI, or data files, and never paste them into this repo or into
prompts. Matching general _behavior_ (grid movement, tile layering, event concepts) is fine; matching
implementation, art, names of internals, or UI layout is not. All art is original (see
`scripts/gen-placeholder-art.ts`).

## Commands

Requires Node >= 22 and pnpm (version pinned in `package.json` `packageManager`).

| Command           | What it does                                                                |
| ----------------- | --------------------------------------------------------------------------- |
| `pnpm install`    | Install everything                                                          |
| `pnpm dev`        | Run apps/player-web with the demo project at http://localhost:5173          |
| `pnpm test`       | Run all unit tests once (Vitest); `pnpm test:watch` to watch                |
| `pnpm lint`       | ESLint + Prettier check                                                     |
| `pnpm format`     | Prettier write                                                              |
| `pnpm typecheck`  | `tsc` in every package                                                      |
| `pnpm build`      | Build every package to `dist/` and the player app to `apps/player-web/dist` |
| `pnpm gen:schema` | Regenerate `packages/schema/json/*.schema.json` from the TypeBox defs       |
| `pnpm gen:art`    | Regenerate the demo project's placeholder PNGs (deterministic)              |

Run `pnpm lint && pnpm typecheck && pnpm test` before committing.

## Layout

```
packages/schema     Project file format: TypeBox definitions (→ TS types + JSON Schema),
                    validation, migrations, stable serializer. Single source of truth.
packages/core       Pure game logic. No rendering, no DOM, no Node APIs. Unit-tested in Node.
packages/runtime    PixiJS v8 player: loads a project folder over HTTP and runs it on core.
apps/player-web     Minimal Vite app that boots runtime with samples/demo-project.
apps/editor         Placeholder only (Tauri editor, milestone 6). Do not build yet.
samples/demo-project  Tiny sample game used for dev and tests.
scripts/            Repo-level tooling (placeholder art generator).
```

Dependency direction: `schema ← core ← runtime ← apps`. Never the other way.

## Architecture principles

- **core never imports runtime, pixi.js, or DOM globals.** Enforced by ESLint
  (`no-restricted-imports`, `no-restricted-globals`) and by core's tsconfig (`lib: ES2023`, no DOM).
- **runtime is a thin view layer.** It reads core state and draws it; it never makes game decisions.
  Anything testable without a canvas belongs in core (e.g. `computeCamera` lives in core).
- **Fixed-timestep loop** (`FixedTimestep`, 60 steps/s) decoupled from render framerate. Runtime
  interpolates between the previous and current logic state using the returned alpha. Long frames are
  clamped (0.25 s) to avoid a spiral of death.
- **Input is actions, not keys**: `up/down/left/right/confirm/cancel/menu`. Runtime maps devices to
  actions (`keyboard.ts`, `DEFAULT_KEY_BINDINGS`); core only sees `InputState`. `justPressed` lasts one
  logic step (`ActionState.endStep()` after each step). The most recently pressed held direction wins.
- **Grid movement**: `GridMover` holds the logical tile (`x`,`y` = destination while moving) and
  tweens `realX`/`realY` at `speed` tiles/s. Holding a direction chains steps with no pause. Blocked
  steps only turn the character.
- **Collision is derived, never stored**: a cell is passable iff it has at least one collidable tile
  and all collidable tiles on it (across all layers) are `passable`. Tiles with `above: true` are drawn
  over characters and ignored for collision. Out-of-bounds is impassable.
- **Plugin API**: typed, hook-based, no monkey-patching of globals or engine classes. Only a stub
  interface exists (`packages/core/src/plugin.ts`); not implemented yet.
- **Dev without builds**: each package's `exports` has a `"@freequest/source"` condition pointing at
  `src/index.ts`. Vite, Vitest and `tsc --noEmit` use it (`customConditions`); `tsconfig.build.json`
  disables it so published `dist/` resolves dependencies' `dist/`.

## Project file format

- Plain JSON, written **only** via `stableStringify` (`packages/schema/src/serialize.ts`): `formatVersion`,
  `id`, `name` first, other keys alphabetical, 2-space indent, primitive arrays on one line (so one tile
  row = one diff line), trailing newline. A test asserts the demo project is in canonical form.
- One file per map (`data/maps/<id>.json`), per tileset, per character sheet; later one file per
  database category (actors, items, ...). `project.json` is the manifest listing them by id + path.
- Every file has `formatVersion`. Loading = `migrate()` → schema validation (`parseProjectFile`).
  To change a format: bump its `*_FORMAT_VERSION`, add a `Migration` to `MIGRATIONS` in
  `migrations.ts`, add a test with an old-format fixture, regenerate JSON Schema, and re-save samples.
- Assets are referenced by project-relative path with `/` separators, never embedded.
- Map layers: `data` is rows of tile indices, `-1` = empty. Tile index `i` in a tileset is column
  `i % columns`, row `floor(i / columns)` of its image.
- Character sheets: one row per direction (`rows` order), `frames` columns, `walkCycle` + `idleFrame`.

## Conventions

- TypeScript strict (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); no `!` non-null
  assertions (lint error), use checked lookups such as `getOrThrow`.
- ESM everywhere; relative imports use `.js` extensions.
- Tests live in `packages/<pkg>/test/*.test.ts`. Core logic changes need tests.
- New packages use the `@freequest/` npm scope. Future CLI command: `freequest`.

## Roadmap

- **M1 (done)**: monorepo + tooling, schema for manifest/tileset/map/character, placeholder art, demo
  map, runtime with map rendering, grid movement with tweening, collision, clamped camera, core tests.
- **M2** Event system: NPCs, message boxes, choices, switches/variables, conditionals, map transfers.
- **M3** Database: actors, classes, items, skills, enemies, states.
- **M4** Turn-based battle.
- **M5** Menus, save/load, audio.
- **M6** Tauri editor: map editor first, then event and database editors.
- **M7** Export targets: web, desktop.
- **Later**: RPG Maker MZ project importer (reads user's own projects; still clean-room), plugin API.

## Known gaps / notes for next milestones

- The runtime loads every map listed in the manifest up front; switch to lazy loading with map transfers (M2).
- Each tile is its own Sprite; fine for small maps, revisit (chunked render textures) for large ones.
- Passability is a single boolean per tile; per-direction passability would be a format migration.
