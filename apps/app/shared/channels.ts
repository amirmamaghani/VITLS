/**
 * Messaging platforms the coach answers on (Settings › Channels). Personal channels only: a health coach is not a
 * workplace bot, so Slack, Teams, Discord and Google Docs stay unmounted. The server mounts exactly these adapters
 * (`integrations.platforms` in server/plugins/agent-native-email-branding.ts) and Settings lists exactly these pages.
 */
export const COACH_CHANNELS = ["telegram", "whatsapp", "email"] as const;
