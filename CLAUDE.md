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
- **Maps change in place**: `World.changeMap(map, tileset, x, y, direction?)` swaps map, collision and
  events (fresh `EventInstance`s) but keeps the player, `GameState` and the running interpreter, so an
  event can transfer and keep going. The runtime rebuilds its map scene when `world.map` changes.
- **Transfers** (`runtime/src/transfer.ts`, `TransferController`, PixiJS-free): on a `transfer`
  request it fades out while loading the target map, swaps it in, fades in, then answers _only that
  request_. Loading holds on black; a failed load or invalid target is reported via `onError`, the
  map stays, and the event continues.
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

### Database and battlers (M3)

- **Formulas** are FreeQuest's own expression language, never JavaScript. Grammar and validation in
  `schema/src/formula.ts` (`parseFormula`, `checkFormula`), evaluation in `core/src/formula.ts`
  (`evaluateFormula`, cached by source). Numbers only; comparisons/logic yield 1/0; `a.<stat>`,
  `b.<stat>` (also `hp`, `mp`, `level`), `v.<id>` / `v["id"]`; functions min, max, abs, floor, ceil,
  round, clamp, random. Division by zero and non-finite results give 0. Length/nesting are capped.
  `checkDatabase` validates every formula at load time.
- **Modifiers** are the one way anything changes a battler (class, actor, equipment, state, enemy):
  statRate, statFlat, elementRate, stateRate, attackElement, equipType, hpRegen. Stat =
  `max(0, round((base + Σflat) × Πrate))`, max HP ≥ 1. Allowed equipment types come only from the
  actor's and class's modifiers. Add new behaviours as new modifier types, not one-off fields.
