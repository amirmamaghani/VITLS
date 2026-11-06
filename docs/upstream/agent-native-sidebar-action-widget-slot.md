# Upstream issue draft — BuilderIO/agent-native

**Filed:** https://github.com/BuilderIO/agent-native/issues/6981 (2026-10-07)

**Title:** `AgentSidebar` chat has no `widget` slot, so action `chatUI` renderers show an empty "Widget" card

**Version:** `@agent-native/toolkit` 0.198.8

## Summary

Actions that declare `chatUI: { renderer }` render correctly in a `CoreAgentKitRoot` chat (the chat template's
`/chat/:id` route), but in the `AgentSidebar` panel the same thread shows only an empty card titled with
`chatUI.title`. The sidebar's AgentKit root never receives `AgentKitActionWidget`, so widget message parts fall through
to the generic `AgentWidgetView`.

## Details

- `dist/app/chat/agentkit-chat/root.js`: `CoreAgentKitRoot` sets `widget: props.slots?.widget ?? AgentKitActionWidget`.
- `dist/app/chat/AgentKitAssistantChat.js` (used by `AgentSidebar` → `AgentSidebarPanel` → `MultiTabAssistantChat`):
  the module-level `agentKitSlots` object has no `widget` entry and `AgentSidebar` exposes no slot/registry prop.
- `dist/app/agentkit/react/components.js` `AgentMessagePartView`: `registry.widgets?.[kind] ?? slots.widget ??
  AgentWidgetView` → `AgentWidgetView` renders only `widget.title` because `widget.data` is
  `{ toolCallId, toolName }`.
- Docs (`templates/chat/DEVELOPING.md`) say `CoreAgentKitRoot` provides the action-widget renderer, but do not mention
  that `AgentSidebar` does not.

## Reproduction

1. An action with `chatUI: { renderer: "app.widget", title: "Widget" }` and
   `registerActionChatRenderer({ id: "app.widget", renderer: "app.widget", Component })`.
2. Call it from chat; open the thread at `/chat/:id` → the component renders.
3. Open the same thread in `AgentSidebar` on another route → an empty card "Widget".

## Suggested fix

Add `widget: AgentKitActionWidget` to `agentKitSlots` in `AgentKitAssistantChat.js` (one import, one line), matching
`CoreAgentKitRoot`.

## Related (dev only)

With AgentKit, the Vite plugin sets `optimizeDeps.noDiscovery: true` and the default include list omits
`@agent-native/toolkit/app/chat`. That entry is then served unbundled and carries a second copy of
`tool-render-registry.js`, so renderers registered through `@agent-native/toolkit/app/chat/agentkit-chat` are invisible
to it. Adding `@agent-native/toolkit/app/chat` to the AgentKit optimize-deps include list would avoid it.

## Local state (VITLS)

No patch: `agent-native upgrade` forbids `patchedDependencies` for `@agent-native/*`, and `AgentSidebar` exposes no
slot or registry prop. Workaround (still needed on 0.203.0): `show-widget` and `log-meal` declare `chatUI` without a
`title`. `AgentWidgetView` then renders nothing in the sidebar, while the inline tool call there still shows the real
card. Older threads keep their stored title, so their sidebar view still shows the empty card. `apps/app/vite.config.ts` adds
`optimizeDeps.include: ["@agent-native/toolkit/app/chat"]`; remove it once the include list is fixed upstream.
