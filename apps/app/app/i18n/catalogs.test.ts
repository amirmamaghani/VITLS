import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The app catalog started from the chat template's catalog. When @agent-native
// is upgraded, the template may add keys the framework UI now reads; this
// test fails until en-US carries them and every locale translates them.
// See .claude/skills/i18n-sync.
import enUS from "./en-US";

const PKG = path.resolve(import.meta.dirname, "../../node_modules/@agent-native");
const TEMPLATE_EN_US = `${PKG}/core/dist/templates/chat/app/i18n/en-US.ts`;
const TOOLKIT_EN_US = `${PKG}/toolkit/dist/app/i18n/catalogs/en-US.js`;
const CORE_EN_US = `${PKG}/core/dist/localization/default-messages.js`;
const CORE_LOADER = `${PKG}/core/dist/localization/core-messages.js`;
const load = async (file: string): Promise<Messages> =>
  (await import(/* @vite-ignore */ file)).default;

// Slovak and Czech need one/few/many/other where English has one/other.
const expandPlurals = (keys: string[]) =>
  keys.flatMap((key) =>
    key.endsWith("_one")
      ? ["_one", "_few", "_many", "_other"].map((s) => key.slice(0, -4) + s)
      : key.endsWith("_other")
        ? []
        : [key],
  );

type Messages = Record<string, unknown>;

const flatten = (messages: Messages, prefix = ""): Record<string, string> =>
  Object.fromEntries(
    Object.entries(messages).flatMap(([key, value]) =>
      typeof value === "string"
        ? [[prefix + key, value]]
        : Object.entries(flatten(value as Messages, `${prefix}${key}.`)),
    ),
  );

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{?\s*(\w+)\s*\}?\}/g)].map((m) => m[1]).sort();

const source = flatten(enUS);
const files = readdirSync(import.meta.dirname);
const locales = files
  .filter((name) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(name) && name !== "en-US.ts")
  .map((name) => name.replace(/\.ts$/, ""));
const chromeLocales = files
  .filter((name) => /^[a-z]{2}-[A-Z]{2}\.chrome\.ts$/.test(name))
  .map((name) => name.replace(/\.chrome\.ts$/, ""));

describe("i18n catalogs", () => {
  it("en-US carries every key of the installed chat template", async () => {
    const missing = Object.keys(flatten(await load(TEMPLATE_EN_US))).filter((key) => !(key in source));
    expect(missing).toEqual([]);
  });

  it.each(locales)("%s mirrors en-US keys and placeholders", async (locale) => {
    const messages = flatten(await load(path.join(import.meta.dirname, `${locale}.ts`)));
    expect(Object.keys(messages).sort()).toEqual(Object.keys(source).sort());
    for (const [key, text] of Object.entries(source)) {
      expect(placeholders(messages[key]!), key).toEqual(placeholders(text));
    }
  });

  // App-owned locales also carry the framework chrome (toolkit + core
  // messages) the framework ships only for its built-in locales.
  it.each(chromeLocales)("%s.chrome mirrors the installed toolkit and core catalogs", async (locale) => {
    const toolkitEn = (await load(TOOLKIT_EN_US)) as Record<string, string>;
    const coreEn = {
      ...flatten(await load(CORE_EN_US)),
      ...flatten(await (await import(/* @vite-ignore */ CORE_LOADER)).loadCoreMessagesForLocale("en-US")),
    };
    const { toolkit, core } = (await load(path.join(import.meta.dirname, `${locale}.chrome.ts`))) as {
      toolkit: Record<string, string>;
      core: Record<string, string>;
    };
    expect(Object.keys(toolkit).sort()).toEqual(expandPlurals(Object.keys(toolkitEn)).sort());
    const unknownCoreKeys = Object.keys(core).filter((key) => !(key.replace(/_(few|many)$/, "_other") in coreEn));
    expect(unknownCoreKeys).toEqual([]);
    for (const [key, text] of Object.entries({ ...core, ...toolkit })) {
      const source = key in toolkit ? toolkitEn : coreEn;
      const sourceKey = key in source ? key : key.replace(/_(few|many)$/, "_other");
      expect(placeholders(text), key).toEqual(placeholders(source[sourceKey]!));
    }
  });
});
