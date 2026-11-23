# Getting started

This guide takes you from nothing to a small game you can share: a map to walk around, someone to
talk to, a door into a second map, your own art, and a fight. It takes about half an hour.

## 1. Get the editor

Download the editor for your computer from the
[FreeQuest website](https://patrickwalshcreates.github.io/FreeQuest/) or the
[latest release](https://github.com/PatrickWalshCreates/FreeQuest/releases/latest):

| Your computer                         | Download                                            |
| ------------------------------------- | --------------------------------------------------- |
| Mac with Apple silicon (M1 and later) | `FreeQuest-Editor-<version>-macOS-AppleSilicon.dmg` |
| Older Mac with an Intel processor     | `FreeQuest-Editor-<version>-macOS-Intel.dmg`        |
| Windows 10 or 11                      | `FreeQuest-Editor-<version>-Windows-setup.exe`      |
| Linux (most distributions)            | `FreeQuest-Editor-<version>-Linux-x86_64.AppImage`  |
| Debian, Ubuntu and similar            | `FreeQuest-Editor-<version>-Linux-amd64.deb`        |

FreeQuest isn't signed by a registered developer yet, so each system asks once:

- **Mac**: open the disk image and drag **FreeQuest Editor** into **Applications**. The first
  time, right-click it and choose **Open**, then **Open** again (or **System Settings → Privacy &
  Security → Open Anyway**). After that it opens normally.
- **Windows**: run the setup program. If Windows says it protected your PC, choose **More info →
  Run anyway**.
- **Linux**: make the AppImage runnable (right-click → Properties → allow running, or
  `chmod +x FreeQuest-Editor-*.AppImage`) and open it; or install the `.deb`
  (`sudo apt install ./FreeQuest-Editor-*.deb`).

**Updates**: from version 0.3.0, the editor checks for a newer version each time it starts. When
one is out, a panel in the corner offers **Install and restart** (save your project first),
**What's new**, **Later** or **Skip this version**. To check yourself, choose **Check for
Updates…** in the Mac menu bar (under **FreeQuest Editor** or **Help**), or **Check for updates**
in the editor's Help window or on its start screen.

**Projects from older versions** keep working. When you open one, a notice says which files are
in an older format: the editor has already upgraded them in memory, and nothing on disk changes
until you save. Saving (or **Upgrade and save now**) first copies the old files, exactly as they
were, into a `backups/` folder inside the project, then writes the new format. Delete that folder
once you're happy. A project saved by a _newer_ FreeQuest than yours opens read-only (saving is
turned off so nothing is damaged): update the editor first.

> Prefer to build it yourself, or help make FreeQuest? See
> [CONTRIBUTING.md](https://github.com/PatrickWalshCreates/FreeQuest/blob/main/CONTRIBUTING.md):
> `pnpm editor` runs the editor in your browser straight from the source code.

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

Already have a game in RPG Maker MZ? **Import an RPG Maker MZ project…** on the start screen
makes a FreeQuest project from it: see [Importing from RPG Maker MZ](importing-mz.md).

### Find your way around

- The **sidebar** lists everything in the project: settings, assets, maps, tilesets, characters
  and the database. The **+** next to a heading makes a new one.
- The **problems** bar along the bottom lists anything that would stop the game, such as a door
  that leads nowhere. Click a problem to jump to it.
- **Undo** (Ctrl+Z) and **Redo** (Ctrl+Shift+Z, or Ctrl+Y) cover every change. **Save**
  (Ctrl+S) writes your changes to the project folder. Until you save, nothing on disk changes.
- On a Mac, use ⌘ wherever this guide says Ctrl: ⌘Z, ⇧⌘Z, ⌘S and so on. The editor's own hints
  show the keys for your computer.

## 3. Paint the map

Click **First map**. The toolbar holds the painting tools:

| Tool      | Key | What it does                                                 |
| --------- | --- | ------------------------------------------------------------ |
| Pencil    | B   | Paints the chosen tile (or block); drag to paint a line      |
| Rectangle | R   | Drag to fill a rectangle                                     |
| Fill      | F   | Fills the connected area of the same tile                    |
| Eraser    | E   | Clears tiles (on upper layers, shows the layer below)        |
| Pick      | I   | Picks the tile under the pointer (right-click does this too) |
| Select    | M   | Selects an area to copy, cut or clear                        |
| Events    | V   | Places and edits events (see below)                          |

Pick a tile from the palette on the right, and the layer to paint on: **ground** for floors and
**upper** for things on top, like trees and furniture.

To paint something bigger than a tile, **drag across the palette** to pick a block of tiles (a
whole tree or a roof) and click to place it all at once; dragging the pencil lays copies side by
side, and Rectangle and Fill repeat it as a pattern. To reuse part of a map, choose **Select**
(M), drag out an area, and press Ctrl+C: it becomes your brush, every layer included (add Shift
for just the current layer), so the pencil places copies wherever you click. Ctrl+X cuts the
area instead, and Delete clears it. Press **W** to see where the player can
walk: blocked cells are tinted. Scroll to move around; hold Ctrl and scroll (or pinch on a
trackpad), or press `=` and `-`, to zoom. Maps can be up to 512 × 512 tiles; zoomed far out, the
map shows as a small picture of its tiles' colours, and you can still paint on it.

Press **▶ Play** at any time to try the game with your unsaved changes. **Stop** (or Ctrl+.) comes
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
Switches (on/off flags) and variables (numbers) are shared by the whole game: add them under
**Project settings → Switches** and **Variables**, where each one also shows what uses it.
Everything is referred to by its **id** (made from its name when you create it). To change one,
use **Rename id…** (on a switch or variable click its id; maps, events and database entries have
the button by their id): every door, condition, command and message that refers to it changes
too, in one step you can undo, and players' saves made before keep working. Items,
enemies and every other database entry show the same "Used by" list, and deleting anything that's
still used says where.

**If…** checks switches, variables, items or party members, **Set switch** lets an
event remember that something happened, and **Start battle** starts a fight. An event can have
several **pages**: the last page whose conditions are all met is the one that's active, which is
how an NPC says something new after you've helped them.

### Remembering things: event flags

**Event flags** are an event's own on/off notes, for things only that event needs to remember.
A chest can **Set event flag** "opened" after giving its treasure, and a second page with the
condition **flag "opened" is on** shows it open and empty. Every chest can use the same flag
name without getting mixed up, and flags are kept in saves. To change another event's flag (a
lever opening a gate), pick it under **Another event** in the command. The demo's house has a chest
that works this way: its chest character shows the lid closed facing down and open facing up,
and both pages tick **Keep this facing**, so the chest doesn't turn toward the player like a
person would.

### Sharing commands: common events

**Common events** are command lists kept in one place and shared, found under **Database →
Common events**. Make one for anything several events do the same way (an inn, a healer, a
cutscene that plays from different places), and use **Call common event** in each event: the
commands run there, then the event carries on. A common event can also start on its own:
**Autorun** runs it when nothing else is running, and **Parallel** runs it alongside play, both
while its **Switch** is on (an autorun one must turn that switch off, or it runs again and
again). Each common event says which events call it (or that it runs on its own), and deleting one
warns which events will need changing. The demo's fireplace (cold until you agree to help the elder, then lit) calls a "Rest" common
event, and new
Starter projects have one too.
Projects made before common events existed show **+ Common events** under Database: click it
to start the list.

### Repeating and stopping: loops

**Loop** repeats the commands inside it until a **Break loop** among them, for a question
asked until the player picks "Leave", or a countdown. A loop needs a **Wait**, a message or a
choice in it, or a way out, or the game stops it. **Exit event** ends the event at once, even
from inside a loop or a common event it called. The map on the wall in the demo's house is a
loop: look closer as often as you like, then step back.

### Fades, tints, flashes and shakes

**Screen effects** set the mood: **Fade screen** to black and back (the screen stays black
until you fade it in), **Tint screen** for dusk or a cave (it lasts until the next tint, also in
saves; strength 0 clears it), **Flash screen** for a hit or a spell, and **Shake screen** for an
earthquake. Each can wait until it's done before the event goes on. **Hide or show event** makes
an event vanish (a door that opens, a guard who leaves) until the map loads again. In the demo,
the wolf's ambush shakes and flashes red, and resting fades to black and back.

### Faces beside messages

A message can show a **face** next to its text. Import a face sheet into the **Faces** folder in
Assets: a row of square faces side by side, as tall as the picture (four 48 × 48 faces make a
192 × 48 image, e.g. calm, happy, sad and angry). In the message dialog, pick the sheet under
**Face** and click the face you want; the preview shows it. In the demo, the Elder and Mira
smile when they're pleased.

### Names, numbers and colours in messages: text codes

**Text codes** put names, numbers, colours and icons into messages, speakers and choices. Type
them in curly brackets:

| Code                   | Shows                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| `{v:id}`               | a variable's value                                                                |
| `{actor:id}`           | an actor's name                                                                   |
| `{member:1}`           | the name of the party's first (second…) member                                    |
| `{gold}`, `{currency}` | the party's gold, and the currency (e.g. G)                                       |
| `{item:id}`            | an item's name (`{equipment:id}` for equipment)                                   |
| `{color:red}…{/color}` | coloured text: white, gray, red, orange, yellow, green, blue, purple or `#rrggbb` |
| `{icon:3}`             | an icon from the iconset                                                          |
| `{wait:0.5}`           | a pause while the text appears, in seconds (up to 10)                             |
| `{key}`                | waits for a key press, then the text carries on in the same box                   |
| `{instant}…{/instant}` | text that appears all at once                                                     |
| `{{`                   | a `{` on its own                                                                  |

So `{member:1} found {color:yellow}{v:coins} {currency}{/color}!` might show "Hero found 12 G!"
with the amount in yellow. The message dialog previews the text as it will look (values only the
game knows show in [brackets]) and points out codes it doesn't understand. Pauses and waits
only show in the game: `Well…{wait:0.5} I suppose.{key} Fine, take it.` pauses, then waits for a
key before the last sentence (pressing a key while the text appears skips ahead to the next
`{key}`). Choices show names and
values but not colours or icons.

Select commands with Shift to copy a whole conversation (Ctrl+C, Ctrl+V). Events and database entries
copy and paste too, even into another project.

### Who the player looks like

The player looks like the first member of the party. **Change actor** (in the Party commands)
gives an actor another character or name for the rest of the game, whether they're in the party
or not: put a hero in disguise, or let the player name a companion's horse. **Hide or show the
player** makes the player invisible (they still move), handy for cutscenes and intros; in
**Project settings → Player**, **Starts hidden** begins the game that way. The same section sets
the character used when the party is empty, and the walking speed.

### Pictures over the map

**Show picture** (in the Screen commands) puts an image over the map, at a position on the
screen in pixels: a title card, a map, a portrait, a whole scene drawn by hand. Each picture has
a **number** from 1 to 100; higher numbers are drawn on top, and showing another image with the
same number replaces it. X and Y place its top-left corner or its centre, width and height are
percentages (100 = its own size), and opacity runs from 0 (invisible) to 1 (solid), so a picture
can start invisible and fade in. **Move picture** slides, resizes or fades it over some seconds,
starting or ending slowly if you like; tick **Wait until done** to let it finish first. **Erase
picture** takes it away. Pictures stay when the player changes maps and are kept in saves, until
erased. Put your images in `assets/pictures` (the Assets panel has a Pictures folder).

### Animations and balloons

**Show balloon** (Screen commands) pops a balloon over the player or an event: surprise, a
question, a heart, an idea, sleep… Tick **Wait until done** to let it finish before the next
command. The balloons are rows of one image, set under **Database › System › Balloons** (frame
size, frames per balloon and a name for each row); new projects have eight.

**Show animation** plays an animation on the player or an event: a sparkle of healing, a sword's
slash, an explosion. Animations are their own database category, **Database › Animations**: an
image of frames of the same size (read left to right, then down), how many frames, how many per
second, and sounds at chosen frames. The editor plays a preview as you change them. An animation
without an image still plays its sounds and takes its time, so you can time things before
drawing it.

In battle, a skill or item with an **Animation** plays it on each target before the damage shows.

### More from If…, Set variable and other commands

- **If…** can also test what only matters at that moment: **a key is held**, which way the
  player or an event is **facing**, whether a party member **has a state** (poisoned, asleep),
  their **level, HP or MP** (also as a percent of the most), or an actor's **name**. These are
  only offered in If…, not in page conditions.
- **Set variable** can set a **random number** (from–to, both included) or **game data**: gold,
  steps walked, play time in seconds, the party size, how many of an item the party carries, a
  party member's stat, or where the player or an event stands (x or y). Then check it with If….
- **Place event** puts an event on a tile at once (a number or a variable for each of x and y),
  facing a way if you like; until the map loads again.
- **Scroll map** moves the view away from the player by some tiles (the map's edges still stop
  it), for showing a place in a cutscene; **Back to the player** returns it.
- **Change HP**, **Change MP** and **Change state** affect one party member or everyone: a trap,
  a curse, a blessing. Losing HP stops at 1 unless **Can knock out** is ticked.
- **Menu, saving or formation on/off** stops the player opening the menu, saving from it, or
  changing the party's order with Formation (kept in saves,
  until turned on again). **Open save screen** lets them save right there (at a save point, even
  while saving is off); the save is made as if the event had finished. **Game over** and **Back
  to title** end the game.
