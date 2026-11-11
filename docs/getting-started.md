# Getting started

This guide takes you from nothing to a small game you can share: a map to walk around, someone to
talk to, a door into a second map, your own art, and a fight. It takes about half an hour.

## 1. Get the editor

FreeQuest isn't downloadable yet, so you build the editor from the source code once.

You need:

- [Node.js](https://nodejs.org/) 22 or newer, and [pnpm](https://pnpm.io/)
  (`npm install -g pnpm`).
- [Rust](https://rustup.rs) (stable), for the desktop app.
- On macOS, Apple's command line tools (`xcode-select --install`).

Then, in the FreeQuest folder:

```sh
pnpm install
pnpm build:editor-app
```

The app appears at `apps/editor/dist-app/macos/FreeQuest Editor.app`, with a disk image beside it
(`FreeQuest-Editor-<version>-macOS.dmg`) to share. Drag the app into **Applications**. It isn't signed by a registered Apple developer, so the first time, right-click
it and choose **Open**, then **Open** again. After that it opens normally.

> Just want a look? `pnpm editor` runs the same editor in your browser at
> http://localhost:5174, working on folders inside the FreeQuest repository (`samples/` and
> `projects/`).

## 2. Make a project

Click **New project…** on the start screen.

- **Game name**: what players see in the title bar and on the title screen. You can change it
  later.
- **Game id**: a short permanent name (letters, digits, `-`) that keeps your game's saves apart
  from other games'. It's filled in from the name; leave it as it is unless you have a reason.
- **Template**: **Starter** is one small map with a hero, a sign and a slime to fight: a clean
  place to begin. **Demo** is the full FreeQuest demo, with a quest, a second map and a party
  member to join, if you'd rather learn by taking something apart.
- **Folder**: where the project goes. FreeQuest creates a folder named after the game inside the
  one you choose.

The project opens. Next time, it's listed under **Recent** on the start screen.

### Find your way around

- The **sidebar** lists everything in the project: settings, assets, maps, tilesets, characters
  and the database. The **+** next to a heading makes a new one.
- The **problems** bar along the bottom lists anything that would stop the game, such as a door
  that leads nowhere. Click a problem to jump to it.
- **Undo** (⌘Z) and **Redo** (⇧⌘Z) cover every change. **Save** (⌘S) writes your changes to the
  project folder. Until you save, nothing on disk changes.

## 3. Paint the map

Click **First map**. The toolbar holds the painting tools:

| Tool      | Key | What it does                                                 |
| --------- | --- | ------------------------------------------------------------ |
| Pencil    | B   | Paints the chosen tile; drag to paint a line                 |
| Rectangle | R   | Drag to fill a rectangle                                     |
| Fill      | F   | Fills the connected area of the same tile                    |
| Eraser    | E   | Clears tiles (on upper layers, shows the layer below)        |
| Pick      | I   | Picks the tile under the pointer (right-click does this too) |
| Events    | V   | Places and edits events (see below)                          |

Pick a tile from the palette on the right, and the layer to paint on: **ground** for floors and
**upper** for things on top, like trees and furniture. Press **W** to see where the player can
walk: blocked cells are tinted. Scroll to move around; hold ⌘ (Ctrl on Windows) and scroll, or
press `=` and `-`, to zoom.

Press **▶ Play** at any time to try the game with your unsaved changes. **Stop** (or ⌘.) comes
back.

## 4. Someone to talk to

Choose the **Events** tool (V) and double-click an empty cell. An event appears with its editor on
the right.

1. Name it (say, "Old man").
2. Under **Graphic**, pick a character so it shows up on the map.
3. **Trigger: Talk / examine** means the player talks to it by facing it and pressing Enter.
4. Under **Commands**, click **+ Add → Show message**, type what they say, and click **Add**.

Play, walk up to them and press Enter.

Events can do much more: **Show choices** asks a question with a branch for each answer,
**If…** checks switches, variables, items or party members, **Set switch** lets an
event remember that something happened, and **Start battle** starts a fight. An event can have
several **pages**: the last page whose conditions are all met is the one that's active, which is
how an NPC says something new after you've helped them.

Select commands with Shift to copy a whole conversation (⌘C, ⌘V). Events and database entries
copy and paste too, even into another project.

### People who move, and things that happen on their own

- **Moves** (on the page, under Graphic): **Wanders about**, **Walks toward the player**, or
  **Walks a route** you set out step by step (↑ ↓ ← →, turns, waits). Speed is in tiles per second
  (the player walks at 4); Pause is how long they stand between steps. Nobody walks through
  walls, the player or each other, and an NPC stands still while you talk to them.
- **Move route** (a command) walks the player, the event itself or any event on the map along a
  route, for cutscenes: a guard stepping aside, the hero walking to the door. Tick **Wait until
  done** to finish the walk before the next command.
- **Trigger: Parallel** runs a page's commands over and over alongside play: a sound now and then,
  a timer, a switch that flips. If one shows a message, it waits until nothing else is running.
- **Trigger: Touch** on an NPC that walks toward the player makes a chaser: when it reaches the
  player, its commands start (a message, a fight). Like autorun events, give it a switch to turn
  it off afterwards, or it starts again.

## 5. A second map and a door

1. Click **+** next to **Maps**, name it ("House"), choose a size, and paint it.
2. Back on the first map, add an event where the door should be. Set **Trigger: Touch**, so it
   runs when the player steps on it (or bumps into it).
3. Add the command **Transfer player** and click **Choose on map…**. Pick "House", click the cell
   the player should arrive on, choose which way they face, and click **Use this cell**.

Add a door back the same way. If the arrival cell isn't walkable, the picker warns you.

## 6. Your own art and sound

Click **Assets** in the sidebar, then **Import…**, or drop files onto the panel. Images can be
PNG, WebP or JPEG; sounds can be WAV, OGG or MP3. Files are copied into the project, so the
originals stay where they were. The panel shows where each file is used, and lets you delete
unused ones.

- **Tilesets**: an image of square tiles in a grid (32 × 32 pixels each is usual). Click **+**
  next to **Tilesets**, pick the image and the tile size. Then mark tiles that block the player
  (**Walkable** mode: click or drag across tiles) and tiles drawn over the player, like treetops
  (**Above** mode). Choose a map's tileset in its settings.
- **Characters**: a sprite sheet with four rows (facing down, left, right and up) and a few walking
  frames in each row. Click **+** next to **Characters**, pick the image and the frame size. The
  preview walks all four ways at the player's speed. If your sheet's rows are in another order,
  rearrange them under **Directions**.
- **Music and sounds**: a map's music is in its settings. Title, battle and menu sounds are in
  **System** (in the database). The **Play music** and **Play sound** commands play them from
  events.

## 7. Heroes, items and fights

The **Database** section holds the game's rules: **Actors** (party members), **Classes** (how they
grow), **Skills**, **Items**, **Equipment**, **States** (poison, sleep…), **Enemies** and
**Troops** (groups of enemies). Every form is checked as you type. Damage is written as a short
formula, such as `a.attack * 4 - b.defense * 2`, where `a` is whoever acts and `b` is the target.

