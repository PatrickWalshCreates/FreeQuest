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
| `pnpm check`      | lint + typecheck + test: run before every commit (CI runs this + build)     |
| `pnpm lint`       | ESLint + Prettier check                                                     |
| `pnpm format`     | Prettier write                                                              |
| `pnpm typecheck`  | `tsc` in every package                                                      |
| `pnpm build`      | Build every package to `dist/` and the player app to `apps/player-web/dist` |
| `pnpm gen:schema` | Regenerate `packages/schema/json/*.schema.json` from the TypeBox defs       |
| `pnpm gen:art`    | Regenerate the demo project's placeholder PNGs (deterministic)              |

Run `pnpm check` before committing. CI (`.github/workflows/ci.yml`) is ready but the repo is not on
GitHub yet, so nothing runs it automatically: run it locally.

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
- **Game state** (`GameState`): switches (bool, default false) and variables (safe integers, default
  0), keyed by string ids declared in the manifest. Undeclared ids throw. Lives outside `World` so it
  survives map transfers; `World` takes it as an option.
- **Events**: an event has pages; the active page is the _last_ page whose conditions all hold (none
  → event absent). Commands are a **nested tree** (`if` holds `then`/`else`, `choice` options hold
  their own lists), not a flat indented list. Use `walkCommands` to traverse.
- **Interpreter** (`interpreter.ts`): runs a command tree with an explicit stack of `{commands, index}`
  frames (no generators, so it can be serialized for save/load). `update(dt)` runs until done, a timed
  `wait` (counted down in core), or a **request** it can't satisfy itself: `message`, `choice`,
  `transfer`. The runtime presents the request and answers with `continue()` / `choose(i)` /
  `cancel()`. Every new command that needs the outside world should be a request, not a callback.
  `World.run(commands)` starts the one blocking interpreter; while it runs the player finishes its
  current tile but takes no new steps. Parallel events will get their own interpreters later.
