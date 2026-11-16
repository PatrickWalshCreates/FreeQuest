# FreeQuest 0.5 project and save (frozen)

The demo project’s data and a save file (made by the 0.5 game: Mira in the party and renamed,
the chest opened, the elder’s map shown as a picture, saving turned off, another battle music, a
tint) exactly as FreeQuest 0.5.0 wrote them. Never edit these files: tests check every later
version still opens the project with no problems and loads the save
(`editor-core/test/release-formats.test.ts`, `core/test/release-0.5-formats.test.ts`), and a
checksum test fails if anything here changes. When a format changes, add a migration instead.
A later release that changes a format adds its own frozen folder beside this one.
