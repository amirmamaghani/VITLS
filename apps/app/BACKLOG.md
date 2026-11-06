# apps/app — backlog

State as of 2026-10-08: agent-native 0.203.0, widget catalog v2 merged, nutrition core (plan 1) merged.

## To do

### Chat

- [ ] **Guided-question card in the sidebar speaks English in every language.** Blocked upstream: the toolkit's
      `GuidedQuestionFlow` defaults and the hook's skip/submit messages are hardcoded, and `AgentSidebar` exposes
      no prop for them; see `docs/upstream/agent-native-guided-question-defaults-not-localized.md`.
- [ ] **Same widget layout in the sidebar and the full-page chat, no duplicated replies.** Blocked upstream:
      [#6981](https://github.com/BuilderIO/agent-native/issues/6981) (the `AgentSidebar` chat has no `widget`
      slot) and [#6998](https://github.com/BuilderIO/agent-native/issues/6998) (each assistant reply shows twice
      because the persisted snapshot can't be matched to the durable `server-run-*` message). Today the sidebar
      shows action cards above "Worked for", the full-page chat at the end of the message. Switching the
      full-page chat to `AgentChatSurface` (the sidebar's component) was tried on 2026-10-08 and reverted: it
      showed the same duplicates and no widgets for older threads. The full-page chat was removed on 2026-10-10
      (one chat per dashboard in the sidebar), so only the sidebar's widget slot and the duplicate reply remain.
      When a release fixes either issue:
      - upgrade with `pnpm exec agent-native upgrade` (never patch `@agent-native/*`);
      - remove the workarounds: `optimizeDeps.include: ["@agent-native/toolkit/app/chat"]` in `vite.config.ts`,
        the title-less `chatUI` on `show-widget` / `log-meal`;
      - check the sidebar on a new thread with `show-widget`, then update
        `docs/upstream/agent-native-sidebar-action-widget-slot.md` and
        `agent-native-duplicate-assistant-message.md`.

### Widgets

- [ ] **Verify the VO2max percentile table** (`@vitls/physiology` `vo2maxPercentile`) against ACSM's Guidelines,
      10th ed. It was written from memory; the UI labels it "approximate".

### Nutrition

- [ ] Plans 2–5 from `docs/design/06-nutrition.md`: meal photos, /food page + targets + Slovak names, GLP-1 +
      doctor export, Health import/export.
- [ ] Run `pnpm foods:import` on the dev database and check meal logging in the browser.
