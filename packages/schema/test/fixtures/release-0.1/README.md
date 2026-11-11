# FreeQuest 0.1 project and save (frozen)

The demo project's data and a save file exactly as FreeQuest 0.1.0 wrote them. Never edit these
files: tests check every later version still opens the project with no problems and loads the
save (`editor-core/test/release-formats.test.ts`, `core/test/release-formats.test.ts`), and a
checksum test fails if anything here changes. When a format changes, add a migration instead.
A later release that changes a format adds its own frozen folder beside this one.
