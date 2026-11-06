# Upstream issue draft — BuilderIO/agent-native

**Filed:** https://github.com/BuilderIO/agent-native/issues/6998 (2026-10-07)

**Title:** Full-page AgentKit chat shows each assistant reply twice (live snapshot message + durable `server-run-*` message)

**Version:** `@agent-native/core` / `@agent-native/toolkit` / `@agent-native/agentkit` 0.203.0

## Summary

In a `CoreAgentKitRoot` chat (the chat template's `/chat/:id` route, unchanged `ChatRouteContent` wiring), every
completed run renders two assistant messages: the AgentKit message that streamed (e.g. `message-33105628-…`, with the
action widget) and, once the run completes, the durable server message `server-run-<runId>` with the same text but
no widget. Users see the reply stream, pause, and then start again. Reloading the thread shows both.

## Evidence (fresh thread, one prompt, one run)

Persisted `threadData` after the run:

- `messages` (durable): user `server-user-run-…` with `custom.agentKitMessageId = message-182d…` and
  `custom.submittedRunId`; assistant `server-run-1791407318481-zyz5hb` with `metadata.runId` and
  `custom.foldedRunIds`, parts `tool-call ×2, reasoning, text`.
- `agentKit.messages`: `message-182d…` (user), `message-33105628…` (assistant), with no metadata (no `runId`).
- `agentKit.events`: `[]`.
- `agentKit.runs[0]`: `{ id, status: "completed", lastSequence: 133, … }` with no `activeMessageId`.

The DOM during the run:

- 9 s: user message plus `message-33105628…` (streaming, widget shown).
- 17.5 s, after `run.completed`: `server-run-1791407318…` is added as a second assistant message.

## Likely cause

`reconcileDurableMessages` (`dist/client/chat/agentkit-agent-native.js`) links a snapshot assistant message to its
durable counterpart through `message.created` / `message.completed` events or `run.activeMessageId`. The persisted
snapshot carries neither: events are empty, the run has no `activeMessageId`, and the assistant message has no
`runId`. So the durable `server-run-*` message is never matched and renders as an extra message. The user message
reconciles fine because the durable copy carries `custom.agentKitMessageId`.

## Suggested fix

Persist the assistant's AgentKit message id on the durable message (as already done for user messages with
`agentKitMessageId`), or keep `run.activeMessageId` in the persisted snapshot, so reconciliation can fold the two.

## Deterministic reproduction in the pristine chat template (2026-10-10)

Reproduced with the unmodified `templates/chat` from `@agent-native/core-corpus@0.203.0` (standalone copy, same
package versions as the app, Anthropic provider, both the full-page `CoreAgentKitRoot` chat and the `AgentSidebar`
on `/database`). The trigger is the composer's queue path (`queueWhileRunning`, on by default):

1. Send a prompt whose reply takes a while (e.g. "write 400 words about …").
2. While it streams, send "ok" — the composer shows it as queued and sends it when the run finishes.
3. After the queued run completes, the persisted `threadData.agentKit._mergeRootMessages` is `true`, and the
   thread renders both the snapshot messages and the durable `server-*` copies (13 DOM messages for 12 stored ones
   here; in the app 13 for 8 after one queued message). Reload does not clear it.

Side effects seen in the same repro: the durable assistant message keeps only the last text segment of the long
reply, the snapshot message gets that segment appended twice (`text ++ text`), and in the full-page chat even the
durable text of a one-word reply came back doubled ("Ahoj!Ahoj!"). Threads where no message was ever queued stay
clean (`_mergeRootMessages` unset, 4 stored = 4 rendered after two turns), in the template and in the app alike.

## After upgrading to 0.206.0 (2026-10-10)

The maintainer's fix (assistant `message.created`/`completed`/`delta` and `reasoning.delta` now set
`run.activeMessageId`, shipped in 0.205.0) covers the plain case: a thread with two turns, each sent after the
previous reply finished, stays clean, and `_mergeRootMessages` no longer flips after a queued message.

The queue path still duplicates the queued turn's reply, though. Fresh thread, long prompt, "okej" sent while it
streams: 4 stored messages, 5 rendered. The snapshot assistant message for the queued run carries two text parts
("Dobre. Ak chcete…" ++ "Esej je hore hotová…"), the durable `server-run-*` message carries only the second text,
and the persisted runs still have no `activeMessageId`, so the durable copy renders as a fifth message next to the
snapshot one. Reload keeps both. The two texts are different generations for one `runId` (one `_debugRuns` entry).

