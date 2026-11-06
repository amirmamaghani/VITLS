import {
  type LocaleCode,
  type LocaleMessages,
  type LocaleMetadata,
  SUPPORTED_LOCALES,
} from "@agent-native/core/client/i18n";
import { createToolkitI18nCatalog } from "@agent-native/toolkit/app/i18n";

import enUS from "./en-US";

// Locales the framework does not ship; createToolkitI18nCatalog only wires
// loaders for the built-in set, so these are loaded by the wrapper below.
export const appLocales: readonly LocaleMetadata[] = [
  { code: "sk-SK", nativeName: "Slovenčina", englishName: "Slovak", dir: "ltr" },
  { code: "cs-CZ", nativeName: "Čeština", englishName: "Czech", dir: "ltr" },
];

export const supportedLocales: readonly LocaleCode[] = [
  ...SUPPORTED_LOCALES,
  ...appLocales.map(({ code }) => code),
];

type Loader = () => Promise<{ default: LocaleMessages }>;
type ChromeLoader = () => Promise<{ default: { toolkit: Record<string, string>; core: Record<string, string> } }>;

const appLocaleLoaders: Partial<Record<LocaleCode, [Loader, ChromeLoader]>> = {
  "sk-SK": [() => import("./sk-SK"), () => import("./sk-SK.chrome")],
  "cs-CZ": [() => import("./cs-CZ"), () => import("./cs-CZ.chrome")],
};

// Toolkit keys the framework also serves at the top level (toolkit catalog.js).
const HOISTED_OBSERVABILITY_KEYS = [
  "summarizeWithAgent",
  "regenerateSummary",
  "summarizeWithAgentHelp",
  "regenerateSummaryHelp",
  "summarySending",
  "summaryQueued",
  "summaryFailed",
  "summaryExpired",
];

function flatten(messages: LocaleMessages, into: Record<string, string>, prefix = "") {
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value === "string") into[prefix + key] = value;
    else flatten(value as LocaleMessages, into, `${prefix}${key}.`);
  }
  return into;
}

function nest(flat: Record<string, string>): LocaleMessages {
  const out: LocaleMessages = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split(".");
    let cursor = out;
    for (const part of parts.slice(0, -1)) {
      cursor = (cursor[part] ??= {}) as LocaleMessages;
    }
    cursor[parts[parts.length - 1]!] = value;
  }
  return out;
}

// Mirrors what createToolkitI18nCatalog does for built-in locales: toolkit
// chrome under agentChat, core overrides at the top level, app shell last.
async function loadAppLocale([shell, chrome]: [Loader, ChromeLoader]): Promise<LocaleMessages> {
  const [{ default: messages }, { default: { toolkit, core } }] = await Promise.all([shell(), chrome()]);
  const flat: Record<string, string> = { ...core };
  for (const [key, value] of Object.entries(toolkit)) flat[`agentChat.${key}`] = value;
  for (const key of HOISTED_OBSERVABILITY_KEYS) {
    const value = toolkit[`observability.${key}`];
    if (value) flat[`observability.${key}`] = value;
  }
  return nest(flatten(messages, flat));
}

const toolkitCatalog = createToolkitI18nCatalog({
  messages: enUS,
  locales: appLocales,
  localeLoaders: {
    "zh-CN": () => import("./zh-CN"),
    "zh-TW": () => import("./zh-TW"),
    "es-ES": () => import("./es-ES"),
    "fr-FR": () => import("./fr-FR"),
    "de-DE": () => import("./de-DE"),
    "ja-JP": () => import("./ja-JP"),
    "ko-KR": () => import("./ko-KR"),
    "pt-BR": () => import("./pt-BR"),
    "hi-IN": () => import("./hi-IN"),
    "ar-SA": () => import("./ar-SA"),
  },
});

export const i18nCatalog = {
  ...toolkitCatalog,
  loadMessages: async (locale: LocaleCode) => {
    const loaders = appLocaleLoaders[locale];
    return loaders ? loadAppLocale(loaders) : toolkitCatalog.loadMessages(locale);
  },
};
