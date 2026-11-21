# FreeQuest 0.7 project and save (frozen)

The demo project's data and plugins, and a save file made by the 0.7 game (Mira leading the
party, Formation turned off, the battle background an event chose, the elder's request
accepted), exactly as FreeQuest 0.7.0 wrote them. Never edit these files: tests check every
later version still opens the project with no problems and loads the save
(`editor-core/test/release-formats.test.ts`, `core/test/release-0.7-formats.test.ts`), and a
checksum test fails if anything here changes. When a format changes, add a migration instead.
A later release that changes a format adds its own folder beside this one.
