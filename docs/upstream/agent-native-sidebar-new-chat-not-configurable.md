# Upstream issue draft: AgentSidebar cannot hide its new-chat button

**Package:** `@agent-native/toolkit` 0.203.0, `dist/app/chat/AgentPanel.js` (`renderHeaderActions`, `renderChatHeader`)

## Symptom
An app that wants exactly one conversation per scope (`scope` + `isolateHistoryByScope`) cannot remove the ways to
start another one inside the sidebar: the header's `+` button (`addTab`), the "New chat" item in the `⋮` menu and the
single active-tab chip render in chat mode regardless of `showTabBar={false}`, which only hides the multi-tab strip.

## Workaround in VITLS
`apps/app/app/global.css` hides `[data-agent-sidebar-chat-header] .agent-tabs-scroll` and the header button that
contains `.tabler-icon-plus`. The `⋮` menu item stays reachable (it renders in a portal with no stable hook).

Also: `MultiTabAssistantChat` treats the active thread as stale after 12 h without activity
(`STALE_THREAD_THRESHOLD_MS`) and calls `createThread()` in the same scope, and the active thread per scope is
restored from `localStorage` only (another device or cleared storage starts a new one). So "one scope, one thread"
is not reachable from the app: a scope gets one *history* and a fresh thread after a quiet night.

## Ask
A `singleThread?: boolean` prop on `AgentSidebar` / `AgentPanel` that hides the `+` button, the menu item and the
tab chip, ignores `agent-chat:new-chat`, skips the 12 h stale rotation and resolves the scope's thread server-side
(newest thread for the scope) instead of from `localStorage`.
