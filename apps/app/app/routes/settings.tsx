import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  CORE_SETTINGS_PAGES,
  registerSettingsPages,
  type SettingsPageProps,
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/toolkit/app/settings";

import { PhoneSyncSetting } from "@/components/settings/PhoneSyncSetting";
import { PushNotificationsSetting } from "@/components/settings/PushNotificationsSetting";
import { APP_TITLE } from "@/lib/app-config";
import { COACH_CHANNELS } from "../../shared/channels";

/**
 * Core Settings pages VITLS does not show. The coach's model, engine and keys are deployment configuration
 * (`agent.engine` / `AGENT_MODEL`, see server/plugins/agent-native-email-branding.ts), and the coach is a product,
 * not a user-configurable assistant. The shell merges the registry over CORE_SETTINGS_PAGES, so a page is hidden by
 * registering it again with `visible: () => false`; its HTTP routes stay mounted (presentation only, by design).
 */
export const HIDDEN_SETTINGS_PAGES = [
  "model",
  "api-keys",
  "integrations",
  "instructions",
  "personalization",
  "skills",
  "files",
  "sub-agents",
  "labs",
  "whats-new",
  "creative-context",
] as const;

const corePage = (id: string) => CORE_SETTINGS_PAGES.find((page) => page.id === id)!;
/** The core page rendered inside a wrapper class, so global.css can hide one element of it. */
const wrapped = (id: string, className: string) => {
  const page = corePage(id);
  const Core = page.component;
  return {
    ...page,
    component: (props: SettingsPageProps) => (
      <div className={`${className} contents`}>
        <Core {...props} />
      </div>
    ),
  };
};

registerSettingsPages([
  ...HIDDEN_SETTINGS_PAGES.map((id) => ({ ...corePage(id), visible: () => false })),
  // Pages that link to the framework vendor's docs, without those links
  // (docs/upstream/agent-native-settings-privacy-link-not-configurable.md).
  ...["security", "org", "auth", "mcp"].map((id) => wrapped(id, "no-vendor-links")),
  // App › General without core's "Default model" group: the model is not the user's choice.
  wrapped("app", "no-model-group"),
  // Channels: sub-pages and search hits only for the platforms the server mounts (shared/channels.ts); the list
  // itself already follows the server.
  channelsPage(),
]);

function channelsPage() {
  const page = corePage("channels");
  const mounted = new Set<string>(COACH_CHANNELS);
  return {
    ...page,
    subpages: page.subpages?.filter((sub) => mounted.has(sub.id)),
    searchEntries: page.searchEntries?.filter((entry) => !entry.sub || mounted.has(entry.sub)),
  };
}

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

// Chat has no app rows here: core Preferences owns the interface language.
export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("settings.title"));

  return (
    <SettingsTabsPage
      extraTabs={agentSettingsTabs}
      notifications={
        <>
          <PushNotificationsSetting />
          <PhoneSyncSetting />
        </>
      }
    />
  );
}
