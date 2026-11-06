import { CORE_SETTINGS_PAGES, getSettingsPages, isSettingsPageVisible } from "@agent-native/toolkit/app/settings";
import { describe, expect, it } from "vitest";

import { COACH_CHANNELS } from "../../shared/channels";
import { HIDDEN_SETTINGS_PAGES } from "./settings";

/** What the shell shows: the registry merged over the core pages, then each page's `visible` rule. */
function visiblePageIds() {
  const byId = new Map(CORE_SETTINGS_PAGES.map((page) => [page.id, page]));
  for (const page of getSettingsPages()) byId.set(page.id, page);
  const context = { role: "owner", isOwner: true, isAdmin: true, hasOrganization: true, soloDeploymentAdmin: false, appId: "app", labs: {}, flags: {} };
  const bridge = { tab: () => undefined, whatsNew: null, whatsNewMarkdown: null };
  return [...byId.values()].filter((page) => isSettingsPageVisible(page, context as never, bridge as never)).map((page) => page.id);
}

describe("settings pages", () => {
  it("hides only pages the toolkit actually ships, so an upgrade that renames one is caught", () => {
    const core = new Set(CORE_SETTINGS_PAGES.map((page) => page.id));
    for (const id of HIDDEN_SETTINGS_PAGES) expect(core, id).toContain(id);
  });

  it("lists a Channels sub-page and search hit only for mounted platforms", () => {
    const channels = getSettingsPages().find((page) => page.id === "channels")!;
    expect(channels.subpages?.map((sub) => sub.id)).toEqual([...COACH_CHANNELS]);
    expect(channels.searchEntries?.map((entry) => entry.sub).filter(Boolean)).toEqual([...COACH_CHANNELS]);
  });

  it("keeps the pages a VITLS user needs and drops the rest", () => {
    const ids = visiblePageIds();
    expect(ids).toEqual(expect.arrayContaining(["profile", "preferences", "security", "memory", "app", "mcp", "channels", "automations", "org", "members"]));
    for (const id of HIDDEN_SETTINGS_PAGES) expect(ids).not.toContain(id);
  });
});
