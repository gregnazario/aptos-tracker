# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Aptos Fund Flow Tracker — a single-package Node.js/TypeScript CLI + web app. Uses pnpm, Express, embedded SQLite (via `better-sqlite3`), and D3.js for visualisation. No Docker, no external database server, no monorepo sub-packages.

### Key commands

All scripts are in `package.json`:

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Lint (Biome) | `pnpm lint` |
| Format | `pnpm format` |
| Lint + format | `pnpm check` |
| Type-check | `pnpm typecheck` |
| Build (frontend + backend) | `pnpm build` |
| Build frontend only | `pnpm build:frontend` |
| Start web UI (dev) | `pnpm serve` (builds frontend, then starts Express on port 3000) |
| Run CLI | `pnpm dev -- <command>` (e.g. `pnpm dev -- list`) |

### Non-obvious notes

- **No `.env` in repo.** Copy `.env.example` to `.env` before first run. The app works without an `APTOS_API_KEY` but rate-limited against the Aptos Indexer.
- **Seed test data** for local dev/testing without real blockchain access: `npx tsx src/seed-test-data.ts`. This inserts 5 sample transfers and 2 tracked addresses into the local SQLite DB (`aptos-tracker.db`).
- **SQLite DB file** (`aptos-tracker.db`) is auto-created in the project root on first run. It is gitignored.
- **Frontend bundle** (`public/js/bundle.js`) is gitignored and rebuilt by `pnpm build:frontend` or `pnpm serve`.
- **Two tsconfig files**: `tsconfig.json` (backend, excludes `src/frontend/`) and `tsconfig.frontend.json` (frontend only, DOM libs). `pnpm typecheck` runs both.
- **Biome** replaces ESLint + Prettier. Config is in `biome.json`.
- The `pnpm-workspace.yaml` only configures `onlyBuiltDependencies` for native addons (`better-sqlite3`, `esbuild`); there are no workspace sub-packages.
