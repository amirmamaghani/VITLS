---
name: commit
description: 'Stage and commit changes with conventional commit format; use when "commit", "commit this", "stage and commit", or "make a commit".'
---

Stage and commit changes with conventional commit format.
Match repository's commit style.

# Git Commit Quick Reference

## Format

```
<type>(<scope>): <description>
```

## Common Types

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `refactor` - Code restructuring
- `perf` - Performance improvement
- `test` - Testing
- `chore` - Maintenance

## Common Scopes

Match recent `git log` scopes.

- `app` - VITLS agent-native app (`apps/app/`); sub-scopes like `app/coach`, `app/dashboard`, `app/integrations`
- `physiology` - shared metric/physiology package (`packages/physiology/`)
- `skills` - agent/dev skills (`.claude/skills/`, `apps/app/.agents/skills/`)
- `infra`, `docs`, `root` - configs, documentation, root-level files
- `*` - changes affecting multiple components

## Examples

### ✅ Good

```bash
feat(app/dashboard): let the coach compose widgets from goals
fix(app/integrations): dedupe Garmin and Apple Health workouts
docs(root): record wearable ingestion decision
refactor(physiology): extract EMA trend helper
test(physiology): cover water-vs-fat decomposition edge cases
chore(root): bump @agent-native/core
```

### ❌ Bad

```bash
fix stuff
Update files
new feature
WIP: symbols
Fixed the bug
```

## Breaking Changes

Add `!` after scope:

```bash
feat(app/integrations)!: restructure normalized sample schema

BREAKING CHANGE: Samples now require a source_device field.
Migration: Backfill source_device from the provider payload.
```

## Tips

- Keep description under 72 characters
- Use imperative mood ("add" not "added")
- No period at end of description
- Include body for complex changes
- Reference issues: `Closes #123`
