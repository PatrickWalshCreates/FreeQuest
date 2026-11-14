# Release checklist

For maintainers. Automated checks cover the logic (`pnpm check`, CI), but some things only a person
can try: real file dialogs, restarts, macOS's security prompts, and how a game feels. Go through
this on the release build, ideally on a Mac user account that has never run FreeQuest.

## Before building

- [ ] `pnpm check` passes, and CI is green for the release commit.
- [ ] The `TAURI_SIGNING_PRIVATE_KEY` repository secret is set (the release fails without it).
      Its key file is backed up outside the repo: lose it and installed editors can never be
      updated again (a new key needs a manual download).
- [ ] `pnpm version:set <version>` and a `CHANGELOG.md` entry for it.
- [ ] `pnpm gen:notices` re-run if dependencies changed (no diff otherwise).
- [ ] `pnpm gen:art`, `pnpm gen:audio` and `pnpm gen:templates` leave no diff.
- [ ] `pnpm freequest check samples/demo-project` and `… templates/starter` report no problems.
- [ ] The guides (`docs/`), README and CHANGELOG describe every system the release supports
      (Mac, Windows, Linux): downloads, first-open steps, shortcuts (Ctrl, ⌘ on a Mac), exports.

## The editor app

- [ ] Opens with right-click → Open the first time (or normally, if signed), then by double-click.
- [ ] The start screen shows the right version; **Guide** and **About** open, the guide's links
      work (between pages, and web links open in the browser).
- [ ] **New project** from Starter: choose a folder in the system dialog, the project opens, and
      **Play** runs it (talk to the shopkeeper, buy something).
- [ ] Quit and reopen: the project is under **Recent** and opens with one click.
- [ ] Edit something, then quit: the app asks about unsaved changes. Cancel keeps it open; Save
      then quit works.
- [ ] **Assets**: import a PNG and a WAV by dropping them on the panel.
- [ ] **Check for Updates…** from the menu bar (app menu and Help) and the start screen shows a
      result in the corner (before publishing: "Couldn't check"; after: "newest version").
- [ ] A project from the previous release opens with the "older FreeQuest" notice; **Upgrade and
      save now** leaves its old files in `backups/` and the project opens clean afterwards.
- [ ] **Import an RPG Maker MZ project…**: choose an MZ project folder and a place for the new
      project in the system dialogs; the report comes up, **Open the project** opens it with no
      problems, and **Play** runs it with its own music and pictures.
- [ ] **Export → macOS app** to a new folder: the app is made, opens with right-click → Open, the
      game plays, and saving then reopening the game keeps the save.
- [ ] **Export → Web** to a new folder: upload or serve it (`vite preview --outDir <folder>`) and
      play it in a browser.

## The demo, played by hand

- [ ] Title screen: music plays after the first key; **Options** changes the volume and a key,
      and both are kept after quitting and reopening.
- [ ] The quest: the elder, the bridge, the wolf fight (won), the house, Mira joining.
- [ ] The peddler's shop: buy and sell; the farmer wanders; birdsong now and then.
- [ ] Menu: items, skills, equipment, status, save to a slot; **Continue** loads it.

## After publishing

- [ ] Download the release files from where players will get them and open them once more.
- [ ] The release has `latest.json` and a `.sig` beside each update file. An editor of the
      previous version offers the update at start; **Install and restart** brings it up as the
      new version (on a Mac, check whether it asks to be opened again), and a project still
      opens.
- [ ] Repository public, then Settings → Pages → Source: GitHub Actions; the Website workflow
      ran (it starts on publishing the release; rerun it by hand if Pages wasn't on yet).
- [ ] The website shows the new version (its download buttons name it: until the site updates,
      they point at the previous release's files and fail), the playable demo starts, and each
      download link fetches its file. If the Website run failed, run it by hand on main.
