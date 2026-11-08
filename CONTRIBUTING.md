# Contributing to FreeQuest

Thanks for your interest! FreeQuest is pre-alpha, so expect things to move fast and break.

## The clean-room rule

FreeQuest is an independent implementation. **Do not contribute anything copied or derived from RPG
Maker**: code, plugins, assets, UI layouts or data files. Don't paste them into issues, PRs or AI
prompts either. Recreating general _behavior_ from your own understanding is fine. If you are unsure
whether something is OK, open an issue and ask first.

All art in this repo must be original and MIT-compatible.

## Getting started

```sh
pnpm install
pnpm dev     # play the demo at http://localhost:5173
pnpm check   # lint + typecheck + tests: run before every commit
```

## Ground rules

- `packages/core` is pure logic: no PixiJS, no DOM, no Node APIs. Lint and the compiler enforce this.
- Project files are written only through `stableStringify` from `@freequest/schema`.
- Changing a file format means bumping its `formatVersion` and adding a migration plus a test.
- New core behavior needs unit tests.

See [CLAUDE.md](CLAUDE.md) for the full architecture notes and roadmap.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
