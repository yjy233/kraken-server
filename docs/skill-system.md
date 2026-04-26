# Kraken Agent Skill System

## 1. Goal

Kraken Agent uses a two-layer skill architecture:

- `skill` tool: activate an installed skill and read its `references/` files
- `skill_install` tool: initialize, validate, link, inspect, or install a skill into the local skill registry

This keeps skill usage structured and auditable. The agent does not rely on magic text like `LOAD_SKILL:xxx`.

## 2. Skill Format

Each skill is a directory:

```text
skill-name/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

`SKILL.md` must contain YAML frontmatter:

```md
---
name: skill-name
description: |
  Describe what this skill does and when to use it.
---
```

Required fields:

- `name`
- `description`

The body of `SKILL.md` is the instruction payload returned by the `skill` tool when a skill is activated.

## 3. Discovery Order

Skills are discovered in this order, with higher-priority directories overriding lower-priority ones:

1. `KRAKEN_SKILLS_DIR`
2. `./skills`
3. `~/kraken/skills`
4. `~/.kraken/skills`

Implementation:

- [src/skills/registry.ts](/Users/bill/code/kraken-server/src/skills/registry.ts)
- [src/skills/manager.ts](/Users/bill/code/kraken-server/src/skills/manager.ts)

The running server uses a dynamic registry via `getAvailableSkills()` / `refreshSkills()`. This is important because newly installed skills must become visible without restarting the service.

## 4. Runtime Model

### 4.1 Available Skills

All discovered skill metadata is always included in the system prompt:

- skill `name`
- skill `description`

Prompt builder:

- [src/agent/prompt-builder.ts](/Users/bill/code/kraken-server/src/agent/prompt-builder.ts)

The prompt tells the model to use the `skill` tool when it needs a skill.

### 4.2 Activated Skills

Activated skills are tracked per session, not globally.

Session state stores:

- `loadedSkills: string[]`

Server persistence:

- [src/server.ts](/Users/bill/code/kraken-server/src/server.ts)

Frontend session types:

- [src/frontend/types.ts](/Users/bill/code/kraken-server/src/frontend/types.ts)

This avoids leaking activated skill state across sessions.

## 5. Tools

### 5.1 `skill`

Purpose:

- activate an installed skill
- read a reference file from an activated skill

Supported actions:

- `activate`
- `read_reference`

Implementation:

- [src/tools/skill.ts](/Users/bill/code/kraken-server/src/tools/skill.ts)

Behavior:

- `activate` returns the skill description and full `SKILL.md` body
- `read_reference` only allows files under `references/`

Reference path enforcement:

- [src/skills/registry.ts](/Users/bill/code/kraken-server/src/skills/registry.ts)

### 5.2 `skill_install`

Purpose:

- install a new skill into the local registry
- inspect an already installed skill

Supported actions:

- `install`
- `inspect_installed`
- `init_local`
- `validate_local`
- `link`

Implementation:

- [src/tools/skill-install.ts](/Users/bill/code/kraken-server/src/tools/skill-install.ts)
- [src/skills/install.ts](/Users/bill/code/kraken-server/src/skills/install.ts)

Current install scope:

- ClawHub slug or page URL install
- GitHub repo path install
- local skill scaffold creation
- local skill validation
- local skill linking for development
- download archive
- extract
- validate `SKILL.md`
- copy into local install directory
- refresh runtime registry

Default install location:

- `~/kraken/skills`

If `KRAKEN_SKILLS_DIR` is set, that path becomes the install target.

If the default install directory does not exist yet, the installer creates it automatically.

Install input modes:

- ClawHub: `source="clawhub"` with `slug="owner/skill"` or a ClawHub skill page URL
- GitHub: `source="github"` with `repo="owner/name"` and `path="path/to/skill"`
- Local scaffold: `action="init_local"` with `name="skill-name"` and `base_dir="/abs/path/to/skills"`
- Local validation: `action="validate_local"` with `path="/abs/path/to/skill"`
- Local link: `action="link"` with `path="/abs/path/to/skill"`

## 6. Installation Flow

When the agent needs a new skill:

1. call `skill_install` with `action="install"`
2. server installs the skill into the local skill directory
3. server calls `refreshSkills()`
4. the skill becomes visible in the current process
5. the agent can then call `skill` with `action="activate"`

This is why the skill registry must be dynamic instead of a startup-time constant.

For local skill development:

1. call `skill_install` with `action="init_local"`
2. edit the generated files
3. call `skill_install` with `action="validate_local"`
4. call `skill_install` with `action="link"`

## 7. Session Persistence

During chat runs:

- session `loadedSkills` is restored into runtime state before execution
- newly activated skills are written back to session JSON after execution

Result:

- refreshing the page keeps activated skills for that session
- reopening an old session restores its activated skills

## 8. Frontend

The frontend currently shows:

- `Available Skills`
- `Active Skills`

Sidebar implementation:

- [src/frontend/components/Sidebar.tsx](/Users/bill/code/kraken-server/src/frontend/components/Sidebar.tsx)

`Available Skills` comes from `/api/config`.

`Active Skills` comes from the selected session’s `loadedSkills`.

## 9. Security Boundaries

The current design intentionally limits what skill installation can do:

- install only into the configured skill directory
- local link only points at a validated skill directory
- do not execute `scripts/` during install
- validate that `SKILL.md` exists
- allow `read_reference` only under `references/`

This keeps skill installation separate from general shell execution.

## 10. Current Limitations

The current `skill_install` implementation is intentionally minimal:

- ClawHub install depends on the downloadable archive exposed by the ClawHub skill page
- GitHub install uses default branch archive download unless a ref is provided
- no marketplace integration
- no dependency/bootstrap hooks
- no manual install UI in frontend

These are acceptable for the first controlled implementation.

## 11. Recommended Next Steps

1. Add explicit install source support for marketplace metadata
2. Add frontend install UI for known skills
3. Expose `refreshSkills()` through a dedicated API for admin/debug flows
4. Add install provenance metadata such as source repo and ref
