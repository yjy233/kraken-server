# Repository Guidelines

## Project Structure & Module Organization
Kraken Agent is a TypeScript/React/Express workspace. Core source lives in `src/`.

- Server entry: `src/server.ts`
- Frontend entry: `src/frontend/main.tsx`
- Market feature code: `src/market/`, `src/frontend/components/MarketPanel.tsx`, `scripts/market/`
- Static frontend bundle and styles: `public/`
- Technical and runbook docs: `docs/`
- Runtime data is local-only: `.sessions/`, `.scheduled-jobs/`, `.market/`, `.memory/`

Read the local project before making implementation claims. Prefer existing module boundaries and project conventions.

## Build, Test, and Development Commands
Use the npm scripts in `package.json` for this restored server app.

- `npm install`: install Node dependencies.
- `npm run dev`: start the TypeScript server with `tsx watch`.
- `npm run build`: build server and frontend.
- `npm run build:server`: compile TypeScript to `dist/`.
- `npm run build:fe`: bundle `src/frontend/main.tsx` to `public/app.js`.
- `npm run check`: run `tsc --noEmit`.
- `npm run start`: run `dist/server.js`.

Market data bridge dependencies are tracked in `pyproject.toml`; use `uv sync` when uv is available, or install the listed Python packages manually.

If you change TypeScript modules, run `npm run check` and the relevant build command. This repository does not currently expose a first-class automated test script.

## Coding Style & Naming Conventions
The codebase is TypeScript-first with ESM imports and `react-jsx`. Match the surrounding file style exactly: many files omit semicolons, use single quotes, and prefer descriptive camelCase for variables and functions, PascalCase for React components and manager classes, and kebab-case for command folders where present. Keep imports stable when comments warn against reordering. Prefer small, focused modules over broad utility dumps.

For frontend changes, keep UI copy concise and prefer Chinese text in the market/stock workflow unless surrounding UI is intentionally English.

## Testing Guidelines
There is no consolidated automated test suite configured at the repository root yet. For contributor changes, use targeted validation:

- run `npm run check`
- run `npm run build:fe` when touching frontend code
- run `npm run build:server` when touching server or shared TypeScript code
- manually exercise the specific API, service, or UI path you changed

When adding tests, place them close to the feature they cover and name them after the module or behavior under test.

## Commit & Pull Request Guidelines
Git history currently starts with a single `first commit`, so no strong conventional pattern is established. Use short, imperative commit subjects, for example `Fix MCP config normalization`. Pull requests should explain the user-visible impact, note restoration-specific tradeoffs, list validation steps, and include screenshots only for TUI/UI changes.

## Restoration Notes
This is a reconstructed source tree, not pristine upstream. Prefer minimal, auditable changes, and document any workaround added because a module was restored with fallbacks or shim behavior.

## Tool And Runtime Notes
Keep changes scoped to the requested behavior. Do not assume local API keys, browser tooling, or long-running services are already available. The standard agent guidance file for this repo is `AGENTS.md`; do not add a parallel `AGENT.md`.