## Root cause of the "two different replies for one run" variant (2026-10-10, 0.206.0)

Captured the SSE stream of a one-word prompt in the app (`frameworkTools` trimmed, `corpusTools: "lazy"`, the
plugin's default lazy context, `ask-question` not in `initialToolNames` but named in the system prompt):

```
model_stream start → text "Ahoj! …" → model_stream end reason=tool_use   (no tool_input_start, no tool_start)
model_stream start → model_stream end reason=end_turn                     (1 output token)
clear
model_stream start → text "Ahoj. …" → model_stream end reason=end_turn
model_stream start → model_stream end reason=tool_use → suggestions → done
```

Four `llm_call` spans for one turn. The first stop is the model loading a schema through the internal `tool-search`
(it reached for `ask-question`, which the prompt tells it to use); the follow-up call after the search result comes
back empty, the run loop treats the attempt as unfinished (`auto_continue` → internal continuation), sends `clear`
and regenerates. The server persists only the regenerated text; the AgentKit client keeps the first text as well
(the `clear` event does not drop the already-streamed text part), so the snapshot message ends with two text parts
and later the durable copy renders beside it. Two asks:

1. `clear` should empty the streaming assistant message on the client (or the server should not stream text it may
   discard before the continuation decision).
2. An empty assistant turn right after a `tool-search` result should not count as an unfinished attempt; the first
   text was a complete answer.

## Precise cause: the inline `suggest-follow-ups` call (2026-10-10)

`agent_evals` for such a run records `totalTools: 0`, so no app tool was involved. Chat runs always carry the
`suggest-follow-ups` tool (`followUpSuggestions: true` in `production-agent.js`) plus the instruction "before
finishing this turn, record your decision with suggest-follow-ups". When the model calls it in the same step as its
reply text, the loop (`toolCallParts.length === 0 && followUpResults.length > 0 && stop === "tool_use"`) flushes
the text and asks the model again. What the model does next decides the symptom:

- Haiku returns an empty step → `hasEmptyFinalResponse` → `clear` + "max_tokens" continuation → the reply is
  regenerated. The server keeps only the regenerated text; the client keeps both (it does not apply `clear`).
- Sonnet repeats the reply after the follow-up tool result → both copies are persisted ("Ahoj!Ahoj!" in the pristine
  template).

Ask: after a step whose only tool call is `suggest-follow-ups` and which already carries the final text, end the turn
with that text instead of asking the model again.

## Local state (VITLS)

Workaround: the system prompt ends with a plain prohibition: the coach must not call `suggest-follow-ups` at all;
when a turn ends without follow-ups the framework records them in its own completion step, which the loop handles
without a second generation. (A "call it first, alone" rule was ignored by Haiku whenever the turn started with other
tools.) Side effect of every variant: the assistant's own ids never reach `run.activeMessageId` in the persisted
snapshot on the sidebar path, so the durable `server-run-*` copy is matched by text only; while a reply streams, or
whenever the texts differ, the copy renders as a second message with a second widget card. Also every tool the coach guide and the system prompt name is in `initialToolNames`, so the model never goes
through `tool-search` for its everyday tools; a one-word prompt is back to one generation. Threads written before the
fix keep their doubled snapshot parts. Upgraded to `@agent-native/*` 0.206.0 (h3 aligned to ^2.0.2, sk/cs chrome catalogs extended by 35 keys). Beyond that,
no workaround in the app: the chat wiring matches the 0.203.0 chat template (AgentSidebar with a dashboard scope;
the probe above shows the scope is irrelevant), and `AgentSidebar` does not expose `queueWhileRunning`. Until the
fix ships, sending the next message only after the reply has finished avoids the trigger.

## Second case (2026-10-10, dashboard-scoped chat, `_mergeRootMessages: true`)

Thread `a960f39b…` (scope `vitls-dashboard`), two prompts ("ahoj", then "okej" sent while the first run was still
streaming, so it went through the queue). Persisted `threadData`:

- `messages` (durable, 4): `server-user-run-…xilzn8` (ahoj, `custom.agentKitMessageId = message-2b3004da…`),
  `server-run-…xilzn8` (assistant), `server-user-run-…zaq31v` (okej, `agentKitMessageId = queued-message-dbe0362a…`),
  `server-run-…zaq31v` (assistant).
- `agentKit.messages` (snapshot, 3): `message-2b3004da…` (ahoj), `message-705aad45…` (assistant, with the
  `get-health` tool call), `queued-message-dbe0362a…` (okej). The snapshot has no run ids, no `activeMessageId`,
  and `agentKit.events` only covers the second run.
- `agentKit._mergeRootMessages: true`.

Because `_mergeRootMessages` is set, `mergeStoredAndIncomingMessages(storedMessageProjection, agentKitMessages)`
concatenates both sets and dedupes by id only, so the rendered thread is 7 messages: "ahoj" twice, "okej" twice and
two first-run assistant replies. The `agentKitMessageId` link that normally hides the durable copy of a user message
is not consulted on this path. Reload does not clear it; the server returns the same `threadData`.

The two first-run assistant texts also differ ("Ahoj. Tvá váha vzrostla o 2,6 kg…" in the snapshot vs "Tvá váha se
zvýšila o 2,6 kg…" in the durable message, same numbers), i.e. the model's final text was produced twice for one
`runId`; `_debugRuns` lists the run once.

## Third case (2026-10-11, 0.206.0): snapshots without run events make every load replay the runs

Symptom in the VITLS sidebar: on a fresh load of a dashboard chat the client appended one new assistant message per
earlier run, with that run's reply text under a new `message-<uuid>` id and its own `show-widget` card, plus the banner
`run.events: replay did not confirm terminal snapshot`. The next snapshot write persisted those phantoms.

Not reproducible in the pristine `templates/chat` at 0.206.0 (sidebar on `/database`, one turn, reload: 2 messages,
no banner), and not reproducible in VITLS in a thread created today: both persist `agentKit.events` (9 projection
events per run) plus `_eventRunWatermarks` / `_eventRunSnapshotCommits`, so `acceptedEventCursor` equals the run's
`lastSequence` and no terminal catch-up starts. The app wiring (AgentSidebar with `scope`, `isolateHistoryByScope`,
`browserTabId`) is the same as the design template's.

The affected VITLS threads were all written between 2026-10-10 15:46 and 2026-10-11 08:46 from one browser session:
their snapshots have `runs[].lastSequence > 0` but `events: []` and no watermarks, and the first snapshot message of
the thread is missing. In that window the dev machine ran several `agent-native dev` servers over the same
`apps/app/node_modules/.vite` cache (504 "Outdated Optimize Dep", "Dev server out of sync"); the deps cache was rebuilt
at 21:15 and the session's tab kept running until the server restart on 10-11 10:41. Threads touched by that tab
lost their event snapshots; everything written by a fresh tab is fine.

What the framework then does with such a snapshot (all in `dist/client`):

1. `hasReplayCursor` is true because `agentKit.events` is `[]` (defined), the accepted cursor is 0 and
   `snapshotRun.lastSequence > 0` → `rememberTerminalRunCatchUp` for every completed run
   (`agentkit/dist/client/client.js`, thread hydration over `snapshot.runs`).
2. The catch-up subscribes to each run; the in-page adapter does not know it, so `restoreRunFromRuntime`
   (`agentkit-protocol.js`) rebuilds it from the runtime stream with `after: 0` and mints a fresh assistant id.
3. `remapTerminalCatchUpMessage` can fold the replayed message onto the stored one only through
   `run.activeMessageId` or persisted `message.*` events; the sidebar snapshot has neither, so the replayed text
   becomes a new message, the replayed `tool_done` re-attaches the `…:chat-ui` widget to it, and the terminal check
   fails on top.

Ask for upstream (small): when a persisted snapshot has no events for a run, treat `lastSequence` as unknown instead
of replaying the run into new messages — or at least do not persist the replayed messages. The replay is a repair
path and should never widen the thread.

Local repair (VITLS, 2026-10-11): `scratchpad/repair/repair.py` set `lastSequence: 0` on every persisted run that has
no events in the snapshot (no catch-up is attempted for them) and dropped assistant snapshot messages whose text repeats
an earlier assistant message in the same thread, with the widget entries that pointed at them. Row backups are next to
the script. The thread in active use at the time (`dfdcdd6f`, dashboard Chudnutie) was skipped.

### Correction (2026-10-11, later): runs that call tools never get their events persisted

The "one browser session" explanation above was incomplete. In a thread created from a fresh tab
(`62495ebd`), the first run (plain text reply) persisted 9 events, a watermark and `activeMessageId`; every later run
that called tools (`get-health` + `show-widget`) persisted nothing: `events` stay at the first run's 9,
`_eventRunWatermarks` keeps only the first run, the tool runs have no `activeMessageId`, and their `lastSequence`
(86, 88, 111, 143) equals the raw `agent_run_events` cursor. The client sent five `PUT /threads/:id` requests per run
(all 200). Consequence: the next submit (or load) catches up those runs, replays them and appends a copy of each
earlier reply with its widget card below the new one, plus the "replay did not confirm terminal snapshot" banner.
Same shape in the user's thread `40d87984` (one tool run, Sonnet). Not yet traced: whether the client drops the tool
run's events before `persistThreadSnapshot` or the server stages them as pending and never commits.

### Confirmed in the pristine chat template (2026-10-11, 0.206.0)

Same probe as above (`templates/chat`, sidebar on `/database`, Haiku). Thread `bceba636`: run 1 (plain text) persisted
9 events, watermark 36 and `activeMessageId`; run 2 ("Which tables exist in the database?", tools `tool-search` +
`db-admin-tables`) persisted nothing: no events, no watermark, no `activeMessageId`, `lastSequence 67`. On the next
load the sidebar showed "The run ended before it finished" for run 1 as well. So this is independent of the app:
any run with a tool call leaves a snapshot the client cannot catch up against.
After the next message in the same template thread the sidebar showed exactly the banner VITLS users see:
`run.events: replay ended without confirming terminal snapshot for run run-1791714872354-2o6uhi` (the tool run).


### Root cause and upstream evidence (2026-10-11)

**Filed:** https://github.com/BuilderIO/agent-native/issues/7377 (2026-10-11)

- Server side, `dist/agent/thread-data-builder.js` `foldThreadRunSuggestions` (called from `foldAgentChatRunCompletion`
  in `agent-chat-plugin.js`) writes the finished run into `agentKit.runs` with
  `lastSequence = max(agent_run_events.seq)` — the raw stream cursor (67, 86, 192 …). The client numbers its protocol
  events independently and persists compact history events renumbered 1..n per run. Once the server cursor is in the
  row, `mergeAgentKitEventRunSnapshots` treats the client's batch (`lastSequence` < stored run sequence) as stale and
  drops it, so tool runs end with no events, no watermark and no `activeMessageId`. Short text-only runs win the race
  (the client's batch lands before the fold) and look healthy. Unchanged in `0.207.0-nightly-20261011011527`.
- The client then hydrates with `hasReplayCursor` (events array present) and `snapshotRun.lastSequence >` its own
  cursor, starts a terminal catch-up, and the replay cannot reach that cursor: "replay ended without confirming
  terminal snapshot", plus replayed copies of earlier replies.
- Upstream's own beta e2e saw the same message on 2026-10-08 (issue #6826, analytics template, "second message" test:
  `run.events: replay ended without confirming terminal snapshot for run run-1791484018449-j4wchf`, alongside
  "lost or duplicated text" failures); the issue was closed as not planned without a diagnosis.

### Local decision (2026-10-11): stay on 0.206.0, repair the cursor in the database

0.204.0 was tried and rejected: it has no catch-up replay, but it still shows #6998 (every reply rendered twice after
a reload) and flips `_mergeRootMessages` on ordinary runs, which doubles the user's own messages. So the app stays on
0.206.0 and fixes the broken link in the chain where the app can reach it: migration 17 (`chat-thread-run-cursor`,
`server/plugins/db.ts`) installs a `BEFORE INSERT OR UPDATE` trigger on `chat_threads` that sets
`agentKit.runs[].lastSequence` to 0 for any run with no persisted events. The client's event batch is then not stale,
gets committed, and there is nothing to catch up. Test: `server/db/chat-thread-run-cursor.test.ts`. Remove the
migration (drop the trigger) once #7377 ships. The `suggest-follow-ups` prohibition in the system prompt is unrelated
and stays.
