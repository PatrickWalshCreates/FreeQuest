# Changelog

What changed in each FreeQuest release. Versions follow [semantic versioning](https://semver.org):
before 1.0, a minor version (0.2, 0.3…) may change things, but projects made with an older
version always open and are upgraded automatically.

## Unreleased (0.5.0)

More of what RPG Maker MZ games use, in FreeQuest itself and brought across by the importer.

### Messages

- **Pacing**: `{wait:0.5}` pauses while text appears, `{key}` waits for a key and carries on in
  the same box, `{instant}…{/instant}` shows text at once. MZ's `\.`, `\|`, `\!`, `\>` and `\<`
  import as these.

### The player and actors

- The player **looks like the party's leader**. **Change actor** gives any actor another
  character or name for the rest of the game; **Hide or show the player**, and **Starts hidden**
  in Project settings, for intros and cutscenes. Both are kept in saves. MZ's Change actor
  images, Change name, Transparency and "start transparent" import as these.
- **Project settings → Player**: the character for an empty party, the walking speed and
  starting hidden.

### Move routes

- New steps: **diagonal moves**, **backward** (keeping the facing), **quarter turns**, **jump**
  (on the spot or up to 8 tiles), **look like another character**, **walk through things**,
  **keep facing**, **walking animation** on/off, **step in place**, **hide**/show, **play a
  sound** and **set a switch**, under "More…" in the route editor.
- Event pages can **step in place** (torches, fountains) and **walk through things**.
- MZ's move route commands and page options import as these (all but scripts, opacity, blend
  mode and frequency).

### Event commands

- **Set variable** to a **random number** or **game data**: gold, steps, play time, party size,
  items carried, a party member's stats, where the player or an event stands.
- **If…** tests a **held key**, a character's **facing**, a party member's **state**, **level**,
  **HP or MP**, and an actor's **name**.
- New commands: **Place event**, **Scroll map**, **Change HP**, **Change MP**, **Change state**,
  **Menu or saving on/off**, **Open save screen** (saving mid-event, as if it had finished),
  **Game over**, **Back to title**, **Change battle music** (battles or victory) and **Background
  sound**, a loop beside the music that maps can have too.
- MZ's Control variables (random and game data), branches on buttons, facing, actors' states and
  names, Set event location, Scroll map, Change HP/MP/state, save and menu access, Open save
  screen, Game over, Return to title, battle and victory music and background sounds import as
  these. Labels and jumps stay out: FreeQuest's commands are a tree.

## 0.4.0 (2026-11-14)

Bring your RPG Maker MZ game across: the editor imports an MZ project into a new FreeQuest
project, with its maps, database, events, characters, faces, music and sounds. Your MZ project
isn't changed, and anything FreeQuest can't do yet is listed in a report and kept as a comment
where it was. Project formats are unchanged from 0.3, so 0.3 projects open as they are.

### Importing from RPG Maker MZ

- **Import an RPG Maker MZ project…** on the start screen: choose the MZ project folder, name
  the game and choose where it goes. The report comes up when it's done and is saved in the
  project as `IMPORT-REPORT.md`. The [guide](docs/importing-mz.md) says what comes across and
  what to check.
- **Maps and tilesets**: every map with its layers; MZ's autotiles (water, paths, walls, roofs)
  become ordinary tiles, and walking works as in MZ (bridges over water, treetops over the
  player).
- **The database**: actors, classes, skills, items, weapons and armor, states, enemies and
  troops; traits become modifiers, and damage formulas are translated when they use the usual
  pieces.
- **Events**: pages, conditions, pictures, triggers and movement; messages with faces, names
  and colours; choices, branches, loops, switches, variables and self switches; transfers,
  battles, shops, move routes, screen effects, music and sounds; common events.
- **Pictures and sound**: characters, faces, enemy pictures, icons, the title, battle, victory
  and game-over music, system sounds and map music.
- **What doesn't come across yet** stays as a comment (“From MZ, not imported: …”); branches
  on things FreeQuest can't test use the switch “Imported: condition to redo”. Scripts and
  plugins are never run.
- The `freequest` command does the same: `freequest import mz <folder> --out <new folder>`.

