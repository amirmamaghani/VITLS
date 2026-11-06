# Upstream issue draft — BuilderIO/agent-native

**Title:** A custom `chatUI` result renders twice during the run: in the tool-results block and as the attached widget

**Version:** `@agent-native/core` / `@agent-native/toolkit` / `@agent-native/agentkit` 0.206.0

## Summary

An action with `chatUI: { renderer: "app.card" }` and `registerActionChatRenderer({ renderer: "app.card", … })`
shows its card twice in `AgentSidebar` (and `CoreAgentKitRoot`) while the thread is live: one card above the reply
text, one below. After a reload only one card remains. Reproduced in VITLS with `show-widget`; the wiring is the
same as the forms template's `show-response-insight` + `register-chat-renderers.tsx`.

## Why

For a `tool_done` with `chatUI`, `dist/client/chat/runtime.js` emits two runtime events: the `tool-done` (whose
metadata keeps `chatUI`) and a `widget` with id `${toolCallId}:chat-ui`. The sidebar then renders both:

1. `AgentActivityList` (`toolkit/src/app/agentkit/react/components.tsx`, `durableToolResults`): a completed tool
   with `metadata.chatUI` is rendered through `slots.tool` → `AgentKitTool` → `ToolCallDisplay` →
   `resolveToolRenderer` → the registered component inside `ActionChatUiSurface` (the
   `data-agentkit-tool-results` block).
2. `AgentMessageView`: the widget attached to the reply is rendered through `slots.widget`, which
   `CoreAgentKitRoot` defaults to `AgentKitActionWidget` → the same registered component.

DOM of one reply in VITLS: `[data-agentkit-tool-results] .agent-tool-call [data-agent-native-custom-ui] h3` and
`article[data-message-id] .agentkit-message-content [data-agent-native-custom-ui] h3`, both "Spánok".

The built-in data widgets go through `isBuiltinDataWidgetActionRenderer` and are not doubled; custom renderers have
no such guard. `components.spec.tsx` only covers `core.data-chart`.

## Ask

Skip the tool-results card for a tool whose `${toolCallId}:chat-ui` widget is attached to a message (or the other
way round), so a custom renderer appears once. Workaround in VITLS: the registered component returns `null` when its
context comes from the tool cell (`"isActiveTail" in context`).
