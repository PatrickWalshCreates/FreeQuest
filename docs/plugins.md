# Plugins

A plugin adds something to your game that FreeQuest doesn't do by itself: weather over a map, a
gold counter on screen, a rule of your own that runs every step. It's a folder in your project
with a description (`plugin.json`) and a script (JavaScript). The editor reads the description to
show the plugin's settings and commands; only the game runs the script.

FreeQuest comes with two example plugins, in the demo and in every new project (turned off
there):

- **Weather**: rain or snow over a map. Its **Start weather** and **Stop weather** commands go in
  events; the weather stays with the map it started on and is kept in saves. The demo's bridge
  ambush starts a storm, and beating the wolf clears it.
- **HUD**: a small box in a corner showing the party's gold or a variable, if you like only
  while a switch is on. **Hide the HUD** and **Show the HUD** turn it off for a cutscene.

## Using plugins

Plugins are in **Project settings › Plugins**:

- **+ Add a plugin folder…** copies a plugin's folder into your project, under `plugins/<id>/`.
  The editor checks it first and says why if it can't be used (no `plugin.json`, a missing
  script, a newer plugin API than this FreeQuest has, or an id the project already has).
- The box beside a plugin's name turns it on or off. A turned-off plugin doesn't run and its
  commands do nothing; it's still in the project.
- **↑** and **↓** set the order plugins start in, which matters only if they work together.
- **Settings** opens the plugin's settings form. Values outside what the plugin allows are
  marked, and listed with the project's problems.
- **Used by** lists the events that use the plugin's commands. **Remove…** takes the plugin out
  of the project (its folder is deleted when you save; until then you can undo).

A plugin's commands are in the event command list's **+ Add** menu, in a group under the
plugin's name. Their dialogs come from the plugin's description, like any other command's.

### Plugins and safety

A plugin's script is a program, so only use plugins you trust or wrote yourself.

- **The editor never runs plugin scripts.** Opening a project, editing it and exporting it never
  runs plugin code.
- **Playtests ask first.** The first time **Play** would run a project's plugins, the editor
  lists them and asks. **Run plugins** is remembered for that project (it asks again when a new
  plugin is turned on); **Play without plugins** plays this once without them. Plugins in a
  playtest run in a sandbox, cut off from the editor, your files and the network.
- **Exported games run their plugins** as part of the game, without that sandbox, with the same
  access the game itself has: in a browser, what any web page has; in the desktop player, its
  window and its own save folder.

## Exporting

Turned-on plugins go with every export (web, macOS, Windows, Linux) and run in the game. A
turned-off plugin ships only its `plugin.json`, so its script never leaves your project. See
[Exporting and sharing a game](exporting.md).

## Writing a plugin

A plugin is a folder with two files:

```
plugins/sparkle/
  plugin.json   what it is, its settings and commands
  main.js       the script the game runs
```

Keep the script in one file: in a playtest it's loaded on its own, so `import`s of other files
in the folder don't work there. Pictures and sounds the plugin uses belong in the project's
`assets/` folder, chosen through an asset setting (see below).

### plugin.json

```json
{
  "formatVersion": 1,
  "id": "sparkle",
  "name": "Sparkle",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Twinkles over the player.",
  "author": "You",
  "entry": "main.js",
  "settings": [
    {
      "name": "size",
      "label": "Size (pixels)",
      "type": "integer",
      "min": 1,
      "max": 8,
      "default": 2
    }
  ],
  "commands": [
    {
      "id": "burst",
      "label": "Sparkle burst",
      "description": "A short burst of sparkles.",
      "params": [
        { "name": "seconds", "label": "Seconds", "type": "number", "min": 0, "default": 1 }
      ]
    }
  ]
}
```

- `id`: lowercase letters, digits, `-` and `_`. It's the folder's name too, and how events
  refer to the plugin, so don't change it once games use it.
- `version` is your plugin's own; `apiVersion` is the plugin API it was written for. This
  FreeQuest has API **1**, and refuses plugins that need a newer one.
- `entry`: the script, relative to the folder (`.js` or `.mjs`).
- `settings` are set once per project in Project settings; `commands` are used in events, each
  with its own `params`. Both are lists of parameters.

A JSON Schema for editors is in the FreeQuest repository, at
`packages/schema/json/plugin.schema.json`.

### Parameters

Every parameter has a `name` (how the script reads it), a `label` (what the editor shows), an
optional `description`, a `type` and, for most types, a `default`. Without a default, a
parameter starts at its type's own: off, 0 (or the lowest allowed), an empty text, white.

| Type        | Its value                                                             | Also              |
| ----------- | --------------------------------------------------------------------- | ----------------- |
| `boolean`   | on or off                                                             | `default`         |
| `integer`   | a whole number                                                        | `min`, `max`      |
| `number`    | any number                                                            | `min`, `max`      |
| `string`    | text                                                                  | `multiline`       |
| `choice`    | one of `options`, each `{ "value", "label" }`                         | `default` (value) |
| `color`     | a colour, `#rrggbb`                                                   | `default`         |
| `reference` | the id of something in the project: its `kind` (below)                | `optional`        |
| `asset`     | a file under `assets/`, chosen from `folder` (e.g. `assets/pictures`) | `optional`        |

