# FreeQuest

A free, open-source (MIT) 2D RPG engine and editor, an alternative to RPG Maker MZ.
Status: 0.1.0 released (2026-11-11), early days. Solo project for now; keep it structured so others can contribute.

## Clean-room rule (non-negotiable)

Never copy RPG Maker code, assets, UI, or data files, and never paste them into this repo or into
prompts. Matching general _behavior_ (grid movement, tile layering, event concepts) is fine; matching
implementation, art, names of internals, or UI layout is not. All art is original (see
`scripts/gen-placeholder-art.ts`).

## Commands

Requires Node >= 22 and pnpm (version pinned in `package.json` `packageManager`). The desktop
editor also needs a Rust toolchain (stable) and, on macOS, Xcode command line tools; nothing else
in the repo does.

| Command                 | What it does                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm install`          | Install everything                                                                                    |
| `pnpm dev`              | Run apps/player-web with the demo project at http://localhost:5173                                    |
| `pnpm editor`           | Run the editor in a browser at http://localhost:5174 (opens samples/)                                 |
| `pnpm editor:desktop`   | Run the editor as the Tauri desktop app (needs Rust; see below)                                       |
| `pnpm freequest …`      | The `freequest` CLI from source: `check [project]`, `export web\|mac [project] --out <dir> [--clean]` |
| `pnpm build:mac-player` | Build the desktop player for this system into `apps/player-desktop/dist/<system>` (Rust)              |
| `pnpm build:editor-app` | Build everything, then `FreeQuest Editor.app` at `apps/editor/dist-app/macos/` (ad-hoc signed)        |
| `pnpm test`             | Run all unit tests once (Vitest); `pnpm test:watch` to watch                                          |
| `pnpm check`            | lint + typecheck + test: run before every commit (CI runs this + build)                               |
| `pnpm lint`             | ESLint + Prettier check                                                                               |
| `pnpm format`           | Prettier write                                                                                        |
| `pnpm typecheck`        | `tsc` in every package                                                                                |
| `pnpm build`            | Build every package to `dist/` and the player app to `apps/player-web/dist`                           |
| `pnpm gen:schema`       | Regenerate `packages/schema/json/*.schema.json` from the TypeBox defs                                 |
| `pnpm gen:art`          | Regenerate the demo project's placeholder PNGs (deterministic)                                        |
| `pnpm gen:audio`        | Regenerate the demo's music and sound effects (deterministic 8-bit WAV)                               |
| `pnpm gen:templates`    | Regenerate `templates/starter` (New project's Starter template) from the demo's assets                |
| `pnpm build:site`       | Build the website (landing page, guides, playable demo) into `site-dist/`; needs `pnpm build` first   |
| `pnpm gen:notices`      | Regenerate the third-party licence notices shipped with the editor, the player and exports            |
| `pnpm version:set [v]`  | Set FreeQuest's version (root `package.json`) and write it into every other versioned file            |

Run `pnpm check` before committing. The repo is public on GitHub
(`PatrickWalshCreates/FreeQuest`); CI (`.github/workflows/ci.yml`) runs on every push and pull
request, and `release.yml` builds the downloads (see Versions and releases).

## Layout

```
packages/schema     Project file format: TypeBox definitions (→ TS types + JSON Schema),
                    validation, migrations, stable serializer. Single source of truth.
packages/core       Pure game logic. No rendering, no DOM, no Node APIs. Unit-tested in Node.
packages/runtime    PixiJS v8 player: loads a project folder over HTTP and runs it on core.
packages/editor-core  Editor logic: ProjectFs, opening projects, edits, undo/redo, saving, export. No UI.
packages/player     The release player page exported games run in (built once; exporters copy dist/).
packages/cli        The `freequest` command (check, export) on top of editor-core; Node only.
apps/player-desktop The desktop player app ("shell"): Tauri around packages/player; Mac exports copy it.
apps/player-web     Minimal Vite app that boots runtime with samples/demo-project.
apps/editor         React editor; Tauri 2 desktop shell in src-tauri/.
samples/demo-project  Tiny sample game used for dev and tests.
templates/starter   New project's Starter template (generated by scripts/gen-templates.ts).
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
  current tile but takes no new steps. Parallel pages get their own interpreters (see Triggers).
- **Maps change in place**: `World.changeMap(map, tileset, x, y, direction?)` swaps map, collision and
  events (fresh `EventInstance`s) but keeps the player, `GameState` and the running interpreter, so an
  event can transfer and keep going. The runtime rebuilds its map scene when `world.map` changes.
- **Transfers** (`runtime/src/transfer.ts`, `TransferController`, PixiJS-free): on a `transfer`
  request it fades out while loading the target map, swaps it in, fades in, then answers _only that
  request_. Loading holds on black; a failed load or invalid target is reported via `onError`, the
  map stays, and the event continues.
- **Moving events** (`World.moveEvents`): a page's optional `movement` (`random` or `approach`,
  `speed` tiles/s, `pause` s between steps; random pauses vary 0.5–1.5×) walks the event's own
  `GridMover` (`EventInstance.mover`; `x`/`y`/`direction` read through it). Events finish their
  tile, then pause; the event whose commands run stands still. Approach closes the longer gap
  first, tries the other axis, and sidesteps a lone obstacle when in line. A blocking event
  `occupies` its tile and, while walking, the one it's leaving (the player does too), so no two
  characters overlap; moving events never enter impassable tiles, blocking events or (when
  blocking) the player. A blocking touch event that walks into the player starts its commands
  (chasers). Positions aren't saved: events start from their placed tiles on map load.
  `EventViews` interpolates them like the player (`remember()` before each logic step).
- **Move routes** (`schema/route.ts`, `core/route.ts`): steps `move` / `turn` (fixed or
  `forward`, `around`, `random`, `toward-player`, `away-from-player`, worked out when the step
  runs), `wait`, `speed`. `RouteRunner` walks any `GridMover`: one move per update at most (a
  repeating route of turns can't spin), blocked moves wait or are skipped, an optional pause
  after each move. The `moveRoute` command (target `player`, `this` = the event running it,
  or an event id) goes through `EventContext.routes` (`RouteHost`, the world) and returns a
  "finished" check the interpreter waits on (`wait`, not with `repeat`; `checkMapShape`
  rejects both, and unknown targets). A command route replaces the event's own movement while
  it runs (also for the running event; the target's page speed is the starting speed, events
  default to 3 tiles/s) and is followed by its pause. Player routes ignore input, block the
  menu and talking, and give the player's speed back when they end. Page movement `route`
  repeats its steps, skipping blocked ones. Map changes clear every route. Editor:
  `RouteSteps` (quick-add buttons, per-step direction or number, reorder) via the new
  `FormContext.render` hook for the `steps` field; `describeRoute` counts runs ("↑ ×3").
- **Event flags** (map v7, save v2): each event's own on/off flags, keyed by map + event id in
  `GameState` (`getFlag`/`setFlag`, `toData().flags` = map → event → sorted flag ids, only flags
  that are on). The `flag` condition is always about "this" event (`EventContext.self`, and
  `activePageIndex` sets it to the event whose pages it picks); `setFlag` takes an optional
  `event` on the same map (`checkMapShape` checks it). Both need `EventContext.map` (the world
  supplies it) and throw clearly without an event. Flags of events that no longer exist stay in
  saves. Editor: `mapFlagNames(map)` feeds `FormContext.suggest` (a datalist on the flag field),
  flag names are checked as ids, F9 lists this map's flags. Demo: the house chest
  (`characters/chest.png`, closed = facing down, open = facing up). A page graphic's optional
  `fixed` (also v7; "Keep this facing" in the panel) stops the turn toward the player on talk,
  and a fixed new page's facing applies even to the running event, so a chest shows its open
  lid right away.
- **Common events** (manifest v6, database category `commonEvents`, file
  `data/database/commonEvents.json`; entry: name, `trigger` call/autorun/parallel, optional
  gate `switch`, `commands`): `callCommon` pushes the entry's commands as a frame on the
  calling interpreter (via `EventContext.commonEvent`), so they run as the caller ("this",
  flags); nesting is capped at 100 frames. The world runs autorun ones after the map's autorun
  pages (`runningCommon`, `interpreterCommonEvent`) and parallel ones like parallel pages
  (`commonParallels`, keyed by id, restarted after map changes, promoted to the screen when they
  issue a request). `checkCommonEventReferences` (schema; run by `checkReferences` and at game
  start by the loader) checks gate switches, commands (`makeChecks().checkCommands`, shared with
  maps) and call loops. `assetReferences` scans their sounds/music. Editor: the Database
  category shows the schema form plus a `CommandList` (`listActions` builds the actions for
  any stored list); `createDatabaseFile` / `missingDatabaseKinds` add a category an older
  project lacks ("+ Common events" in the sidebar); `FormContext.choiceLabel` gives the
  trigger readable choices. Demo/Starter: "Rest", called by the hearth.
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
  - `parallel`: each present parallel page has its own interpreter (`World.advanceParallels`),
    run every step right after the blocking one, also while a message is up. A finished pass
    starts again on the next step, never the same one (so a page without waits runs once per
    step). A started pass always finishes even if its page changes; it just doesn't restart. A
    pass that issues a request (message, choice, battle, transfer) waits until nothing runs, then
    is promoted to the blocking interpreter (`promoteParallel`), so the runtime needs nothing
    new and the player waits for it. Map changes stop them; they're never saved (they restart
    after a load) and don't block saving. `world.parallelEvents` lists them (F9 panel).
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
- **Screen effects** (map v7: `fadeScreen` out/in, `tintScreen` colour + strength,
  `flashScreen`, `shakeScreen` power in px, each with `seconds` and `wait`; `hideEvent`;
  save v2 `screen` = fade + tint): core `screen.ts` `ScreenEffects` (tweens advanced by
  `World.step`, so effects pause with the menu; each start returns a "finished" check the
  interpreter waits on, replaced effects count as finished; tints blend colour and strength;
  flashes start at `FLASH_START`; `shakeX` is a whole-pixel sideways offset). `World.screen` is
  game-wide (kept across maps; fade and tint in saves). Runtime draws tint, flash, then fade in
  a `screen-effects` Graphics between the map and the dialog, and adds `shakeX` to the scene.
  `hideEvent` (`EventContext.hideEvent`, `EventInstance.setHidden`) makes an event absent until
  shown or the map reloads (`checkMapShape` checks its target). Editor: `ColorField` for
  `color`, defaults (1 s, 0.5, power 6, wait on) and choice labels in `project-context.ts`.
  Demo: the wolf ambush shakes and flashes red; Rest fades out and in.
- **Loops** (map v7, additive): `loop` (its `commands` repeat; a list path step `branch:
'loop'`), `break`, `exitEvent`. Interpreter frames carry `loop` (restarts at its end; an
  empty loop just ends) and `call` (a common event's frame): `break` truncates the stack to the
  nearest loop but never past a call frame, so a break in a common event can't leave the
  caller's loop (it does nothing there); `exitEvent` empties the stack, also from a common
  event. A loop that never pauses hits the 10,000-commands guard, whose error now says so.
  `strayBreaks` (schema) reports breaks outside loops in maps and common events. The editor
  adds field-less commands (loop, break, exitEvent) without a dialog (`commandHasFields`).
  Demo: the house's wall map loops "Look closer / Step back".
- **Text codes** (no format change: they live in message/speaker/choice strings): grammar in
  `schema/text-codes.ts` (`parseTextCodes`: `{v:id}`, `{actor:id}`, `{member:n}`, `{gold}`,
  `{currency}`, `{item:id}`, `{equipment:id}`, `{color:name|#rrggbb}`…`{/color}` (nesting),
  `{icon:n}`, `{{`; problems are readable, bad codes are dropped). `checkCommands` checks them
  (`checkText`) and the ids they name. Core `expandText` → `TextRun[]` (text + colour, icons)
  when the request is made, so values are current; message requests carry plain `text` and
  `runs`, speakers and choice labels are plain text. Runtime `rich-text.ts` (PixiJS-free,
  tested with a fake `measure`): `layoutRuns` wraps across colours/icons (a word stays whole),
  `runsLength` / `revealPiece` reveal by units (chars, icons; line breaks don't count, wrapped
  spaces do). `DialogView` draws one Text per same-colour piece (a style per colour) and icon
  sprites; `UiTheme.textColors` names the colours (`textColor()`). Editor: `previewText` /
  `textProblems` (editor-core) back `CommandExtras` (message preview + code help, shared by
  event pages and common events) and live checks on `text`/`speaker`/`label` (not comments:
  `FormContext.check` now gets the parent).
- Keep runtime UI logic testable the same way: put state machines in PixiJS-free modules.

- **Shops**: the `shop` command (`goods`: item/equipment + optional `price`; `canSell`) is an
  interpreter request answered with `continue()` when the player leaves. Rules are core's
  `shop.ts` (`buyPrice`, `sellPrice` = half the entry price rounded down, key items and price-0
  entries can't be sold, `maxBuy` by gold and bag space, `maxSell` by count and the gold cap,
  `buy`/`sell` throw on anything the screen wouldn't offer). Runtime: `ShopController`
  (PixiJS-free, tested: Buy / Sell / Leave, lists with prices, a quantity box with ↑↓ ±1
  wrapping and ←→ ±10, feedback lines) and `ShopView`; `game.ts` opens it when the running
  event's pending request is a shop, the world waits meanwhile (like the menu), and the message
  before it is cleared. `checkMapReferences` checks every good.

- **Icons**: `system.json` `iconset` (`image`, `iconSize`, `columns`) and every listed entry's
  `icon` index. The demo's sheet is `assets/system/iconset.png` (8×4 of 16 px, drawn by
  `gen-placeholder-art.ts`: potions, gear, spell schools, states; outlined so they read on any
  window). Runtime `icons.ts`: `loadIconSheet` slices it once (missing image → `NO_ICONS`
  after a warning), `MenuOption.icon` (set with `withIcon`), drawn by `ListWindow` and the
  battle menu; labels shift only in lists where some row has an icon. Menus (items, skills,
  equipment choices, worn slots), battle skills/items and the shop set icons. Editor:
  `database/IconField.tsx` picks from a grid of the sheet (via `FormContext.render` for
  `icon`), entry lists show icons; without an iconset it's a number field with a hint.

- **Options** (`runtime/src/options.ts`, `options-controller.ts`, `options-view.ts`, tested): music
  and sound volume (0–10, `volumeGain` → `AudioPlayer.setVolumes`, which also changes the music
  playing) and key bindings (`KeyboardEvent.code` → action). `rebind` makes the pressed key the
  action's only key, moving it from another action unless it's that action's last key (every
  action always keeps one). `OptionsStore` keeps them per game id beside the saves
  (`freequest:game:<id>:options`, same `KeyValueStorage`, so the desktop player writes a file);
  damaged data falls back to the defaults (`startGame`'s `keyBindings` are the default keys).
  The screen opens from the title (`TitleChoice` `options`) and the map menu (outcome
  `options`); both `resume()` after it closes. Rebinding: `bindKeyboard` now returns a
  `KeyboardInput` (`setBindings`, `captureNext`, `dispose`); the game arms `captureNext` while
  the controller is `capturing`, and Escape keeps the old keys.

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
- **Enemy action conditions** (database v4): each enemy action has `conditions` (all must hold):
  `hp` (`below` / `atLeast` a percent of max HP), `turn` (`from` turn N, then `every` M; 0 = only
  that turn), `state` (`has` true/false, on itself). `Enemy.meets(condition, turn)`;
  `chooseAction(random, turn)` weighs by rating only among qualifying, usable actions (none →
  it does nothing that turn). The battle passes the coming turn's number (`turnCount + 1`,
  since actions are planned before the turn starts). `checkDatabase` checks condition states.
  The demo wolf uses Power Strike only below 50% HP (rating 7).
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
  slots), Quit. Save rows in the menu show place + play time (`slotOption(info, { withParty:
false })`, the list is narrow); the title's Load list adds the party. `ListWindow` shortens a
  label with "…" (`fitText`, tested) rather than letting it run into the row's detail. Feedback lines reuse the battle log's wording (`describeEvent`).
- **Saves** (`schema/src/save.ts`, `SaveFile` v1): game name, timestamp, play time, map/position,
  switches/variables, party data, and a slot summary. `World.toSave()` refuses while an event runs
  (so no interpreter state is ever saved); `World.fromSave()` rebuilds a world (the save's map must
  be loaded first). Undeclared switches/variables are dropped on load. `SaveStore` keeps slots in any
  `KeyValueStorage` (localStorage by default, `MemoryStorage` otherwise), keyed by the manifest
  `id` (`freequest:game:<id>:save:<n>`; saves' `game` field is the id). Saves from before ids
  (keyed and tagged by name) still load and move to the id key on their next save. It reads
  through migrate + validate and reports damaged or foreign saves as broken slots.
- **Loading**: `loadProject(urlOrSource)`; assets resolve through `project.assetUrl(path)`
  (async), so any source works (HTTP folder, editor document, later desktop files).
- **Audio**: `system.json` `audio` (title/battle/victory/game-over music + engine sounds), map
  `music`, `playMusic`/`playSound` commands. Core decides _what_ plays: `World.music` (event
  override until the next map change, else the map's) and `World.drainSounds()`. Runtime decides
  _when_: `musicFor(scene, …)` and `uiSoundFor(input, menu)` (DOM-free, tested), and `AudioPlayer`
  (Web Audio) crossfades music, starts on the first key press (browser autoplay rules), and ignores
  missing files after a warning. A demo test checks every referenced image/audio file exists.
- **Testing in the browser pane**: when the pane is hidden, requestAnimationFrame doesn't fire, so
  drive the game with `freequest.app.ticker.update(t)` from the console instead of real-time waits.
  A hidden pane can also stop images decoding (`image.decode()` never settles): then the player
  never starts and the editor shows no icons. Ask for the pane to be shown for visual checks.
  Start the dev player with `pnpm dev` from the repo root if a preview config fails to start it.
- **Debug panel** (dev builds, F9): HTML overlay from `runtime/src/debug-text.ts` (DOM-free,
  tested) + `debug-panel.ts`. Enabled via `startGame({ debug: true })`.
- **Plugin API**: typed, hook-based, no monkey-patching of globals or engine classes. Only a stub
  interface exists (`packages/core/src/plugin.ts`); not implemented yet.
- **Dev without builds**: each package's `exports` has a `"@freequest/source"` condition pointing at
  `src/index.ts`. Vite, Vitest and `tsc --noEmit` use it (`customConditions`); `tsconfig.build.json`
  disables it so published `dist/` resolves dependencies' `dist/`.

### Editor (M6)

- **Split like the runtime**: `packages/editor-core` holds everything testable (no DOM, no React,
  no Tauri, no Node APIs; its `tsconfig.json` checks `src` without Node types so globals like
  `TextEncoder` or `structuredClone` fail typecheck: use `utf8.ts` / JSON copies); `apps/editor` (React 19) only draws editor-core state and forwards
  clicks. React was chosen for contributor familiarity; no UI library, plain CSS with tokens in
  `styles.css`. The editor's look is our own (clean-room rule covers UI layout too).
- **`ProjectFs`** is the only way the editor touches files: `readText` (rejects with
  `FileNotFoundError`), `writeText`, `readBytes`/`writeBytes` (assets), `remove`, `list(dir)`
  (recursive, sorted), `assetUrl`. Every implementation runs paths through
  `normalizeProjectPath` (relative, `/`, no `..`), so project data can't escape its folder.
  Implementations: `TauriFs` (desktop; fs plugin, folders from the open dialog are the only scope;
  assets as blob URLs), `DevServerFs` (browser dev; `dev-fs-plugin.ts` is a `vite dev`-only
  middleware with two areas, `samples/` for projects and the git-ignored `exports/` for exports,
  each confined to its folder), `MemoryFs` (tests). `list('')` lists a whole folder.
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
- **Playtest**: `startGame({ project })` takes a URL or any `ProjectSource` (`readJson`,
  `assetUrl`; runtime `loader.ts`, `httpSource` for URLs). The editor passes
  `playtestSource(doc)` (editor-core): a snapshot of the document at Play time (unsaved edits
  included, later edits don't leak in, copies so the game can't touch editor data). `Playtest`
  runs the game in an overlay with `MemoryStorage` saves (discarded), the debug panel on, and the
  editor's shortcuts off; Stop or Cmd/Ctrl+. ends it (Escape is the game's menu key). "Play from
  here" picks a cell and uses `startGame`'s `start` + `skipTitle`.
- **Canvas scale** (`runtime/src/scale.ts`, tested): whole steps only (crisp pixels), with
  `SCALE_SLACK` (2 px) of allowed overshoot so a hair-too-small space doesn't halve the picture.
- **Two PixiJS apps on one page**: never `app.destroy(true)` — `true` releases PixiJS's global
  resources and breaks every other live app (the editor's map canvas). Use
  `destroy({ removeView: true }, …)`. Images load through `<img>` in runtime
  `loadPixelTexture` (not `Assets`, which can't load blob URLs); the editor reuses it.
- **Schema-driven forms**: `editor-core/schema-form.ts` reads TypeBox schemas as plain JSON
  Schema (`classify` → fixed/choice/nullable/union/string/number/integer/boolean/object/array/
  ref; `defaultFor` with a `DefaultPicker` for references; `variantIndex` tells union variants
  apart; `COMMAND_SCHEMAS`, `CONDITION_SCHEMA`). `apps/editor/src/forms/SchemaField.tsx` renders
  any value from that; a `FormContext` supplies reference dropdowns by field name
  (`project-context.ts`: map, switch, variable, troop, actor, character, `id` by sibling `kind`,
  `path` = audio). Nested command lists are skipped (the tree editor owns them); an optional
  one shows as a "“Else” branch" toggle. When a change alters a sibling reference's choices
  (an item `id` after its `kind`), an id no longer among them moves to the first valid one.
  New fields in the format get controls for free; add
  labels/refs in `project-context.ts` rather than special-casing forms. Dialog values are
  validated against their own union variant (`events/validate.ts`) so errors are specific.
- **Event editor**: pure edits in `editor-core/event-edits.ts` (add/move/duplicate/remove events,
  ids `event1`…; pages add/copy/move/remove, never fewer than one; command tree by `ListPath`
  steps `{index, branch: then|else|onWin|onEscape|onLose|option, option?}` with
  `getList`/`updateList`/`insert`/`replace`/`remove`/`moveCommand`; `flattenCommands` → rows
  with branch headings and end slots; `describeCommand`/`describeCondition` with a
  `NameLookup`; `COMMAND_GROUPS`/`COMMAND_NAMES` for the add menu, tested to cover every type).
  UI: the map's Events tool (V) selects (click), moves (drag, one undo step), adds (double-click
  an empty cell) and deletes (Delete on the canvas); `EventPanel` edits name, pages, trigger,
  layer, graphic, conditions and the `CommandList` (dialogs edit one command; nothing changes
  until OK, so each edit is one undo step).
- **Database editor** (`apps/editor/src/database/`): every category but system is an entry list
  (search, New with name + id, Duplicate, Delete, reorder) beside a form generated from the
  entry schema (`entrySchema(kind)`); system.json is one form. Entry edits live in
  `editor-core/database-edits.ts` (`newEntry` fills required fields through the picker,
  `slugify`/`uniqueId`/`idProblem`; ids are fixed once created because events and entries
  refer to them). Forms also handle records (`classify` → `record`: level curves with integer
  keys, slot → equipment with refs asked as `<field>:key` / `<field>:value`), optional groups
  as an on/off toggle, compact grids for number-only objects (stat blocks), and live
  `check(field, value)` problems (formulas via `checkFormula`). The picker supplies scalar
  starting values too (`NUMBER_DEFAULTS`: success rate 1, rating 5…). Typing in an entry is one
  undo step until the field loses focus. Problems whose message starts with `<kind> "<id>"`
  show on that entry.
- **Rust stays minimal**: `src-tauri` only registers the dialog, fs, persisted-scope and opener plugins; permissions in
  `capabilities/default.json`. Release CSP is strict; `devCsp` is off so Vite's dev scripts run.
- **Testing**: editor-core in Vitest; the UI in the browser pane via `pnpm editor` (same code as
  the desktop app minus `TauriFs`). The app icon is generated (`pnpm --filter @freequest/editor
gen:icon`).

### Export (M7)

- **Export core** (`editor-core/export.ts`, tested): `assetReferences(project)` finds every
  asset the data uses (tileset/character/enemy images, iconset, map music, system music and
  sounds, `playMusic`/`playSound` in events) with where it's used. `planExport(project, fs)`
  lists every data file (from the document, so unsaved edits are included) plus exactly those
  assets, and sorts problems: every project problem and every missing image is an **error**
  (the game runs the same checks at start and would refuse to run); a missing sound is a
  **warning** (the game plays on in silence). `writeExport(plan, source, target, { prefix })`
  refuses while there are errors, writes compact JSON, copies assets byte for byte, reports
  progress, and writes project.json last. Unused files never ship.
- Add new asset-bearing fields to `assetReferences` (and its test) or exports will miss them.
- **Release player** (`packages/player`, `@freequest/player`): `index.html` + `src/main.ts`, built
  with `base: './'` into `dist/` (`index.html`, `player/*.js`) plus `dist/files.json` listing
  every file, which exporters copy next to a `game/` folder of exported data. It loads
  `./game/` over HTTP, sets the page title from the manifest, shows a spinner while loading,
  toggles fullscreen with F11 / Alt+Enter, has no debug panel or `window.freequest`, and
  explains start failures to players (`src/messages.ts`, tested: opened from `file://`, missing
  files, anything else with a Details fold). `apps/player-web` stays the dev player.
- **Web export steps** (`editor-core/web-export.ts`, tested), shared by the editor and the CLI:
  `inspectTarget(fs)` → empty / previous export (has `freequest-export.json`) / other;
  `clearExport` deletes only a previous export's files; `exportWeb({ project, plan, source,
target, player, … })` writes `game/` + the player files + the marker into an empty folder.
- **Export dialog** (`apps/editor/src/ExportDialog.tsx`, toolbar "Export…"): runs `planExport` on
  the document (unsaved edits included), lists errors (Export disabled) and warnings, then
  exports into a folder from the system picker (desktop) or `exports/<name>` (browser mode,
  with a "Play the export" link served by the dev server). A previous export is replaced only
  after a confirm; other non-empty folders are refused. The release player comes bundled:
  `release-player-plugin.ts` serves `packages/player/dist` at `/player-release/` in dev and copies
  it into the editor's build (so the desktop app has it offline); `bundledPlayer()` reads it.
- **`freequest` CLI** (`packages/cli`): `run(argv, io)` in `cli.ts` (tested with a fake player
  dir and temp folders), `main.ts` wires it to the process; `NodeFs` is the Node `ProjectFs`.
  Exit codes: 0 ok, 1 problems (or not a project), 2 usage. `export web` writes `game/` via
  `writeExport`, copies the built player listed in `@freequest/player/files.json`, and drops a
  `freequest-export.json` marker. It only writes into an empty folder, or replaces a previous
  export with `--clean` (never a folder without the marker, never inside the project). From
  the repo, `pnpm freequest …` runs it from source (paths relative to the repo root); the
  player must be built (`pnpm --filter @freequest/player build`, or `pnpm build`).
- Browser-pane note: serve exports with `vite preview --outDir <dir>` (Python's http.server
  stalls under the pane's parallel requests); the pane only opens ports it was allowed before.
- **Desktop player** (`apps/player-desktop`, Tauri): its page is `packages/player/dist` (the same
  build web exports use). `packages/player/src/main.ts` detects Tauri and loads `desktop.ts`
  lazily: the game comes from the bundle's `Resources/game` through the asset protocol (scope
  `$RESOURCE/game/**`, CSP allows `asset:`; asset URLs are another origin, so
  `loadPixelTexture` sets `crossOrigin = 'anonymous'` or WebGL refuses the images and maps draw
  black), the window takes the game's title and is grown until the page's viewport (not the
  window's "inner" size, which includes the macOS title bar) is 2× the resolution, F11/Alt+Enter use native fullscreen, and saves are files: `FileSaveStorage`
  (`file-saves.ts`, tested) reads every save into memory at start (SaveStore is synchronous) and
  writes through in order to `$APPDATA/saves/<game id>/` (fs scope limited to that). The shell is
  built with `pnpm build:mac-player` (release, LTO, ~11 MB universal) and staged at
  `apps/player-desktop/dist/macos/FreeQuest Player.app`; it carries the demo as a placeholder.
  Universal since M10 (see Versions and releases).
- **PixiJS under a strict CSP**: runtime's index imports `pixi.js/unsafe-eval`, which replaces
  PixiJS's `new Function` code generation; without it the desktop apps' CSP stops PixiJS
  ("does not allow unsafe-eval"). Keep that import.
- **Mac export** (`editor-core/mac-export.ts`, tested): `exportMac` copies the shell as
  `<Game name>.app` (`macAppName`), skipping its placeholder `Contents/Resources/game` and old
  `_CodeSignature`, keeps `Contents/MacOS/*` executable (`writeBytes(…, { executable })`), sets
  `CFBundleName`/`CFBundleDisplayName`/`CFBundleIdentifier` (`org.freequest.game.<id>`) via
  `setPlistStrings`, writes the game into `Contents/Resources/game`, and a marker beside the app.
  Then the caller ad-hoc signs (`macSignCommand`: `codesign --force --deep --sign -`): the CLI via
  `execFile` on macOS (elsewhere it warns), the editor via its one Rust command `sign_mac_app`.
  Without re-signing macOS calls the modified app "damaged". Players still see "unidentified
  developer" (right-click → Open) until a Developer ID signs it. The desktop editor bundles the
  shell as a resource (`players/macos/`), so `pnpm build:mac-player` must run before
  `pnpm editor:desktop` or an editor build (now through `players/`, see M10); the Export dialog
  offers "macOS app" only there.
- Checking a built desktop app without seeing it: the window list (Swift
  `CGWindowListCopyWindowInfo`) shows the owner and size but not titles without screen-recording
  access; a temporary write to `$APPDATA/saves/` is the reliable "did the game start" probe. A
  probe can also press keys (`window.dispatchEvent(new KeyboardEvent('keydown', …))`) and
  collect `error`/`console.error`; that is how the black map (a WebGL SecurityError) was found.
- Web export layout: `index.html`, `player/`, `game/project.json`, `game/data/…`,
  `game/assets/…`. Must be served over HTTP (itch.io, any static host); `file://` shows the
  "needs a website" message.

### Editor workflow (M8)

- **New project** (`editor-core/new-project.ts`, tested): a template is any project folder plus an
  optional `template.json` (name, description; never copied). `createProject(template, target,
{ name, id })` copies every file into an empty folder and rewrites `project.json`'s name and id
  (written last, canonical). `suggestGameId` / `newProjectProblem` back the dialog. Templates:
  Starter (`templates/starter`, generated by `pnpm gen:templates`: one small map, a sign, the
  hero, one slime troop, a trimmed database; keep it canonical, a test checks) and Demo
  (`samples/demo-project`). `apps/editor/templates-plugin.ts` serves them at
  `/project-templates/` in dev and copies them into the editor build. Browser mode creates
  projects in the git-ignored `projects/` dev area (listed on the start screen with `samples/`);
  desktop asks for a parent folder and creates `<parent>/<Game name>`.
- **Recent projects** (`editor-core/recent-projects.ts`, tested): newest first, one per location,
  at most 10, damaged storage ignored; the app keeps them in localStorage (`apps/editor/src/
recent.ts`). A location is `fs.label`: the folder path on desktop, `<area>/<name>` in browser
  mode (`projectFsAt` reopens either). Every successful open (and New project) records the game's
  name. A failed recent open says the folder may have moved and offers "Remove it from Recent".
  On desktop, `tauri-plugin-persisted-scope` saves the fs scope the dialogs grant (they ask for
  `recursive: true`), so recent folders stay readable after a restart.
- **Assets** (`editor-core/assets.ts`, tested): files on disk, outside the undo history (an
  import or delete happens at once). `doc.assets` is an `AssetLibrary`: the list of files under
  `assets/` (listed once, `refresh()` re-reads, `subscribe`/`version` so every picker updates;
  the app's `useAssetPaths` / `useProjectLists`), `import(folder, files)` (only under `assets/`,
  never overwrites: `name-2.png`; names cleaned by `safeAssetName`; contents must match the
  extension, `sniffFormat`, or the file is rejected with a reason) and `remove(project, path)`
  (refuses while `assetReferences` uses it). `describeAssets` adds where each is used and lists
  referenced-but-missing files. `ASSET_FOLDERS` are the import targets; `importFolderFor` sends
  a file to a folder of its type. The Assets panel (sidebar, under Project settings) imports
  through a file input or by dropping files on it (the desktop window sets
  `dragDropEnabled: false` so HTML drops reach the page; the webview reads the bytes, so no fs
  scope is needed for the source files) and previews images (size from `pngSize`) and sounds.
  `TauriFs` drops a cached blob URL when its file is written or removed.
- **Tileset editor** (`editor-core/tileset-edits.ts`, tested; UI `apps/editor/src/tileset/`):
  `fitTileset` cuts the image into tiles of a size (columns from the image width; flags and names
  stay by index, new tiles walkable; returns the same object when it already fits), `setPassable`
  / `setAbove` / `setTileName` (unchanged tiles keep their objects; `above: false` and empty names
  are left out), `createTileset` (id from the name, `data/tilesets/<id>.json`, one undo step with
  the manifest), `deleteTileset` (refused while `tilesetUsages` lists maps). The view draws the
  image with a grid of cells over it: modes Walkable / Above / Select (W/A/S); a click or drag is
  one undo step (coalesced until pointer-up). Re-cutting a tileset that maps use asks first.
  Image sizes come from the browser (`useImage`), so any image format works.
- **Character editor** (`editor-core/character-edits.ts`, tested; UI `apps/editor/src/character/`):
  `fitCharacter` cuts the sheet into frames of a size (frames = columns that fit; a standing
  frame or walk cycle the new width lacks resets to `defaultIdleFrame` / `defaultWalkCycle`),
  `sheetImageProblem` (the image needs 4 rows), `parseFrameList` (walk cycle typed as "0 1 2 1"),
  `moveRow` (direction order), `characterUsages` (player, actors, event graphics),
  `createCharacter` / `deleteCharacter` like tilesets. The view shows the sheet with direction
  labels and a preview of all four directions walking at the player's speed (runtime's
  `FRAMES_PER_TILE`). `useElementSize` fits both sheet views to their panel.
- `checkCharacterShape` (schema, run by `contentProblems` and the runtime loader) reports a
  standing frame or walk cycle past the sheet's frames, which would stop the game drawing it.
- **Clipboard** (`editor-core/clipboard.ts`, tested): one `clipboard` (`EditorClipboard`) for the
  editor's life, so pasting into another project works; it holds commands, one event or one
  database entry as deep copies, and references keep their ids (missing ones show as problems).
  `insertCommands` / `removeCommands` / `sliceCommands` work on runs in one list; `pasteEvent`
  takes a new id at `nearestFreeCell`; `pasteEntry` keeps a free id, else `<id>-2` and "(copy)".
  UI: the command list selects runs with Shift+click / Shift+↑↓ (Copy, Paste, ⌘C/⌘X/⌘V; Move
  is for single commands), events copy from their panel or ⌘C/⌘X/⌘V on the map (Events tool;
  paste goes to the hovered cell), entries have Copy/Paste and ⌘C/⌘V on the list.
- **Map point picker** (`events/MapPointPicker.tsx`): a transfer's dialog has "Choose on map…",
  which draws the target map on a 2D canvas from its tileset (no PixiJS) with event markers,
  picks a cell and facing, and warns when the cell isn't walkable (core's `CollisionMap`).
  `ValueDialog`/`CommandList` take an `extra` render prop for such controls. Dialogs opened from
  a dialog go through a portal (forms can't nest), and React still bubbles their events to the
  parent, so the picker's submit calls `stopPropagation()`.
- **Packaged editor**: `pnpm build:editor-app` builds every package (the editor's `dist/` must
  hold the release player and templates), the Mac player shell (bundled as a resource), then
  `tauri build --bundles app` (release profile: LTO, size-optimised, stripped, ~12 MB) and
  `scripts/stage-app.mjs`, which copies it to `apps/editor/dist-app/macos/` (git-ignored) and
  signs it ad-hoc as a whole (`codesign --deep`, then `--verify --strict`), nested player app
  included. Users open it with right-click → Open the first time (no Developer ID).
- `checkMapReferences` reports map tiles past the end of the tileset (the game would throw), so
  shrinking a tileset shows up as a problem instead of a crash.

### Versions and releases (M10)

- **One version**: the root `package.json`'s. `pnpm version:set 0.2.0` writes it into every
  package.json, both `tauri.conf.json`, both `Cargo.toml` and `Cargo.lock` entries, and the
  generated `packages/schema/src/version.ts` (`FREEQUEST_VERSION`, used by the CLI's
  `--version`, export markers and the editor's start screen). `scripts/version-files.ts` lists
  the files; `schema/test/version.test.ts` fails if any copy drifts. `CHANGELOG.md` gets an
  entry per release.
- **Licence notices** (`scripts/gen-notices.ts`, `pnpm gen:notices`, generated and committed):
  FreeQuest's MIT licence, then every shipped package (name, version, licence, source), then each
  distinct licence text once (deduped ignoring whitespace) with its users. JavaScript from `pnpm
licenses list --prod --filter <pkg>...` (the `...` follows our workspace packages), Rust from
  `cargo metadata --filter-platform` for both Mac architectures (normal dependencies only:
  build-dependencies and proc-macros aren't shipped). Files: `packages/player/public/`
  (copied into every web export through `files.json`), `apps/player-desktop/` (bundled as a
  resource, so Mac exports carry it), `apps/editor/public/` (the About box shows it). Re-run
  after changing dependencies and before a release.
- **About box** (`apps/editor/src/AboutDialog.tsx`): version, licence, and the notices; from the
  start screen and the toolbar's "?".
- **Universal Mac builds** (`scripts/tauri-mac-build.mjs`, used by `build:shell` and `build:app`):
  `tauri build --target universal-apple-darwin` when a rustup toolchain has both Mac targets
  (found via `FREEQUEST_RUSTUP_BIN`, `~/.cargo/bin` or Homebrew's keg-only `rustup`; put first on
  PATH for that build only, Homebrew's own Rust stays the default), else a host-only build with
  a warning. `scripts/mac-bundles.mjs` picks the newest built app for the stage scripts. The
  player shell and so every Mac export are universal (~11 MB). The editor's stage script signs
  the whole app, then makes `dist-app/macos/FreeQuest-Editor-<version>-macOS.dmg` with `hdiutil`
  (app + an Applications link), not Tauri's DMG bundler, which would pack the app before our
  signing. `hdiutil` warns it's deprecated; its `diskutil image` replacement needs newer macOS.
- **GitHub** (since M10): `origin` is `github.com/PatrickWalshCreates/FreeQuest`, public since
  v0.1.0 (the site is https://patrickwalshcreates.github.io/FreeQuest/). Commits use the account's private address (the history was rewritten once, before the
  first push, with `git filter-repo --mailmap`; a backup bundle of the old history is outside
  the repo). This clone's `user.email` is set to it; keep it that way.
- **Release builds** (`.github/workflows/release.yml`): on a `v*` tag or by hand. macOS jobs
  build the editor per architecture (`FREEQUEST_MAC_TARGET=aarch64-apple-darwin` /
  `x86_64-apple-darwin`; DMGs named `…-macOS-AppleSilicon.dmg` / `…-macOS-Intel.dmg` from the
  binary's `lipo -archs`), each bundling the universal player so exports run on every Mac; a
  Windows job builds the editor's NSIS installer (`tauri.windows.conf.json` drops the Mac player
  resource and picks NSIS), renamed `FreeQuest-Editor-<version>-Windows-setup.exe`. Note: while
  the repo is private, Actions minutes come from the free allowance (macOS counts 10×). A tag also makes a draft GitHub Release with all three to check and
  publish by hand.
- **Windows and Linux exports** (`editor-core/desktop-export.ts`, tested; CLI `export windows|linux`;
  the Export dialog): a folder `<Game>/` with the player program renamed (`<Game>.exe`, or the
  game id on Linux, executable), `game/` and `THIRD_PARTY_NOTICES.txt`. A plain (unbundled)
  Tauri program's resource folder is its own folder on both systems, so the player's
  `resourceDir()/game` lookup works unchanged; its CSP already allows `http://asset.localhost`
  (Windows). No signing, so any editor can make them. Players (`DESKTOP_SHELL_PROGRAM`) come from
  `apps/player-desktop/dist/<system>/`: `scripts/build-shell.mjs` builds the one for the system
  it runs on (macOS universal app; Windows/Linux `tauri build --no-bundle` + notices).
- **Players bundled with the editor**: `apps/editor/scripts/stage-players.mjs` copies every built
  `apps/player-desktop/dist/{macos,windows,linux}` into `src-tauri/players/` (git-ignored, with a
  README so it's never empty), bundled as the `players/` resource (fs scope
  `$RESOURCE/players/**`); `build:app`, `build:desktop` and `desktop` run it first. The editor's
  `macShell()` / `desktopShell(target)` read from there (in browser mode, the dev server's
  `players` area). The release workflow builds the three players first (one job per system,
  packed as .tgz to keep permissions) and every editor job unpacks all of them, so each editor
  download exports for every desktop. Editors: Apple Silicon and Intel DMGs, Windows NSIS
  installer, Linux AppImage + .deb (`tauri.linux.conf.json`), built on ubuntu-22.04 for older
  glibc. Licence notices cover all four platforms' crates.
- **Help window** (`apps/editor/src/HelpDialog.tsx`): the guides in `docs/` are bundled with the
  editor (`?raw` imports, so they always match its version) and read by editor-core's
  `parseMarkdown` (`markdown.ts`, tested: headings with anchors, paragraphs, lists with
  continued lines, tables, fenced code, quotes, bold/italic/code/links; plain data, drawn as React
  elements, never as HTML). Tabs: Getting started, Exporting games, About (`AboutPanel`), with a
  section list. Links: other guides switch tabs, `#anchor` scrolls, web links open in the
  browser (`openExternal`: Tauri's opener plugin, `opener:default`; `window.open` in browser
  mode). Opened from the start screen (welcome text when there are no recent projects, Guide and
  About links) and the toolbar's Help.
- **Error screen** (`ErrorScreen.tsx`): an `ErrorBoundary` around the whole app (Reload) and one
  around an open project (keyed by the project; the document lives outside it, so **Save my
  changes** still works, then **Try again** re-renders with the changes intact, or **Close the
  project**). **Copy details** gives the version, browser and stacks. Dev builds: set
  `sessionStorage['freequest:test-crash'] = '1'` to make the project screen throw (React retries
  a failed render once, so the boundary, not the thrower, clears the flag).
- **Website** (`scripts/build-site.ts`, `pnpm build:site` → git-ignored `site-dist/`; styles in
  `scripts/site/site.css`): a landing page (demo in an iframe, features, download links to
  `releases/latest/download/<file>` named like the release workflow names them), `docs/*.md` as
  HTML through editor-core's `parseMarkdown` (escaped; links to other guides become pages, other
  repo files GitHub links; `<version>` in code is filled in), and `play/`, a real web export of the
  demo (`exportWeb`). Relative links only, light/dark. `.github/workflows/pages.yml` deploys it
  on a published release or by hand (Pages needs the repo public, Source = GitHub Actions).
  The player focuses with `preventScroll` so an embedding page doesn't jump to the game.
  Preview: launch config `site` (`vite preview --outDir site-dist --port 5180`).
- Shortcut labels in the editor come from `apps/editor/src/keys.ts` (`MOD`: ⌘ on a Mac, `Ctrl+`
  elsewhere); every shortcut accepts both. The guides write Ctrl with a "⌘ on a Mac" note.
- `docs/release-checklist.md`: the by-hand checks for a release (dialogs, restarts, Gatekeeper,
  playing the demo).
- Contributor files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (our own words), `SECURITY.md`
  (private advisories), `.github/ISSUE_TEMPLATE/` (bug report and idea forms, no blank issues)
  and a pull request template.
- History check (before publishing): only the commit identity is personal (name + email in every
  commit); no local paths, secrets or large files in any commit's content.

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
- **0.1 formats are frozen**: `packages/schema/test/fixtures/release-0.1/` is the demo's data and
  a save exactly as 0.1.0 wrote them (never edit; a checksum test fails, `.gitattributes` keeps
  the bytes). `editor-core/test/release-formats.test.ts` opens it with no problems and
  `core/test/release-formats.test.ts` loads the save. Change a format only with a migration; a
  release that changes one adds its own `release-<v>/` folder.
- Current versions: manifest 6 (v3: `database` paths, `start.party`/`start.gold`; v4: troops file;
  v5: `id`, the permanent game id, migrated from the name with `idFromName`; v6: the
  `commonEvents` database category),
  map 7 (v3: party commands/conditions; v4: `encounters`, `battle` command; v5: `music`,
  `playMusic`/`playSound`; v6: page `movement`, `moveRoute`, `shop`; v7: event flags, fixed
  facing, `callCommon`, `loop`/`break`/`exitEvent`, screen effects, `hideEvent`), tileset 1, character 1, every database file 4 (v2: combat modifiers,
  troops, system attack/guard skills; v3: system `audio`; v4: enemy action `conditions`), save 2 (v2: `flags`, `{}` for older saves, and optional `screen`). Additive bumps migrate as no-ops.
- Database: one file per category under `data/database/` (`system`, `actors`, `classes`, `skills`,
  `items`, `equipment`, `states`, `enemies`, `troops`, `commonEvents`), each `{ formatVersion, entries: [...] }` except
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
  - Deferred from M2: `parallel` trigger, moving NPCs, move routes (all M9).
- **M3 (done)** Database: actors, classes, skills, items, equipment, states, enemies; formula
  language; battler model; party/inventory/equipment; effects engine; enemy battlers; party event
  commands/conditions; demo rewards, Mira joining, resting hearth; F9 debug panel.
  - Deferred to M5: menus to use items/skills/equipment, icons/iconset art.
- **M4 (done)** Turn-based battle: troops, combat modifiers, battle engine, battle screen
  (controller + view), random encounters, event battles with outcome branches, transitions, game
  over and new game; demo enemy art, meadow encounters, wolf ambush at the bridge.
  - Deferred: enemy action conditions (done in M9), battle animations/effects art,
    battle music (M5), multi-row/positioned troop layouts, a "can lose" recovery rule.
- **M5 (done)** Title screen, in-game menu (items, skills, equipment, status, save, quit), three
  save slots in localStorage with a versioned save format, music and sound (format, core cues, Web
  Audio player, generated chiptune assets).
  - Deferred: options screen (volume, key rebinding), item/skill icons, shops, saving mid-event,
    file-based saves for desktop builds (M7), formation/reordering the party.
- **M6 (done)** Tauri editor: map editor first, then event and database editors. Steps:
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
  6. ~~Playtest from the editor with unsaved edits~~ (done; Play, and Play from here)
  7. ~~Event editor: place/move events, pages, conditions, graphic, trigger, nested command
     editor~~ (done; forms generated from the schema, reused by step 8; no copy/paste of commands
     yet, no visual picker for transfer targets)
  8. ~~Database editor: all categories, forms generated from the TypeBox schemas~~ (done)
  - Deferred: renaming ids with reference updates, copy/paste of commands and entries, a map
    picker for transfer targets, multi-tile stamps, tileset/character-sheet editors, an asset
    importer, remembering the last project, testing the desktop build by hand (file dialogs,
    close prompt) before M7 packaging.
- **M7 (done)** Export: web, desktop (macOS first), `freequest` CLI. Steps:
  1. ~~Export core: collect referenced files, check, write~~ (done)
  2. ~~Game id in project.json (manifest v5) used to keep saves apart~~ (done; editable in
     Project settings)
  3. ~~Release player: loading screen, fullscreen, friendly errors, no debug; built once~~ (done;
     a scripted export of the demo played in the browser)
  4. ~~`freequest` CLI: `check` and `export web`~~ (done)
  5. ~~Export dialog in the editor~~ (done; web target, tried in browser mode)
  6. ~~Desktop player (file saves) and macOS export (copy the prebuilt app, add the game, rename,
     ad-hoc sign)~~ (done; CLI export launched and started the game; editor target and playing
     by hand still to be tried by a person; custom app icons and Windows/Linux shells later)
  7. ~~Docs and end-to-end runs of both exports~~ (done; `docs/exporting.md` is the user guide,
     CI has a macOS job that builds the player app and verifies a Mac export's signature)
  - Deferred: Windows/Linux player apps (build on those systems, e.g. in CI), installers (DMG,
    setup programs), a packaged editor app, custom app icons per game, Developer ID signing and
    notarization, uploading to itch.io, mobile (the shared version came in M10).
- **M8 (done)** Editor workflow. Steps:
  1. ~~New project from a template (Starter, Demo)~~ (done; created and played in browser mode)
  2. ~~Recent projects (desktop keeps folder access between launches)~~ (done; tried in browser
     mode, the desktop restart still to be tried by hand)
  3. ~~Asset import and an Assets panel (files are copied into the project)~~ (done; tried in
     browser mode with dropped files; renaming assets with reference updates later)
  4. ~~Tileset editor (passability, above flags)~~ (done; new tilesets from an image, re-cutting
     the grid, tried in browser mode)
  5. ~~Character sheet editor~~ (done; new characters from an image, walk preview, tried in
     browser mode)
  6. ~~Copy/paste of commands, events and entries; a map picker for transfer targets~~ (done;
     tried in browser mode, including pasting an item into another project)
  7. ~~A packaged FreeQuest Editor.app (unsigned) and a Getting started guide~~ (done; built and
     launched; `docs/getting-started.md`)
  - Deferred: renaming ids and assets with reference updates, multi-tile stamps, a DMG or
    installer, Developer ID signing, Windows/Linux editor builds, an auto-update.
- **M9 (done)** Gameplay depth. Steps:
  1. ~~Parallel events (background interpreters; screen requests wait their turn)~~ (done)
  2. ~~NPCs that move: page movement (random, toward the player), speed, pause~~ (done; map v6;
     a wanderer and a chaser into a battle tried in a playtest; routes come with step 3)
  3. ~~Move route command (event or player; repeat, skip if blocked, wait until done)~~ (done;
     also route page movement; added in the dialog and played in a playtest)
  4. ~~Shops (buy/sell screen from a `shop` command)~~ (done; added in the editor, bought and
     sold in a playtest)
  5. ~~Icons (generated iconset; menus, battle, shop; icon picker in the editor)~~ (done; picked
     in the editor, seen in the game's menu)
  6. ~~Options screen (volume, key rebinding; kept per player apart from saves)~~ (done; changed,
     reloaded and played with the new key in the dev player)
  7. ~~Enemy action conditions (HP below, turn number, state)~~ (done; database v4; the demo
     wolf saves Power Strike for when it's hurt)
  8. ~~Demo, Starter, docs and export checks~~ (done; the demo meadow has a peddler's shop, a
     wandering farmer and birdsong from a parallel event, the quest test buys a potion; the
     Starter has a shopkeeper and 100 starting gold; the guide covers every M9 feature)
  - Formats: map 6 (movement, moveRoute, shop), database 4 (enemy conditions); saves stay 1.
  - Deferred: saving event positions and parallel progress, pathfinding for chasers, jump /
    transparency / script steps in routes, shop sell-price overrides, a key-binding UI for
    gamepads, battle animations.
- **M10 (done)** First public release (v0.1.0). Steps:
  1. ~~One version number and a changelog~~ (done; 0.1.0, `pnpm version:set`, `CHANGELOG.md`)
  2. ~~Release hygiene: third-party licence notices, an About box, CONTRIBUTING/SECURITY/issue
     templates, a history check before publishing~~ (done; the commit email is the open question)
  3. ~~First-run polish: welcome and guide link, an error screen instead of a blank window, a
     by-hand checklist~~ (done; guides bundled in a Help window, `docs/release-checklist.md`)
  4. ~~Universal (Apple Silicon + Intel) macOS builds and a DMG for the editor~~ (done; both
     slices checked with `lipo`, signatures verified in the DMG, launched under Rosetta)
  5. ~~GitHub and a release workflow~~ (done; private repo, history on the noreply address, CI
     green; a test release run built all three downloads: Apple Silicon and Intel DMGs checked
     with `lipo` and `codesign`, the Windows installer built but not yet run on Windows)
  6. ~~Windows and Linux exports (from CI-built players)~~ (done; plus a Linux editor download.
     Tried by hand on a Windows PC: the exported demo, the editor installer, a new project, Play,
     and a Windows export made on Windows all worked. No SmartScreen prompt there because the
     files were copied, not downloaded; web downloads carry the Mark of the Web and will warn.
     Linux not yet run on a real machine)
  7. ~~A website with the demo playable in the browser (GitHub Pages)~~ (done; built and played
     in the browser pane, and live on GitHub Pages)
  8. ~~Release dry run, tag v0.1.0, freeze the 0.1 formats~~ (done; repo public, CI green, the
     release built and both Mac DMGs checked from the release, tried by hand from a download,
     published 2026-11-11; Pages on, the live demo played. The guides now cover every system)
  - Decided: GitHub `PatrickWalshCreates`, public from 0.1.0, commits on the noreply address,
    editor downloads for Apple Silicon and Intel Macs, Windows and Linux. Still open: Apple Developer ID
    ($99/yr), Windows signing, a name check.
- **M11 (in progress)** Events for real games, released as 0.2.0. The event language is what limits
  games now: no per-event memory, no reusable logic, plain-text messages, no loops or screen
  effects. Steps:
  1. ~~Event flags: each event's own on/off flags (a chest remembers it was opened, no global
     switch per chest), as page conditions and a command; kept in saves (save v2, migrating
     0.1 saves through the frozen fixture)~~ (done; plus "Keep this facing" for graphics. The
     demo's house chest was opened in the dev player; the flag dialog tried in the editor)
  2. ~~Common events: shared command lists in their own file (manifest v6), a `callCommon` command,
     and optional autorun/parallel triggers gated by a switch; an editor list beside the database~~
     (done; a database category, so lists, copy/paste and exports come free. Tried in the editor
     and rested at the demo's hearth in the dev player)
  3. ~~Text codes in messages and choices: variables, actor and party names, gold, item names,
     colours and icons, in FreeQuest's own `{…}` syntax (parsed in core, drawn as styled runs);
     the editor previews them and reports unknown codes~~ (done; the chest's message seen in the
     dev player, icon and yellow "Potion", matching the editor's preview)
  4. ~~Control flow: `loop` with `break`, and `exitEvent` (commands stay a tree: no labels or
     goto)~~ (done; the demo's wall map loops; tried in the editor and the game)
  5. ~~Screen effects: fade out/in, tint, flash and shake (requests or timed state in core, drawn by
     runtime), plus hiding/showing an event until the map reloads~~ (done; save v2 keeps the
     tint and fade; tried in the editor and the dev player)
  6. Editor support for all of it: forms come from the schema, plus the flag picker, the common
     event list and the text-code preview
  7. Demo, Starter, guides (every system), the quest test, and a 0.2.0 release through the
     checklist
  - Formats: map 7 (flags, new commands), manifest 6 (common events), save 2 (flags); each with a
    migration and 0.1's frozen project and save still opening.
  - Not in M11 (M12 candidates, "editor comfort"): renaming ids/assets with reference updates,
    multi-tile stamps, chunked rendering for big maps, message faces/portraits.
- **Later**: candidates, in no fixed order: the deferred items above (id renaming in the editor,
  multi-tile stamps…), an RPG Maker MZ project importer (reads user's own projects; still
  clean-room), the plugin API.

## Known gaps / notes for next milestones

- Text renders at the internal resolution and is pixel-upscaled; fine for now, revisit (bitmap font
  or high-res UI layer) if legibility suffers at small sizes.
- Each tile is its own Sprite; fine for small maps, revisit (chunked render textures) for large ones.
- Passability is a single boolean per tile; per-direction passability would be a format migration.