- **Change battle music** sets the music for battles or for winning one (a boss theme); pick
  none to go back to the project's own. **Background sound** loops a sound beside the music (rain,
  wind, a crowd) until the map changes; each map can have its own under its settings.

### People who move, and things that happen on their own

- **Moves** (on the page, under Graphic): **Wanders about**, **Walks toward the player**, or
  **Walks a route** you set out step by step (↑ ↓ ← →, turns, waits). Speed is in tiles per second
  (the player walks at 4); Pause is how long they stand between steps. Nobody walks through
  walls, the player or each other, and an NPC stands still while you talk to them.
- **Move route** (a command) walks the player, the event itself or any event on the map along a
  route, for cutscenes: a guard stepping aside, the hero walking to the door. Tick **Wait until
  done** to finish the walk before the next command.
- Routes can do more than walk: diagonal moves, **Backward** (stepping back while still facing
  forward), quarter turns, and under **More…**: **Jump** (on the spot, or up to 8 tiles, landing
  only where there's room), **Look like a character** (a costume change, a statue coming to
  life), **Walk through things**, **Keep facing**, **Walking animation** off (sliding),
  **Step in place**, **Hide**, **Play a sound** and **Set a switch**. Changes to how an event
  looks last until its page changes; the player's until the party changes.
- On a page, **Steps in place** animates a graphic all the time (torches, fountains, flags) and
  **Walks through things** lets the event pass walls and characters (and them pass it).
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
PNG, WebP or JPEG; sounds can be WAV, OGG or MP3; fonts can be TTF, OTF, WOFF or WOFF2. Files are copied into the project, so the
originals stay where they were. The panel shows where each file is used, lets you delete unused
ones, and **Rename or move…** gives a file a new name or folder: everything that uses it follows,
and the old file is removed when you save (until then, Undo puts everything back).

