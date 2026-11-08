# @freequest/editor (placeholder)

The FreeQuest editor will be a [Tauri](https://tauri.app/) desktop app, planned for **Milestone 6**:
map editor first, then the event and database editors.

Nothing is built here yet. Until then, project files are edited by hand (they are plain JSON; see
`packages/schema`). When the editor exists it must:

- read and write projects only through `@freequest/schema` (validation, migrations, `stableStringify`)
- reuse `@freequest/core` for game logic and `@freequest/runtime` for play-testing, never fork them
