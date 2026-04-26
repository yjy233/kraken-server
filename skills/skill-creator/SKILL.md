---
name: skill-creator
description: Create or update Kraken skills. Use when the user wants to design a new skill, improve an existing skill, scaffold SKILL.md structure, plan bundled references/scripts/assets, validate a local skill, or link it into the local Kraken skill registry.
---

# Skill Creator

## Purpose

Use this skill when the user is working on the Kraken skill system itself.

Your job is to help the user create skills that are:

- concise
- easy to trigger from metadata
- organized with progressive disclosure
- validated before linking or installing

## Workflow

1. Clarify the skill's trigger conditions.
2. Decide whether the skill needs `references/`, `scripts/`, or `assets/`.
3. Keep `SKILL.md` short and move detailed material into `references/`.
4. When creating a new local skill, prefer `skill_install` with `action="init_local"`.
5. After editing a skill, run `skill_install` with `action="validate_local"`.
6. During development, prefer `skill_install` with `action="link"` over copy-install.

## Writing Rules

- `name` must use lowercase letters, digits, and hyphens only.
- `description` must clearly say what the skill does and when to use it.
- Put procedural guidance in `SKILL.md`.
- Put detailed schemas, examples, or manuals in `references/`.
- Only add `scripts/` when deterministic execution or repeated logic matters.
- Only add `assets/` when files are meant to be reused in output.

## Authoring Guidance

- Assume the model is already capable. Do not waste tokens explaining basic concepts.
- Prefer one good workflow over many vague sections.
- If the skill supports several variants, keep the selection logic in `SKILL.md` and move variant details into separate reference files.
- If a skill is still full of placeholders or TODO items, do not link or install it as finished work.

## Kraken-Specific Guidance

- The current Kraken runtime exposes installed skills through prompt metadata plus the `skill` tool.
- Activating a skill loads its instructions and resource summary.
- Local authoring should follow:
  1. `skill_install` `init_local`
  2. edit files
  3. `skill_install` `validate_local`
  4. `skill_install` `link`

## Output Expectations

When you help create or update a skill:

- explain the trigger in one sentence
- keep the generated `SKILL.md` minimal
- validate before calling the work done