- **Tilesets**: an image of square tiles in a grid (32 × 32 pixels each is usual). Click **+**
  next to **Tilesets**, pick the image and the tile size. Then mark tiles that block the player
  (**Walkable** mode: click or drag across tiles) and tiles drawn over the player, like treetops
  (**Above** mode). Choose a map's tileset in its settings.
- **Characters**: a sprite sheet with four rows (facing down, left, right and up) and a few walking
  frames in each row. Click **+** next to **Characters**, pick the image and the frame size. The
  preview walks all four ways at the player's speed. If your sheet's rows are in another order,
  rearrange them under **Directions**.
- **Title screen**: in **System**, turn on **Title screen** and choose a picture (any size: it's
  scaled to fill the screen) and whether the game's name is drawn over it.
- **Windows and fonts**: in **System › Windows**, choose how the game's windows look (messages,
  menus, battles, shops, the title): the window, border and text colours, how see-through
  windows are, the text size and spacing, the colours `{color:…}` names in messages, and a font.
  Import a font (TTF, OTF, WOFF or WOFF2) into the **Fonts** folder in Assets first, and check
  its licence lets you put it in a game. The preview beside the settings shows a message and a
  menu as the game draws them. The **Change window colour** command (in the Screen group)
  changes the colour for the rest of the game, until it's changed back to the project's own.
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

