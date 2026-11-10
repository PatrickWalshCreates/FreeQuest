# FreeQuest

A free, open-source (MIT) 2D RPG engine and editor, an alternative to RPG Maker MZ.
Status: pre-alpha. Solo project for now; keep it structured so others can contribute.

## Clean-room rule (non-negotiable)

Never copy RPG Maker code, assets, UI, or data files, and never paste them into this repo or into
prompts. Matching general _behavior_ (grid movement, tile layering, event concepts) is fine; matching
implementation, art, names of internals, or UI layout is not. All art is original (see
`scripts/gen-placeholder-art.ts`).

## Commands

Requires Node >= 22 and pnpm (version pinned in `package.json` `packageManager`). The desktop
editor also needs a Rust toolchain (stable) and, on macOS, Xcode command line tools; nothing else
in the repo does.

| Command               | What it does                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `pnpm install`        | Install everything                                                          |
| `pnpm dev`            | Run apps/player-web with the demo project at http://localhost:5173          |
| `pnpm editor`         | Run the editor in a browser at http://localhost:5174 (opens samples/)       |
| `pnpm editor:desktop` | Run the editor as the Tauri desktop app (needs Rust; see below)             |
| `pnpm test`           | Run all unit tests once (Vitest); `pnpm test:watch` to watch                |
| `pnpm check`          | lint + typecheck + test: run before every commit (CI runs this + build)     |
| `pnpm lint`           | ESLint + Prettier check                                                     |
| `pnpm format`         | Prettier write                                                              |
| `pnpm typecheck`      | `tsc` in every package                                                      |
| `pnpm build`          | Build every package to `dist/` and the player app to `apps/player-web/dist` |
| `pnpm gen:schema`     | Regenerate `packages/schema/json/*.schema.json` from the TypeBox defs       |
| `pnpm gen:art`        | Regenerate the demo project's placeholder PNGs (deterministic)              |
| `pnpm gen:audio`      | Regenerate the demo's music and sound effects (deterministic 8-bit WAV)     |

Run `pnpm check` before committing. CI (`.github/workflows/ci.yml`) is ready but the repo is not on
GitHub yet, so nothing runs it automatically: run it locally.

## Layout

```
packages/schema     Project file format: TypeBox definitions (→ TS types + JSON Schema),
                    validation, migrations, stable serializer. Single source of truth.
packages/core       Pure game logic. No rendering, no DOM, no Node APIs. Unit-tested in Node.
packages/runtime    PixiJS v8 player: loads a project folder over HTTP and runs it on core.
packages/editor-core  Editor logic: ProjectFs, opening projects, edits, undo/redo, saving. No UI.
apps/player-web     Minimal Vite app that boots runtime with samples/demo-project.
apps/editor         React editor; Tauri 2 desktop shell in src-tauri/ (M6, in progress).
samples/demo-project  Tiny sample game used for dev and tests.
scripts/            Repo-level tooling (placeholder art generator).
```

Dependency direction: `schema ← core ← runtime ← apps`, and `schema ← editor-core ← apps/editor`.
Never the other way.

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

### Menus, saves and audio (M5)

- **Game modes** (`runtime/src/game.ts`): the game boots to the title (`TitleController`: New Game,
  Continue = newest save, Load). On the map, Escape or C opens the menu (`MenuController`) when no
  event, transfer, movement or pending encounter is in progress; the world doesn't step while it's
  open. Quit and game over return to the title. Controllers are PixiJS-free and tested; views
  (`TitleView`, `MenuView`, shared `ListWindow`) only draw and rebuild Text only on change.
- **Menu**: Items, Skills (out-of-battle skills), Equipment (through the bag), Status, Save (3
  slots), Quit. Feedback lines reuse the battle log's wording (`describeEvent`).
- **Saves** (`schema/src/save.ts`, `SaveFile` v1): game name, timestamp, play time, map/position,
  switches/variables, party data, and a slot summary. `World.toSave()` refuses while an event runs
  (so no interpreter state is ever saved); `World.fromSave()` rebuilds a world (the save's map must
  be loaded first). Undeclared switches/variables are dropped on load. `SaveStore` keeps slots in any
  `KeyValueStorage` (localStorage by default, `MemoryStorage` otherwise), namespaced per game; it
  reads through migrate + validate and reports damaged or foreign saves as broken slots.