A reference's `kind` is one of `switch`, `variable`, `map`, `character`, `actor`, `class`,
`skill`, `item`, `equipment`, `state`, `enemy`, `troop`, `commonEvent` or `animation`. The
editor offers the project's own as a list, and reports one that's gone. References and assets
must be chosen unless they're `optional`; an empty one is `""`. Renaming a switch, an item or
an asset in the editor also updates the plugin settings and commands that use it.

### The script

The script is a JavaScript module whose default export has a `setup` function. The game calls
it once, as it starts, with `api`:

```js
export default {
  setup(api) {
    const size = api.settings.size;
    let burstUntil = 0;
    let now = 0;

    api.onStep((game, dt) => {
      now += dt;
    });
    api.command('burst', ({ args }) => {
      burstUntil = now + args.seconds;
      // Let the event wait until the burst is over.
      return () => now >= burstUntil;
    });
    api.onDraw(({ context, camera, tileWidth, tileHeight, game }) => {
      if (now >= burstUntil) return;
      const x = game.player.x * tileWidth - camera.x + tileWidth / 2;
      const y = game.player.y * tileHeight - camera.y;
      context.fillStyle = '#fff6a0';
      for (let i = 0; i < 6; i++) {
        context.fillRect(
          x + Math.cos(now * 6 + i) * 10,
          y + Math.sin(now * 6 + i) * 10,
          size,
          size,
        );
      }
    });
  },
};
```

Hooks and commands can only be registered in `setup`. Every command in `plugin.json` needs a
handler, and only those commands can have one.

### The api

| What                        | What it does                                                                |
| --------------------------- | --------------------------------------------------------------------------- |
| `api.apiVersion`, `api.id`  | The plugin API's version (1) and the plugin's id.                           |
| `api.settings`              | The project's settings for it, every one filled in (defaults for the rest). |
| `api.onGameStart(fn(game))` | A new game, or a loaded save, starts.                                       |
| `api.onMapLoaded(fn(game))` | A map is shown: at the start, and after every transfer.                     |
| `api.onStep(fn(game, dt))`  | After each logic step on the map (60 a second; `dt` in seconds).            |
| `api.command(id, fn(call))` | Runs the command `id` when an event reaches it.                             |
| `api.onDraw(fn(frame))`     | Draws over the map, every frame it's shown.                                 |

Steps pause while the menu or a battle is open; drawing happens only on the map (not on the
title screen or in battles). Drawings go over the map, its characters and pictures,
and under screen fades and tints and the message windows.

**`game`** (passed to hooks, and as `call.game` and `frame.game`):

| What                                        | What it is                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game.map`                                  | The map: `id`, `name`, `width`, `height` (in tiles).                                                                                                                                                                                        |
| `game.player`                               | The player's tile and facing: `x`, `y`, `direction` (`up`, `down`, `left`, `right`).                                                                                                                                                        |
| `game.gold`                                 | The party's gold.                                                                                                                                                                                                                           |
| `getSwitch(id)`, `setSwitch(id, on)`        | A switch, by id.                                                                                                                                                                                                                            |
| `getVariable(id)`, `setVariable(id, value)` | A variable (whole numbers only).                                                                                                                                                                                                            |
| `playSound(path)`                           | Plays a sound under `assets/` once.                                                                                                                                                                                                         |
| `getData()`, `setData(value)`               | The plugin's own data, kept in saves: plain JSON (objects, arrays, text, numbers, on/off, null), up to 100,000 characters. `getData()` gives a copy; change it and store it again. Undefined in a new game; `setData(undefined)` clears it. |

**`call`** (a command's handler): `call.args` are its parameters, every one filled in;
`call.event` is the map event running it (null in a common event or a battle); `call.game`.
The handler returns nothing (the event goes on at once) or a function the event waits on until
it returns true, like a fade with "wait".

**`frame`** (`onDraw`): `frame.context` is the plugin's own
[Canvas 2D](https://developer.mozilla.org/docs/Web/API/CanvasRenderingContext2D) context,
cleared before each frame and as big as the game's screen (`frame.width`, `frame.height`, in
the game's own pixels). `frame.camera` is the map pixel at the screen's top-left: a map pixel
(x, y) is drawn at (x − camera.x, y − camera.y). `frame.tileWidth` and `frame.tileHeight` give
the tile size, `frame.seconds` the seconds since the game started (for animation), and
`frame.game` the game.

### When something goes wrong

If a plugin's script can't be loaded, or `setup`, a hook or a command throws, the game shows a
notice naming the plugin and what it was doing, and switches that plugin off for the rest of
the session. The game goes on, and so does the event that ran the command. In a playtest the
F9 debug panel helps too.

Look at the example plugins (`plugins/weather/main.js` and `plugins/hud/main.js` in the demo)
for complete ones.