### Battles

**Modifiers** are how classes, actors, equipment, states and enemies change a battler: stats,
elements, hit and evasion chances, damage taken, and more. Some to try:

- **Counterattack physical hits**: a chance to strike back at an attacker instead of taking the
  hit. **Send magic back** returns a spell to its caster; **Dodge magic** makes it miss.
- **Extra actions**: a chance of acting once more each turn. Party members repeat their command;
  enemies choose another action.
- **Party ability**: while any standing member has it, the whole party gets **half as many**
  or **no random battles**, **double gold** or **double drop chances** after a win (a lucky
  charm, a thief's gloves).

Each enemy action can have **conditions**: its own HP below (or at least) a share of its max HP,
the turn number (from turn 2, every 3 turns…), or a state it has. An enemy picks, by rating, among
the actions whose conditions all hold, so a wolf can save its big attack for when it's hurt.

**TP**, a second resource for special moves: it runs from 0 to 100 and starts at 0 in each
battle. Party members and enemies gain it by taking damage (half of 100 for losing all their HP,
in proportion) and from skills and items that give it (**TP gained by the user**, or a **Gain
TP** effect). A skill's **TP cost** has to be paid like MP. The battle screen shows TP once
something in the game uses it, and formulas can read it as `a.tp`.

**Buffs and debuffs**: a **Buff or debuff** effect raises or lowers a stat by 25% for some
turns, stacking to two levels (±50%); using it again renews the turns. They end with the battle.
**Hits** makes a skill or item land on each target several times for one cost. A **Run a common
event** effect runs a common event once the skill or item has been used: in battle straight
away, or on the map once the menu closes.

**The party's order**: the first member leads (the player looks like them on the map), and the
first four fight; the rest wait. Players change the order with **Formation** in the game's menu
(pick a member, then the one to swap places with). Events can move a member to a place with
**Move a party member** (1 is the leader), and turn Formation off and on with **Menu, saving
or formation on/off** (a story scene where the order must stay).

**Where enemies stand**: a troop's **In battle** picture shows its battle screen with the
game's battle background. Drag the enemies to where they stand (by their feet): a bat higher
up, a boss in the middle. Until you move one they stand in an even row, and **Back to an even
row** returns there. If you add or remove an enemy afterwards, move one again to set them all.

**Battle events**: a troop's **Events** run commands during its battles: a boss's taunt on turn
1, help arriving when an enemy is badly hurt, a switch that changes the fight. Each has
conditions (the turn, an enemy's or party member's HP, a switch; all must hold), checked as each
turn starts (or ends, with **Checked as the turn ends**), and runs once a battle, once a turn,
or every time. Its messages and choices show over the battle. Commands that need the map
(transfers, routes, shops, another battle) can't be used there.

**How battles move**: enemies fade in and rise into place as a battle opens, each turn starts
with a short pause and a sound (**Database › System › Audio › Turn start**; the templates have
one), an enemy hops as it acts, and damage numbers pop up over who was hit (heals with a "+",
critical hits with a "!").

**Battle backgrounds**: a picture behind battles, scaled to fill the screen. Set the game's in
**Database › System › Battle background** (the templates use a meadow), a map's own in its
settings (a cave, a castle), and a battle's own in the **Battle** command. **Change battle
background** (in the add menu's World group) switches it for the rest of the game, over every
map's own, until changed back. Import pictures for it into the **Battle backgrounds** folder in
Assets.

### Icons and shops

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
- **Windows** and **Linux** make a folder with a program players run, for those systems.
- **macOS app** makes an app people can double-click (only the Mac editor can make these, as
  they're signed with macOS's own tools).

Any editor makes the web, Windows and Linux versions, whatever computer you're on.
[Exporting and sharing a game](exporting.md) covers each in detail, including what players need
to know.

Players can change the music and sound volume and rebind the keys under **Options**, on the title
screen and in the menu. Their choices are kept with their saves.

## Going further: plugins

Plugins add things FreeQuest doesn't do by itself. Every new project has two to try, turned off:
**Weather** (rain or snow on a map) and **HUD** (the gold or a variable on screen). Turn them
on in **Project settings › Plugins**, then add **Start weather** to an event from the **+ Add**
menu. [Plugins](plugins.md) explains using them safely and writing your own.

## Keyboard shortcuts

On a Mac, use ⌘ for Ctrl.

| Keys                           | Where             | What                                                  |
| ------------------------------ | ----------------- | ----------------------------------------------------- |
| Ctrl+S / Ctrl+Z / Ctrl+Shift+Z | Everywhere        | Save / undo / redo                                    |
| B R F E I M V                  | Map               | Pencil, rectangle, fill, eraser, pick, select, events |
| W / G                          | Map               | Walkable overlay / grid                               |
| `=` `-` `0`                    | Map               | Zoom in / out / fit                                   |
| Space + drag, middle drag      | Map               | Scroll                                                |
| Delete, Ctrl+C / X / V         | Map (Events tool) | Delete, copy, cut, paste an event                     |
| Enter, Delete, Alt+↑/↓         | Command list      | Edit, delete, move a command                          |
| Shift+↑/↓, Ctrl+C / X / V      | Command list      | Select several, copy, cut, paste                      |
| W A S                          | Tileset           | Walkable, above, select modes                         |
| Ctrl+. (or Stop)               | While playing     | Back to the editor                                    |

In the game itself: arrow keys or WASD walk, Enter or Space talks and confirms, Escape cancels and
opens the menu, and F9 shows a debug panel while you test.
