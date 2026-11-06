# Upstream issue draft — BuilderIO/agent-native

**Filed:** not yet

**Title:** Chat template sidebar: an archived thread comes back as "Untitled chat" when its run was observed in the tab

**Version:** `@agent-native/core` / `@agent-native/toolkit` / `@agent-native/core-corpus` 0.203.0

## Summary

In the chat template, archiving a thread from the sidebar context menu succeeds on the server (`POST
/threads/:id/archive` → 200, `archived_at` set, `GET /threads` no longer lists it) but the row immediately reappears
as "Untitled chat" and opens the archived thread. Archiving it again repeats the cycle. A page reload clears it.

## Reproduction

1. Open a thread and send one message (so the tab observes its run).
2. Context menu on the thread → Archive Chat.
3. The row returns as "Untitled chat"; clicking it opens the archived thread.

## Cause

`templates/chat/app/lib/sidebar-thread-state.ts` builds an optimistic row for every id in `observedThreadStarts`
(from `useAgentChatRunningThreads`) that the server list does not contain. `observedThreadStarts` only ever grows
for the lifetime of the page, and the server list excludes archived threads, so an archived thread that once ran in
this tab always gets a placeholder row — with `title: ""` and no `archivedAt`, so the `!thread.archivedAt` filter
does not catch it.

## Suggested fix

Build the placeholder rows from `runningThreadIds` instead of `observedThreadStarts`: a thread needs a placeholder
only while it runs and is not listed yet; once the run ends the server list has it (`messageCount > 0`), and once
archived it is gone.

## Local state (VITLS)

Fixed in `apps/app/app/lib/sidebar-thread-state.ts` (placeholders from `runningThreadIds`; test in
`sidebar-thread-state.test.ts`). Drop the local change when the template ships the same fix.