- **Audio**: `system.json` `audio` (title/battle/victory/game-over music + engine sounds), map
  `music`, `playMusic`/`playSound` commands. Core decides _what_ plays: `World.music` (event
  override until the next map change, else the map's) and `World.drainSounds()`. Runtime decides
  _when_: `musicFor(scene, …)` and `uiSoundFor(input, menu)` (DOM-free, tested), and `AudioPlayer`
  (Web Audio) crossfades music, starts on the first key press (browser autoplay rules), and ignores
  missing files after a warning. A demo test checks every referenced image/audio file exists.
- **Testing in the browser pane**: when the pane is hidden, requestAnimationFrame doesn't fire, so
  drive the game with `freequest.app.ticker.update(t)` from the console instead of real-time waits.
- **Debug panel** (dev builds, F9): HTML overlay from `runtime/src/debug-text.ts` (DOM-free,
  tested) + `debug-panel.ts`. Enabled via `startGame({ debug: true })`.
- **Plugin API**: typed, hook-based, no monkey-patching of globals or engine classes. Only a stub
  interface exists (`packages/core/src/plugin.ts`); not implemented yet.
- **Dev without builds**: each package's `exports` has a `"@freequest/source"` condition pointing at
  `src/index.ts`. Vite, Vitest and `tsc --noEmit` use it (`customConditions`); `tsconfig.build.json`
  disables it so published `dist/` resolves dependencies' `dist/`.

### Editor (M6)

- **Split like the runtime**: `packages/editor-core` holds everything testable (no DOM, no React,
  no Tauri, no Node APIs); `apps/editor` (React 19) only draws editor-core state and forwards
  clicks. React was chosen for contributor familiarity; no UI library, plain CSS with tokens in
  `styles.css`. The editor's look is our own (clean-room rule covers UI layout too).
- **`ProjectFs`** is the only way the editor touches files: `readText` (rejects with
  `FileNotFoundError`), `writeText`, `remove`, `list(dir)` (recursive, sorted), `assetUrl`. Every implementation runs paths through
  `normalizeProjectPath` (relative, `/`, no `..`), so project data can't escape its folder.
  Implementations: `TauriFs` (desktop; fs plugin, folders from the open dialog are the only scope;
  assets as blob URLs), `DevServerFs` (browser dev; `dev-fs-plugin.ts` is a `vite dev`-only
  middleware confined to `samples/`), `MemoryFs` (tests).
- **`openProject(fs)`** reads every file (all maps, unlike the lazy runtime loader), keeps going
  past broken files (`ProjectFile.data` null + `problems`), flags older formats (`migrated`), and
  runs cross-file checks (`checkReferences`, `checkDatabase`) only when every file loaded. Only an
  unreadable `project.json` throws (`ProjectOpenError`).
- **`ProjectDocument`** (`document.ts`) is the open project being edited. File data is immutable:
  `doc.update(path, kind, label, fn)` replaces a file's data with `fn(data)` (sharing unchanged
  parts; returning the same object is a no-op), so history entries are before/after references,
  "dirty" is `data !== saved`, and undoing to the saved state makes a file clean. `coalesce` keys
  merge edits into one undo step until `endCoalescing()` (a paint stroke, typing in a field); a
  merged step that ends equal to its start (structural compare) is dropped. 200 undo steps.
  `doc.project` is the current `OpenedProject` view (problems rechecked per version);
  `subscribe`/`version` feed React's `useSyncExternalStore` (`use-document.ts`).
- **Transactions**: `doc.edit(label, (tx) => …)` is one undo step across files; `tx.update`,
  `tx.create`, `tx.remove` (reads via `tx.file` see pending changes; a throw rolls everything
  back). History uses an internal ABSENT marker for files that don't exist, so creating and
  deleting files undo like any edit. `update()` is a one-file transaction.