- The report opens with a **summary by kind**, most common first ("Show animation: 80 times in
  71 places"), so it's clear what a game needs most.

### Also

- **Title music plays at once** where sound is already allowed (pressing Play in the editor, the
  desktop apps), instead of waiting for the first key.
- PNG pictures are read and written by FreeQuest itself, so imports are exact to the pixel.

## 0.3.0 (2026-11-14)

Editor comfort: paint with whole blocks of tiles, see where everything is used, rename ids and
files safely, build much bigger maps, give characters faces, and get new versions of the editor
without downloading them by hand. Projects and saves from 0.1 and 0.2 open as before and are
upgraded on save.

### Maps

- **Stamps**: drag across tiles in the palette (a tree, a house) and paint them as one block
  with the pencil, rectangle and fill. The **Select** tool (M) copies, cuts or clears an area of
  the map, every layer or just one, and the copy becomes your brush.
- **Bigger maps**: up to 512 × 512 tiles (was 256). The game and the editor only draw what's near
  the screen, so big maps open at once and play smoothly. Zoomed far out, the editor shows the
  map as a small picture you can still paint on.

### Finding and renaming

- **Used by**: switches, variables, maps, database entries and common events list every place
  that uses them, and deleting something tells you what still refers to it.
- **Switches and variables** can now be created, renamed and deleted in Project settings.
- **Rename id…** for switches, variables, maps, events, tilesets, characters and database
  entries changes every reference in one step (undoable). Saves made before the rename keep
  working.
- **Rename or move** asset files from the Assets panel: every image or sound path that uses the
  file is updated.

### Messages

- **Faces**: a message can show a face beside its text. A face sheet is a row of square faces
  as tall as the picture; pick the face in the message dialog, and the preview shows it. The
  demo's Elder and Mira have faces.

### The editor

- **Updates**: the desktop editor checks for a new version when it starts and offers to install
  it and restart (or skip that version). **Check for Updates…** is in the Mac menu bar, the Help
  window and the start screen. This is the first version that can update itself: from here on,
  new versions arrive in the editor.
- **Older projects, safely**: opening a project from an older FreeQuest says so; saving upgrades
  its files only after copying the originals, byte for byte, into the project's `backups/`
  folder. A project saved by a newer FreeQuest opens read-only instead of being overwritten.
- **Credits**: About and the website now say who made FreeQuest.

### Formats

- Project manifest 7 (a record of renamed ids, so older saves still load), maps 8 (message
  faces). Older files are read as before; the editor upgrades them on save.

## 0.2.0 (2026-11-11)

Events for real games: events can remember things, share commands, repeat, talk with names and
colours, and set the mood. Projects and saves from 0.1 open as before and are upgraded on save.

### Events

- **Event flags**: an event's own on/off notes, so a chest remembers it was opened without a
  switch per chest. A page condition and a Set event flag command (also for another event on the
  map). Kept in saves.
- **Common events**: command lists kept in one place (Database → Common events) and shared with
  Call common event, or run on their own (autorun or parallel) while a switch is on. Each shows
  where it's called. Projects from 0.1 add the list with one click.
- **Text codes** in messages, speakers and choices: variables, actor and party names, gold,
  item names, colours and icons, e.g. `{member:1} found {color:yellow}{v:coins} {currency}{/color}!`.
  The message dialog previews them and points out codes it doesn't understand.
- **Loops**: Loop repeats its commands until a Break loop; Exit event stops an event at once.
- **Screen effects**: fade to black and back, tint (kept in saves), flash and shake, each
  optionally waited for; Hide or show event.
- **Keep this facing** for event graphics, so chests and signs don't turn toward the player.

### The demo and the Starter

- The demo's house has a chest (a flag), a map on the wall you can look at again and again (a
  loop), and a hearth that calls a shared Rest (a common event that fades to black and back).
  The wolf's ambush shakes and flashes red; a few messages use colours and an icon.
- New Starter projects have the Rest common event and a sign that greets the hero by name.
- The house's map on the wall and its fireplace can now be seen (they were invisible); the
  fireplace is cold until you've agreed to help the elder, then lit.

### Fixes

- Sound and music now play in the desktop editor's playtests (the app's security settings
  stopped it loading them; browser mode and exported games weren't affected).

### Formats

- Project manifest 6 (common events), maps 7, saves 2 (flags and the screen tint). Older files
  are read as before; the editor upgrades them on save.

## 0.1.0 (2026-11-11)

The first public release: an editor, a game engine and exporters for classic 2D role-playing
games, free and open source (MIT).

### The editor

- **Projects**: start from the Starter or Demo template, reopen recent projects, undo and redo
  everything, and see problems listed as you work. Projects are plain JSON files that diff well
  in git.
- **Maps**: paint tiles with a pencil, rectangle, fill and eraser across layers; pick tiles from
  the map; see where the player can walk; resize maps from any side.
- **Events**: place NPCs, signs, doors and triggers with pages and conditions, and build their
  commands as a tree: messages, choices, branches, switches, variables, items, gold, party
  changes, battles, shops, transfers (pick the destination on the map), move routes, music and
  sounds.
- **Database**: actors, classes, skills, items, equipment, states, enemies, troops and system
  settings, in forms that check as you type, including damage formulas.
- **Art and sound**: import images and sounds, cut tilesets (walkable and drawn-above tiles) and
  character sheets (with a walking preview), and pick icons from the iconset.
- **Copy and paste** commands, events and database entries, also between projects.
- **Play** the game at any time with unsaved changes, from the title or from any cell.

### The games

- Grid movement, collision, layered maps, map transfers with fades.
- Events that run on talk, touch, on their own or alongside play; NPCs that wander, chase the
  player or walk a route; scripted move routes for cutscenes.
- A full RPG database with a safe formula language (no scripts), states, equipment and modifiers.
- Turn-based battles with random encounters and scripted fights; enemies choose actions by their
  HP, the turn or their states.
- Shops, an in-game menu (items, skills, equipment, status, save), three save slots, a title
  screen, music and sound effects, and an options screen (volume, key rebinding).
- Original placeholder art, music and sounds, generated by the repository's scripts.

### Sharing games

- Export a web game (any static host, such as itch.io), a Windows or Linux game, or a macOS app
  (signed ad-hoc; Apple Silicon and Intel), from the editor or the `freequest` command line. Any
  editor makes web, Windows and Linux exports; Mac apps need the Mac editor. Exports are checked first and contain only the files
  the game uses.
- A demo game, a Getting started guide and a website where the demo plays in the browser.
- The editor for Apple Silicon and Intel Macs, Windows (installer) and Linux (AppImage, .deb).

### Known limits

- The apps aren't signed by a registered developer yet: on a Mac, open them with right-click →
  Open the first time; on Windows, choose More info → Run anyway.
- The Linux builds haven't been tried on many distributions yet; reports are welcome.
