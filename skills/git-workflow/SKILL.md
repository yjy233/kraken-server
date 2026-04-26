---
name: git-workflow
description: |
  Advanced Git operations and workflow guidance. Use when the user needs help with:
  (1) Interactive rebase, squash, or amend commits,
  (2) Cherry-pick, revert, or bisect operations,
  (3) Branch management and merge conflict resolution,
  (4) Git hooks, submodules, or advanced configuration,
  (5) Code review workflow (stash, patch, diff analysis).
---

# Git Workflow

## Core Principles

- Always check current branch and status before destructive operations.
- Prefer `git rebase -i` over merge commits for clean history.
- Never force-push to shared branches without confirmation.

## Common Workflows

### Interactive Rebase

```bash
# Rebase last N commits
git rebase -i HEAD~N

# Common actions in editor:
# pick   = keep commit
# reword = edit commit message
# squash = combine with previous
# fixup  = combine and discard message
# drop   = remove commit
```

### Safe Force Push

```bash
# Only after confirming no one else has pushed
git push --force-with-lease origin <branch>
```

### Stash Workflow

```bash
git stash push -m "descriptive message"
# ... do other work ...
git stash pop   # or git stash apply to keep stash
git stash list  # view all stashes
```

## Conflict Resolution

1. Run `git status` to identify conflicted files
2. Open each file and resolve markers (`<<<<<`, `=====`, `>>>>>`)
3. `git add <resolved-files>`
4. `git rebase --continue` or `git merge --continue`

## Reference

- Full rebase scenarios: See [references/rebase-scenarios.md](references/rebase-scenarios.md)