For random battles, open a map's settings and turn on **Random battles** with the troops that
roam there. For a set fight, use the **Start battle** command in an event; it can branch on
winning, escaping or losing.

Each enemy action can have **conditions**: its own HP below (or at least) a share of its max HP,
the turn number (from turn 2, every 3 turns…), or a state it has. An enemy picks, by rating, among
the actions whose conditions all hold, so a wolf can save its big attack for when it's hurt.

**Icons**: items, skills, equipment and states can have an icon from the game's iconset (set in
**System**; the templates come with one). Click **Choose…** on an entry's Icon to pick from the
sheet. Icons show in the game's menus, in battle and in shops.

**Shops**: the **Open shop** command lists goods (items and equipment, at their own price or the
shop's) and whether players can sell there (at half price; key items never). The event carries on
when the player leaves the shop.

## 8. Share it

Click **Export…**. FreeQuest checks the game first and lists anything that would stop it from
starting. Then:

- **Web** makes a folder to upload to itch.io or any website.
- **macOS app** makes an app people can double-click.

[Exporting and sharing a game](exporting.md) covers both in detail, including what players need to
know.

Players can change the music and sound volume and rebind the keys under **Options**, on the title
screen and in the menu. Their choices are kept with their saves.

## Keyboard shortcuts

| Keys                      | Where             | What                                          |
| ------------------------- | ----------------- | --------------------------------------------- |
| ⌘S / ⌘Z / ⇧⌘Z             | Everywhere        | Save / undo / redo                            |
| B R F E I V               | Map               | Pencil, rectangle, fill, eraser, pick, events |
| W / G                     | Map               | Walkable overlay / grid                       |
| `=` `-` `0`               | Map               | Zoom in / out / fit                           |
| Space + drag, middle drag | Map               | Scroll                                        |
| Delete, ⌘C / ⌘X / ⌘V      | Map (Events tool) | Delete, copy, cut, paste an event             |
| Enter, Delete, Alt+↑/↓    | Command list      | Edit, delete, move a command                  |
| Shift+↑/↓, ⌘C / ⌘X / ⌘V   | Command list      | Select several, copy, cut, paste              |
| W A S                     | Tileset           | Walkable, above, select modes                 |
| ⌘. (or Stop)              | While playing     | Back to the editor                            |

In the game itself: arrow keys or WASD walk, Enter or Space talks and confirms, Escape cancels and
opens the menu, and F9 shows a debug panel while you test.
