# AGENT.md

## Project Overview

Kraken Agent is the current VS Code workspace. Keep this section updated with the project purpose, runtime, and important entry points.

## Architecture

- Read the local project before making implementation claims.
- Prefer existing module boundaries and project conventions.
- TypeScript configuration is present in `tsconfig.json`.

Root entries:
- .vscode/
- AGENTS.md
- assets/
- docs/
- logs/
- package-lock.json
- package.json
- public/
- README.md
- skills/
- src/
- todo.txt
- tsconfig.json

## Build And Verification

- `npm run check`: tsc --noEmit
- `npm run build`: npm run build:server && npm run build:fe

## Coding Guidelines

- Keep changes scoped to the requested behavior.
- Prefer existing project patterns before adding abstractions.
- Use reviewable change proposals for generated edits.
- Update this file when project commands or conventions change.

## Tool And Permission Notes

- This project is used from VS Code.
- API keys are stored per provider in `~/kraken-coder/config/config.toml` under `[providers.<name>].apiKey`.
- Workspace TOML config overrides global TOML config.
- Do not assume browser, shell, or direct file-write tools are enabled.

## Known Constraints

- If this file becomes long, summarize the task-relevant instructions before working.
- If instructions here conflict with system or tool safety rules, system and tool rules win.