- **Map events at runtime** (`EventInstance`): position, facing, active page. Pages are re-picked only
  when `GameState.version` changes. Events with `layer: "same"` block movement
  (`World.passability` = tiles + blocking events). A page change resets facing to the page graphic,
  except for the event currently running (so an NPC doesn't turn away mid-conversation).
- **Triggers** (all in `World.step`):
  - `action`: confirm while idle → the blocking event ahead, else a non-blocking event underfoot. A
    talked-to NPC with a graphic turns to face the player.
  - `touch`: arriving on a non-blocking event (`MoveHooks.arrived`, fired inside `GridMover.update`
    so chained steps can't skip it), or bumping into a blocking one. Not on the starting tile.
  - `autorun`: first present autorun page runs whenever nothing else is. It must switch itself off
    (e.g. set a switch its page conditions check) or it runs again forever, by design.
  - `parallel`: not implemented yet (needs non-blocking interpreters).
  - An event running at the start of a step owns that step's input: the confirm that closes the last
    message never re-triggers. A newly triggered event runs to its first pause in the same step.
- **Dialog UI** is split into logic and view. `runtime/src/dialog.ts` (`DialogController`) is pure
  (no PixiJS import, unit-tested in Node): text reveal, choice cursor (wraps), confirm/cancel → answers
  the interpreter. `dialog-view.ts` (`DialogView`) only draws its state in screen space. Per fixed
  step the order is `dialog.update` → `world.step` → `input.endStep`, so the dialog consumes the input
  that answers a request. A message stays up until the next request arrives (no flicker between
  messages) and stays visible under a following choice. Text is wrapped before revealing so words
  never jump lines. Font/colors/spacing are a `UiTheme`, overridable via `startGame({ ui })`; the
  default is the system font (no bundled font asset). Not yet in the project format.
- Keep runtime UI logic testable the same way: put state machines in PixiJS-free modules.
- **Plugin API**: typed, hook-based, no monkey-patching of globals or engine classes. Only a stub
  interface exists (`packages/core/src/plugin.ts`); not implemented yet.
- **Dev without builds**: each package's `exports` has a `"@freequest/source"` condition pointing at
  `src/index.ts`. Vite, Vitest and `tsc --noEmit` use it (`customConditions`); `tsconfig.build.json`
  disables it so published `dist/` resolves dependencies' `dist/`.

## Project file format

- Plain JSON, written **only** via `stableStringify` (`packages/schema/src/serialize.ts`): leading keys
  (`formatVersion`, `id`, `type`, `name`, `label`), then other keys alphabetically, then large nested
  blocks (`tiles`, `layers`, `events`, `pages`, `options`, `commands`, `then`, `else`, `data`).
  2-space indent, primitive arrays on one line (so one tile row = one diff line), trailing newline.
  Changing this order rewrites every project file, so don't do it casually. A test asserts the demo
  project is in canonical form.
- One file per map (`data/maps/<id>.json`), per tileset, per character sheet; later one file per
  database category (actors, items, ...). `project.json` is the manifest listing them by id + path.
- Every file has `formatVersion`. Loading = `migrate()` → schema validation (`parseProjectFile`).
  To change a format: bump its `*_FORMAT_VERSION`, add a `Migration` to `MIGRATIONS` in
  `migrations.ts`, add an old-format fixture under `packages/schema/test/fixtures/v<N>/` with a test,
  run `pnpm gen:schema`, and re-save the samples through the migration.
- Current versions: manifest 2 (adds `switches`/`variables`), map 2 (adds `events`), tileset 1,
  character 1.
- Validation layers: JSON Schema (`parseProjectFile`) → per-file structure (`checkMapShape`: layer
  sizes, event ids/bounds, choice cancel index) → cross-file references (`checkReferences`: tilesets,
  maps, characters, switches, variables, transfer targets). The runtime loader runs all three.
- `json/*.schema.json` is generated by `toJsonSchema` (hoists TypeBox's recursive `$defs` to standard
  `#/$defs/...` refs). Tests verify the files are up to date and that ajv validates the demo with them.
- Assets are referenced by project-relative path with `/` separators, never embedded.
- Map layers: `data` is rows of tile indices, `-1` = empty. Tile index `i` in a tileset is column
  `i % columns`, row `floor(i / columns)` of its image.
- Character sheets: one row per direction (`rows` order), `frames` columns, `walkCycle` + `idleFrame`.

## Conventions

- TypeScript strict (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); no `!` non-null
  assertions (lint error), use checked lookups such as `getOrThrow`.
- ESM everywhere; relative imports use `.js` extensions.
- Tests live in `packages/<pkg>/test/*.test.ts`. Core logic changes need tests.
- `demo-quest.test.ts` is the demo's end-to-end script: when you change the demo's events, update
  it so the quest stays completable.
- New packages use the `@freequest/` npm scope. Future CLI command: `freequest`.

## Roadmap

- **M1 (done)**: monorepo + tooling, schema for manifest/tileset/map/character, placeholder art, demo
  map, runtime with map rendering, grid movement with tweening, collision, clamped camera, core tests.
- **M2 (in progress)** Event system. Steps:
  1. ~~Game state (switches/variables), event + command schema, map/manifest v2 migrations~~ (done)
  2. ~~Resumable command interpreter in core; message/choice/transfer are requests the runtime answers~~ (done)
  3. ~~NPCs: event sprites, event collision, action/touch/autorun triggers~~ (done; parallel deferred)
  4. ~~Message box + choice window in runtime~~ (done; system font via swappable `UiTheme`)
  5. ~~Conditionals and switch/variable commands, end to end~~ (done; `core/test/demo-quest.test.ts`
     plays the demo quest through real movement and triggers)
  6. Map transfers: lazy map loading, fade, second demo map (house interior; turn the
     `house-door` event into a transfer)
- **M3** Database: actors, classes, items, skills, enemies, states.
- **M4** Turn-based battle.
- **M5** Menus, save/load, audio.
- **M6** Tauri editor: map editor first, then event and database editors.
- **M7** Export targets: web, desktop.
- **Later**: RPG Maker MZ project importer (reads user's own projects; still clean-room), plugin API.

## Known gaps / notes for next milestones

- **Stopgap:** `transfer` requests are skipped with a console warning in `game.ts` (TODO for step 6).
- Text renders at the internal resolution and is pixel-upscaled; fine for now, revisit (bitmap font
  or high-res UI layer) if legibility suffers at small sizes.
- The runtime loads every map listed in the manifest up front; switch to lazy loading with map transfers (M2).
- Each tile is its own Sprite; fine for small maps, revisit (chunked render textures) for large ones.
- Passability is a single boolean per tile; per-direction passability would be a format migration.
