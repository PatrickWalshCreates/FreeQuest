# @freequest/editor

The FreeQuest editor: a React app that runs as a [Tauri](https://tauri.app/) desktop app, or in a
normal browser tab during development.

```bash
pnpm editor           # browser at http://localhost:5174, opens projects in samples/
pnpm editor:desktop   # desktop app (needs Rust; first build takes a few minutes)
```

- `src/`: the React UI. It only draws; editing logic lives in `@freequest/editor-core`.
- `src/fs/`: the two `ProjectFs` implementations. `tauri-fs.ts` reads and writes folders the user
  picked in the open dialog; `dev-fs.ts` talks to `dev-fs-plugin.ts`, a dev-server middleware that
  serves and writes files under `samples/` only.
- `src-tauri/`: the Rust shell. It only hosts the window and the fs and dialog plugins; add Rust
  here only when the web platform can't do something. Permissions are in `capabilities/`.
- `scripts/gen-icon.ts`: draws the (original) app icon and runs `tauri icon`.

Projects are read and written only through `@freequest/schema` (validation, migrations,
`stableStringify`), and play-testing reuses `@freequest/runtime`.