- **Map operations** (`map-ops.ts`): `createMap` (ids `map001`…, files in `data/maps/`, ground
  filled with one tile + empty `upper` layer), `duplicateMap`, `deleteMap` (never the start map;
  `mapUsages` lists transfers into it for the warning), `resizeMap`/`applyResize` with a 9-way
  anchor: new ground repeats edge tiles, events that fall off are reported, and when content
  moves every transfer into the map (any map, via schema's `mapCommands`) and the start position
  move with it. Maps are capped at `MAX_MAP_SIZE` (256) while each cell is a sprite.
- **Saving** writes only dirty files via `stableStringify`, data files before `project.json`, then
  deletes removed files (so the manifest never lists a missing file), one
  save at a time (an idle save snapshots immediately; edits made during a save stay dirty). Files
  in an older format start dirty and are upgraded on save. A dirty file failing the schema blocks
  the whole save (`SaveBlockedError`, nothing written); other problems (shape, references,
  database) are only reported, so work is never stuck unsaved.
- **Edit helpers** are pure functions over file data, e.g. `setTiles(map, layer, cells)` in
  `map-edits.ts`; add new ones there (tested), not in React components.
- **UI conventions**: Cmd/Ctrl+S, Z, Shift+Z (and Ctrl+Y) are global, text fields included, so undo
  always means the document's history. Closing, reloading or quitting with unsaved changes asks
  first (`confirmDiscard`, `guardWindowClose`; Tauri needs `dialog:allow-ask` and
  `core:window:allow-destroy` for that).
- **Map view** (`apps/editor/src/map/`): `MapRenderer` (PixiJS, ticker off: it renders on
  demand after each change) keeps one sprite per cell per layer and redraws only rows whose array
  changed (immutable data again), reusing runtime's `sliceGrid` and `CharacterView`. Images load
  through `ProjectFs.assetUrl` into an `<img>` (`graphics.ts`), not PixiJS `Assets`, which can't
  read blob URLs. Zoom/scroll math is `editor-core/viewport.ts` (tested); `MapCanvas` turns
  wheel/drag into callbacks, `MapEditor` holds view state (zoom, layers, grid, palette
  selection), `TilePalette` is plain DOM. Wheel scrolls, Ctrl/pinch zooms, `=`/`-`/`0`/`G` keys.
  PixiJS `pixelLine` strokes don't render here: hairlines use `width: 1 / zoom` and are redrawn
  on zoom changes. Dev builds expose `window.mapRenderer` for console inspection.
- **Painting tools** (`editor-core/tools.ts`, tested): `lineCells` (Bresenham, so fast drags
  leave no gaps), `rectCells`, `floodCells` (4-neighbour, same tile, one layer). A `TileStroke`
  is one press–drag–release and one undo step (its own coalesce key): pencil/eraser paint as
  the pointer moves, rectangle previews until release, fill acts on press, eyedropper only
  reads. `cancel()` (Escape) undoes the stroke's own step only. Pointer roles in `MapCanvas`:
  left = tool, right or Alt = pick, middle or Space+drag = scroll. Keys B/R/F/E/I pick tools,
  W toggles the walkable overlay, which is `core`'s `CollisionMap` (tiles only, not events).
- Browser-pane note: the pane's page is 1024×768 but screenshots are 800×600, so convert
  screenshot coordinates (×1.28) before reasoning about map cells; synthetic `PointerEvent`s
  work for gestures the click tools can't do (e.g. Escape mid-drag).
- **Rust stays minimal**: `src-tauri` only registers the dialog and fs plugins; permissions in
  `capabilities/default.json`. Release CSP is strict; `devCsp` is off so Vite's dev scripts run.
- **Testing**: editor-core in Vitest; the UI in the browser pane via `pnpm editor` (same code as
  the desktop app minus `TauriFs`). The app icon is generated (`pnpm --filter @freequest/editor
gen:icon`).

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
  map 5 (v3: party commands/conditions; v4: `encounters`, `battle` command; v5: `music`,
  `playMusic`/`playSound`), tileset 1, character 1, every database file 3 (v2: combat modifiers,
  troops, system attack/guard skills; v3: system `audio`), save 1. Additive bumps migrate as no-ops.
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
- **M5 (done)** Title screen, in-game menu (items, skills, equipment, status, save, quit), three
  save slots in localStorage with a versioned save format, music and sound (format, core cues, Web
  Audio player, generated chiptune assets).
  - Deferred: options screen (volume, key rebinding), item/skill icons, shops, saving mid-event,
    file-based saves for desktop builds (M7), formation/reordering the party.
- **M6** Tauri editor: map editor first, then event and database editors. Steps:
  1. ~~Scaffold: Tauri 2 + React app, `ProjectFs` (desktop/dev server/memory), open a project,
     browse its files and problems~~ (done)
  2. ~~Editing engine in editor-core: edit operations, undo/redo, dirty tracking, save via
     `stableStringify` with the load-time checks~~ (done; names editable in the UI to exercise it)
  3. ~~Map view: map drawn with the runtime's renderer, layers, grid, zoom/pan, tile palette~~
     (done; drag pans until step 4 gives the left button to the tools)
  4. ~~Painting tools: pencil, rectangle, fill, eraser, eyedropper, layer choice, passability
     overlay~~ (done; single-tile brush, multi-tile stamps later)
  5. ~~Map management: new/rename/resize/delete maps, map properties (tileset, music,
     encounters)~~ (done; map ids are generated and not renamable yet; the music picker lists
     audio under `assets/`)
  6. Playtest from the editor with unsaved edits
  7. Event editor: place/move events, pages, conditions, graphic, trigger, nested command editor
  8. Database editor: all categories, forms generated from the TypeBox schemas
- **M7** Export targets: web, desktop.
- **Later**: RPG Maker MZ project importer (reads user's own projects; still clean-room), plugin API.

## Known gaps / notes for next milestones

- Text renders at the internal resolution and is pixel-upscaled; fine for now, revisit (bitmap font
  or high-res UI layer) if legibility suffers at small sizes.
- No `freequest check` CLI yet: until then, `schema.test.ts` is what validates every demo file together.
- Each tile is its own Sprite; fine for small maps, revisit (chunked render textures) for large ones.
- Passability is a single boolean per tile; per-direction passability would be a format migration.