- **Effects** (damage, recover, addState, removeState, learnSkill) are shared by skills and items and
  run in order per target (`core/src/effects.ts`). Damage = formula × element rate (`element:
"attack"` = user's best attack element) × variance, 5% crit ×3, never negative. Recover heals.
  State chance × target `stateRate`. Damage may remove states with `damageChance` (sleep).
- **Battler** (`battler.ts`) is shared by `Actor` and `Enemy`: HP/MP clamped; 0 HP adds the
  `knockout: true` state; removing knockout revives at ≥1 HP (so "remove knockout, recover 25%"
  yields 1 + 25%). States sorted by priority, count down by battle turn (`tickTurn`) or map step.
- **Party** (`party.ts`): members, gold (≤ 99,999,999), separate item/equipment bags (≤ 99 each),
  equip/unequip through the bag. Every map step calls `party.onStep()`; poison/regen ticks every 20
  steps and can't knock out on the map. `Party.version` (like `GameState.version`) drives page
  refresh. `Actor.toData()` / `Party.toData()` are plain JSON for save files (M5).
- Events see an `EventContext { state, party }`; conditions/commands that need the party throw a
  clear error without one. Functions taking a context also accept a bare `GameState`.
- The runtime loads the whole database up front (`project.database`) and runs `checkDatabase`.

### Battles (M4)

- **Engine** (`core/src/battle.ts`, `Battle`): front `MAX_BATTLE_MEMBERS` (4) party members vs a
  troop. The player sets an action per commandable actor (`actorsToCommand`: alive, can act, not
  confused); `runTurn()` resolves everyone in speed order (agility + random up to agility/4+1; the
  system Guard skill always first; party wins ties) and returns `BattleEvent[]`. Fallen targets are
  replaced by the next valid one; enemies pick random targets (`Enemy.chooseAction` weights by
  rating); confused battlers attack anyone. End of turn: regen/poison (can knock out in battle) and
  turn countdowns. Escape = 0.5 × party/enemy average agility + 0.1 per failed try; failing gives
  the enemies a free turn. Victory: full exp to every standing actor, gold, rolled drops; battle-end
  states clear. Everything takes an injected `random` for tests.
- **Combat rates**: physical hit = successRate × hitRate (0.95 base) − evasionRate (0.05 base);
  crit = criticalRate (0.04 base); HP damage × `damageTaken`; self-targeted uses never miss. All
  are modifiers. Guard is data: the guard skill adds a 1-turn `guarding` state with damageTaken 0.5.
- The system `attackSkill` / `guardSkill` are always usable by actors (not in `Actor.skills`).
- **Starting battles**: the `battle` command is an interpreter request answered with
  `finishBattle('win' | 'escape' | 'lose')`, which runs `onWin` / `onEscape` / `onLose`. Maps with
  `encounters` count steps (0.5–1.5 × average); `World.takeEncounter()` hands the troop over once and
  the player waits meanwhile. A step that triggers an event never also starts a fight.
- **Runtime**: `BattleFlow` (PixiJS-free) picks up battle requests and encounters, fades out while
  `prepare` loads enemy images, runs the `BattleController` (menus, targets, log playback; tested
  in Node), fades back, hands the outcome to the event, or shows game over (losing an encounter, or
  an event battle with `canLose: false`). Game over → confirm → `newGame()` builds a fresh World in
  place. `BattleView` only draws (rebuilds Text only when content changes).
- PixiJS v8 `Text` objects share the `TextStyle` they're given: clone before changing a style.
- **Debug panel** (dev builds, F9): HTML overlay from `runtime/src/debug-text.ts` (DOM-free,
  tested) + `debug-panel.ts`. Enabled via `startGame({ debug: true })`.
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
- Current versions: manifest 4 (v3: `database` paths, `start.party`/`start.gold`; v4: troops file),
  map 4 (v3: party commands/conditions; v4: `encounters`, `battle` command), tileset 1, character 1,
  every database file 2 (v2: combat modifiers, troops, system attack/guard skills). Additive bumps
  migrate as no-ops.
- Database: one file per category under `data/database/` (`system`, `actors`, `classes`, `skills`,
  `items`, `equipment`, `states`, `enemies`), each `{ formatVersion, entries: [...] }` except
  `system.json` (type lists: elements, equipment slots/types, skill types, currency, iconset). Missing
  files are empty categories. Ids are strings. Stat growth is a level curve (`{ "1": 450, "99": 9000 }`,
  linear between points, must include level 1); exp needed for level L = `round(base × (L−1)^exponent)`.
- Integer object keys serialize in numeric order (so level curves read 1, 5, 10, 99).
- Validation layers: JSON Schema (`parseProjectFile`) → per-file structure (`checkMapShape`: layer
  sizes, event ids/bounds, choice cancel index) → cross-file references (`checkReferences`: tilesets,
  maps, characters, switches, variables, transfer targets).
- Maps load lazily: `loadProject` fetches the manifest, tilesets, characters and the start map;
  `project.loadMap(id)` fetches others on first use (cached) and runs `checkMapShape` +
  `checkMapReferences` on each. A transfer target's bounds are only checkable once its map is loaded,
  so whole-project validation (`checkReferences`) lives in tests (`schema.test.ts` runs it on the
  demo) and later the `freequest` CLI.
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
- **M2 (done)** Event system. Steps:
  1. ~~Game state (switches/variables), event + command schema, map/manifest v2 migrations~~ (done)
  2. ~~Resumable command interpreter in core; message/choice/transfer are requests the runtime answers~~ (done)
  3. ~~NPCs: event sprites, event collision, action/touch/autorun triggers~~ (done; parallel deferred)
  4. ~~Message box + choice window in runtime~~ (done; system font via swappable `UiTheme`)
  5. ~~Conditionals and switch/variable commands, end to end~~ (done; `core/test/demo-quest.test.ts`
     plays the demo quest through real movement and triggers)
  6. ~~Map transfers: lazy map loading, fade, second demo map~~ (done; house interior via the door)
  - Deferred from M2: `parallel` trigger (non-blocking interpreters), moving NPCs / move routes.
- **M3 (done)** Database: actors, classes, skills, items, equipment, states, enemies; formula
  language; battler model; party/inventory/equipment; effects engine; enemy battlers; party event
  commands/conditions; demo rewards, Mira joining, resting hearth; F9 debug panel.
  - Deferred to M5: menus to use items/skills/equipment, icons/iconset art.
- **M4 (done)** Turn-based battle: troops, combat modifiers, battle engine, battle screen
  (controller + view), random encounters, event battles with outcome branches, transitions, game
  over and new game; demo enemy art, meadow encounters, wolf ambush at the bridge.
  - Deferred: enemy action conditions (e.g. "below 50% HP"), battle animations/effects art,
    battle music (M5), multi-row/positioned troop layouts, a "can lose" recovery rule.
- **M5** Menus, save/load, audio.
- **M6** Tauri editor: map editor first, then event and database editors.
- **M7** Export targets: web, desktop.
- **Later**: RPG Maker MZ project importer (reads user's own projects; still clean-room), plugin API.

## Known gaps / notes for next milestones

- Text renders at the internal resolution and is pixel-upscaled; fine for now, revisit (bitmap font
  or high-res UI layer) if legibility suffers at small sizes.
- No `freequest check` CLI yet: until then, `schema.test.ts` is what validates every demo file together.
- Each tile is its own Sprite; fine for small maps, revisit (chunked render textures) for large ones.
- Passability is a single boolean per tile; per-direction passability would be a format migration.
