# Importing from RPG Maker MZ

Already making a game in RPG Maker MZ? FreeQuest can turn your MZ project into a FreeQuest
project: its maps, database, events, characters, faces, music and sounds. Your MZ project isn't
changed: the import only reads it and writes a new project folder.

FreeQuest is its own engine, not a copy of MZ, so not everything has a match yet. Nothing is
dropped silently: whatever can't come across stays where it was as a comment saying what it
was, and every item is listed in a report.

RPG Maker is a trademark of its owners. FreeQuest isn't connected with them; it reads MZ's
project files so you can bring your own work across.

## What you need

- **Your MZ project folder**: the one with `game.rmmzproject` in it, as MZ's editor saves it.
  A game deployed for players (with encrypted pictures, files ending in `.png_`) won't import
  its pictures; use the project folder instead.
- The FreeQuest editor, **0.4 or later**.

## Importing in the editor

1. On the start screen, choose **Import an RPG Maker MZ project…**.
2. **Choose…** the MZ project folder. FreeQuest reads the game's title and suggests it as the
   name.
3. Check the **game name** and **game id** (the id keeps the game's saves apart from other
   games; see Getting started), and **Choose…** where the new project goes. It's made in a new
   folder named after the game.
4. **Import**. A big project takes a few seconds.
5. The list that comes up is the import report (it's also saved in the project as
   `IMPORT-REPORT.md`). **Open the project** to carry on.

From the command line, the same import is:

```
freequest import mz <mz-project-folder> --out <new-folder> [--name "Game name"]
```

## What comes across

- **Settings**: the title, screen size, starting map and position, the starting party.
- **Switches and variables**, with their names. Ids come from the names (`Met the elder` becomes
  `met-the-elder`); unnamed ones that something uses become `switch-12` and so on.
- **The database**: actors, classes (stats per level), skills, items, weapons and armor (as
  equipment), states, enemies (with their actions and when they use them) and troops. Traits
  become FreeQuest's modifiers. Damage formulas are translated when they use the usual pieces
  (`a.atk * 4 - b.def * 2`, `Math.floor`, `v[3]`…).
- **Maps and tilesets**: every map, with its layers, walls and water. Autotiles become ordinary
  tiles, so each MZ tileset becomes one FreeQuest tileset holding the tiles its maps use. Where
  you can walk works as in MZ (bridges over water, treetops drawn over the player).
- **Characters, faces, enemy pictures and icons**, cut out of MZ's sheets as FreeQuest needs
  them. The player looks like the first party member.
- **Events and common events**: pages with their conditions, picture, trigger, priority and
  movement; messages with faces, names, colours and pacing; choices, branches, loops; switches,
  variables and self switches (which become FreeQuest's event flags); gold, items, the party;
  transfers, battles with their win/escape/lose branches, shops, move routes, screen effects,
  waits, music and sounds; actors' new names and pictures, hiding the player, and move routes'
  jumps, diagonals, image changes, through, direction fix, animation, sounds and switches (from
  0.5). Also from 0.5: random numbers and game data in Control variables (items, gold, steps,
  play time, party size, actor stats, positions), branches on buttons, facing, actors' states
  and names, Set event location, Scroll map, Change HP/MP/state, save and menu access, Open save
  screen, Game over, Return to title, battle and victory music changes and background sounds;
  and pictures: Show, Move (with its easing) and Erase picture, with the images they use;
  Show balloon (with the project's balloon image) and Show animation.
- **Animations**: MZ's are Effekseer effects, which FreeQuest can't play or turn into frames. Each
  one an event, skill or item uses becomes a stand-in in **Database › Animations** with its name,
  about its length and its sounds at their times, but no image: the report counts them under
  "Animations to draw". Give each an image of frames and it plays where MZ's did, also in
  battle. Flashes aren't brought across.
- **The title screen**: its background with its frame drawn over it, as one picture, and
  whether the game's name shows (from 0.5).
- **Music and sounds**: the title, battle, victory and game-over music, the system sounds, and
  each map's music and background sound. Only `.ogg` files are copied (FreeQuest doesn't play
  `.m4a`).

## What doesn't (yet)

The report names each one and where it was. The usual ones:

- **Scripts and MZ plugins**: FreeQuest doesn't run JavaScript written for RPG Maker, so script
  calls and plugin commands stay as comments, naming the plugin and the command. The report
  lists the MZ plugins the game used (from `js/plugins.js`, read but never run) and counts each
  plugin's commands, so you can see what to replace, with a FreeQuest plugin or a feature of
  FreeQuest's own.
- **Commands FreeQuest doesn't have**: weather, labels and jumps, swapping two events' places,
  rotating or tinting pictures, and more. They stay as comments saying "From MZ, not
  imported".
- **Branches on things FreeQuest can't test** (a script, an actor's class or skill, buttons
  other than the arrows, OK, Cancel and Menu…) keep both
  sides, but test the switch **Imported: condition to redo**, which is never on: the "else"
  side runs until you change the condition.
- **Battle features**: counterattacks, extra attacks, removing buffs, and the battle commands
  for enemies (changing an enemy's HP or states, forcing an action, aborting the battle).
  Experience curves are FreeQuest's own shape, set from each class's base value. TP, buffs and
  debuffs, skills that hit several times, items and skills that call common events and troops'
  battle events come across (from 0.5).
- **Map details**: water is still (its first frame), wall shadows and regions aren't used, and
  tiles you can pass from some sides only become walkable from every side.
- **Font size changes** in messages (and `\^`, `\$`) are left out. Pauses (`\.`, `\|`), waits
  for a key (`\!`) and instant text (`\>`…`\<`) come across as FreeQuest's `{wait}`, `{key}` and
  `{instant}` codes (from 0.5).

Many of these are coming: the next version of FreeQuest adds what MZ games use most.

## After importing

1. Read the report. Most items are things to redo by hand or to wait for.
2. **Play** the game from the start and walk through it: a conversation that reads oddly or a
   door that goes nowhere is usually something in the report.
3. In events, search for comments starting **From MZ** and for the switch **Imported: condition
   to redo** (its **Used by** list in Project settings shows every place).
4. MZ projects keep maps you may not use any more; delete them in the editor if you like.
5. Save, and carry on making the game in FreeQuest.
