# Upstream issue draft — BuilderIO/agent-native

**Filed:** not yet

**Title:** `GuidedQuestionFlow` and `useGuidedQuestionFlow` default copy is hardcoded English and ignores the interface language

**Version:** `@agent-native/core` / `@agent-native/toolkit` / `@agent-native/agentkit` 0.203.0

## Summary

The guided-question card renders "Before I generate", "Use Other for custom details, or let the agent decide.",
"Skip" and "Continue" from default props in `toolkit/dist/app/chat/agentkit-chat/guided-questions.js`
(`GuidedQuestionFlow`), and `useGuidedQuestionFlow` sends "Skip the questions — let the agent decide." /
"Here are my answers — go ahead." as the user's chat message. None of these go through `t()`, and the core
`ask-user-question` tool never writes `title` / `description` / `skipLabel` / `submitLabel` into the
`guided-questions` payload, so every locale sees the English defaults.

An app can override them only where it renders `GuidedQuestionFlow` itself (the chat template's
`ChatRouteContent`). `AgentSidebar` → `AgentKitAssistantChat` renders the flow internally with no prop for these
labels, so the sidebar stays English in every language.

## Expected

Defaults resolved from the toolkit catalog (e.g. `agentChat.guidedQuestions.title`, `.description`, `.skip`,
`.continue`, `.skipMessage`, `.submitMessage`) so built-in locales and app-registered locales get them for free.

## Workaround in this app

`apps/app/app/components/chat/ChatRouteContent.tsx` passes the labels and `skipMessage` from the app catalog
(`chat.guided*` keys). The sidebar cannot be patched without ejecting `AgentKitAssistantChat`.
