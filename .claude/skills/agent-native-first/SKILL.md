---
name: agent-native-first
description: >-
  Mandatory gate for EVERY source change in this app: study the version-matched
  Agent-Native docs and template corpus first, then implement the smallest
  change under the reducing-entropy skill. Load this before adding, editing,
  refactoring, or deleting any action, component, schema, route, skill, config,
  or script — even for "small" or "obvious" edits, bug fixes, and copy changes.
  Trigger on any request that will touch files in this repo.
scope: dev
---

# Agent-Native First

No code is written from memory. Every change is grounded in the installed
framework docs, copies a proven first-party pattern where one exists, and
leaves the codebase smaller or equal in size.

## The Gate

Do these steps in order. Do not open an editor before step 3.

### 1. Study (read before you write)

Run the version-matched lookups from `agent-native-docs`:

```bash
pnpm action framework-search --pattern "<feature or API>"
pnpm action docs-search --slug <slug>
pnpm action source-search --pattern "templates/*/<area>/*.ts" --mode glob --scope source
```

Pick slugs by task area:

| Task touches                 | Read slugs                                           | Also load skill      |
| ---------------------------- | ---------------------------------------------------- | -------------------- |
| An action                    | `actions-defining`, `actions-access-control`         | `actions`            |
| A table, query, or migration | `server-database`, `security`                        | `storing-data`, `portability` |
| A new capability or feature  | `actions-overview`, `context-awareness`              | `adding-a-feature`   |
| UI or shared chrome          | `agent-surfaces`, `client-data`                      | `agent-native-toolkit`, `customizing-agent-native` |
| Anything AI/LLM              | `using-your-agent`, `agent-surfaces`                 | `delegate-to-agent`  |
| Credentials or integrations  | `security`                                           | `secrets`            |
| Skills or instructions       | `skills-guide`, `writing-agent-instructions`         | —                    |

Then grep the template corpus for the same problem and prefer copying a
whole file over writing the pattern fresh:

```bash
rg -n "<pattern>" node_modules/@agent-native/core/corpus/templates
```

### 2. Plan under reducing-entropy

Load `reducing-entropy`, pick one mindset from its `references/`, and answer
its three questions in writing:

1. Smallest codebase that solves this?
2. Does the change result in less total code? Count lines before and after.
3. What can be deleted as a result?

If a doc-recommended pattern conflicts with a smaller hand-rolled one, the
framework pattern wins (the framework is a strong convention; do not fight it).
Everything else biases toward deletion.

### 3. Report the study before implementing

Post a short block, then implement:

```
Docs read: <slugs / corpus files>
Pattern reused: <path copied or "none, new">
Mindset: <reference name>
Net lines: <before → after>
Deleting: <files/functions> or "nothing"
```

If step 1 found no docs coverage, say so explicitly. Never claim a doc
supports a choice it does not.

### 4. Implement

- Follow `adding-a-feature` parity: UI, action, application state, skill.
- Data in SQL, scoped by `ctx.orgId`; blobs in file storage; no secrets in code.
- No inline LLM calls, no pass-through `/api/*` routes, no edits to `node_modules`.
- Copy template app code freely; for `core`/`toolkit` internals follow the
  configure → compose → eject ladder from `customizing-agent-native`.

### 5. Verify

```bash
pnpm agent-native:doctor
pnpm typecheck
```

Re-read every written file or row before reporting done. Fix all doctor
findings; do not report partial success as success.

## Don'ts

- Do not skip step 1 because the task looks trivial.
- Do not write an abstraction the docs or corpus do not already use.
- Do not add a file when an existing one can absorb the change.
- Do not leave dead code, unused exports, or compatibility shims behind.
