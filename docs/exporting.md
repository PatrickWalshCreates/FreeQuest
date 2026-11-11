# Exporting and sharing a game

FreeQuest turns a project into a game other people can play: a **web game** (a folder you upload
to a website), a **macOS app**, or a **Windows** or **Linux** game. Every export contains only the
files your game uses, and is checked first: if something would stop the game from starting,
FreeQuest tells you what and exports nothing.

## From the editor

Click **Export…** in the top bar.

1. Pick **Web**, **macOS app**, **Windows** or **Linux**. Mac apps need the editor on a Mac
   (they're signed with macOS's own tools); the downloadable editors make the other three
   anywhere.
2. Read the check: problems must be fixed first; warnings (such as a missing sound) are fine to
   ship. Unsaved changes are included.
3. Choose an **empty folder**. Exporting again into the same folder replaces the previous export
   after asking; a folder with anything else in it is refused, so nothing of yours is overwritten.

## From the command line

```sh
pnpm build                     # once, and after updating FreeQuest
pnpm freequest check <project>
pnpm freequest export web <project> --out <folder>
pnpm freequest export mac <project> --out <folder>   # macOS; see below
pnpm freequest export windows <project> --out <folder>
pnpm freequest export linux <project> --out <folder>
```

Windows and Linux exports need those systems' players in `apps/player-desktop/dist/windows` and
`…/linux` (the release workflow builds them; `--shell <folder>` points elsewhere).

Add `--clean` to replace a previous export in the same folder. Exit codes: 0 done, 1 the project
has problems, 2 the command was mistyped.

## Web games

The export is a folder: `index.html`, a `player/` folder (the engine) and a `game/` folder (your
game). Upload **the whole folder** to any static web host.

**itch.io:** zip the folder (its contents, with `index.html` at the top of the zip), create a new
project, set _Kind of project_ to **HTML**, upload the zip and tick _This file will be played in the
browser_. A viewport of the game's size, or 2× it, looks best; tick _Fullscreen button_ too.

Things to know:

- Opening `index.html` by double-clicking it won't work: browsers only let a page load the game's
  files when a web server sends them. The game says so if you try.
- Players' saves stay in their own browser, per game.
- F11 or Alt+Enter toggles fullscreen.

## macOS apps

The export is one app, named after your game (e.g. `My Quest.app`), that plays offline and keeps
saves as files. It runs on Apple Silicon and Intel Macs, and is about 11 MB plus your game.

Building one needs the desktop player app, made once with Rust installed. For the universal build
(both kinds of Mac), install Rust with [rustup](https://rustup.rs) and add both targets; with
another Rust it builds for your kind of Mac only:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm build:mac-player
```

**Sharing it:** zip the app (right-click → Compress) and send or upload the zip. The app is signed
_ad-hoc_, not with an Apple Developer ID, so the first time players open it macOS says it can't
verify the developer. They open it with **right-click → Open**, or **System Settings → Privacy &
Security → Open Anyway**. After that it opens normally. Signing with a Developer ID (a paid Apple
account) and notarizing removes the warning; FreeQuest doesn't do that yet.

Saves live in `~/Library/Application Support/org.freequest.player/saves/<game id>/`, one folder per
game id (set in Project settings; don't change it once players have saves).

## Windows and Linux games

The export is a folder named after your game. It holds the program (`My Quest.exe` on Windows,
`my-quest` on Linux, named after the game's id), a `game` folder and the licence notices. It plays
offline and keeps saves as files.

- **Windows:** zip the folder to share it. Players unzip it and run the program. It isn't signed
  by a registered publisher, so Windows may say it protected the PC: **More info → Run anyway**.
  It needs Microsoft's WebView2, which Windows 10 and 11 normally have.
- **Linux:** share it as a `.tar.gz` (right-click → Compress, or
  `tar -czf my-quest.tar.gz "My Quest"`), which keeps the program runnable. It needs WebKitGTK
  4.1, which most desktop Linux systems have (`libwebkit2gtk-4.1-0` on Debian and Ubuntu).

## Not yet

Installers for exported games, custom app icons, code signing with a registered developer
identity, and mobile.
