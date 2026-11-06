---
name: i18n-sync
description: "Use after any @agent-native/* version bump or `agent-native upgrade` in apps/app, when app/i18n/catalogs.test.ts fails (missing keys, placeholder mismatch), when adding a locale or a new t() string, or when asked to check or update translations. Load before touching anything under apps/app/app/i18n/."
---

# i18n Sync

`apps/app/app/i18n/` holds the app shell catalogs (chat, navigation, settings,
pages, root). `en-US.ts` is the source; it descends from the chat template's
catalog shipped inside `@agent-native/core`. Every other locale file mirrors
its keys. `sk-SK` and `cs-CZ` are app-owned: the framework ships no catalog for
them, so their strings are always written by hand.

The guard is mechanical: `app/i18n/catalogs.test.ts` fails when `en-US` lacks a
key of the installed template, or when any locale drifts from `en-US` in keys
or `{{placeholders}}`. Translation quality is the judgment part; this skill is
the recipe for that.

## After a framework upgrade

Run from `apps/app`, in order:

1. `pnpm vitest --run app/i18n/catalogs.test.ts` — the first failure lists the
   exact missing keys. Green means no catalog work; stop here.
2. `pnpm exec agent-native template diff -- app/i18n` — read what upstream
   changed in `en-US.ts` and the 10 built-in locales. Do not `template sync`
   this directory: `index.ts` carries the sk/cs wrapper and would conflict.
3. Add each new key to `en-US.ts` with the template's English text.
4. For the 10 built-in locales, copy the string from the template's own file:
   `node_modules/@agent-native/core/dist/templates/chat/app/i18n/<locale>.ts`.
   Never machine-guess a language the template already translated. If the
   template's own locale file lacks the key, translate it by hand as in step 5.
5. Write `sk-SK` and `cs-CZ` by hand, matching the tone of the neighbouring
   strings (informal "ty", short, no anglicisms when a native word exists).
   Keep every `{{placeholder}}` name unchanged.
6. Keys upstream removed stay until no `t("…")` in app source uses them
   (`rg -n 't\("<key>'`), then delete them from all 13 files at once.
7. `pnpm vitest --run app/i18n/catalogs.test.ts && pnpm typecheck && pnpm agent-native:doctor`.

## Framework chrome for sk/cs (`<locale>.chrome.ts`)

Toolkit chrome (settings pages, composer, observability) and the core messages
the toolkit reads ship translated only for the built-in locales. For `sk-SK`
and `cs-CZ` the app carries them in `app/i18n/<locale>.chrome.ts`
(`{ toolkit, core }`, flat dotted keys; `index.ts` nests them at load). The
same test fails when the installed catalogs gain keys these files lack, or a
placeholder differs. To refresh after an upgrade, from `apps/app`:

1. `node scripts/i18n-chrome.mjs extract <dir>` writes the English source as
   five chunks (`toolkit.a–d`, `core`) into `<dir>`.
2. For each chunk and locale, produce `<dir>/<chunk>.<locale>.json`: start from
   the current `<locale>.chrome.ts` values for keys that already exist, and
   translate only new keys by hand. Plural pairs `_one`/`_other` become
   `_one`/`_few`/`_many`/`_other`. Large chunks go to subagents, one per
   chunk and locale, each with the same brief (tone, glossary, hard rules on
   placeholders, product names, code and URLs).
3. `node scripts/i18n-chrome.mjs validate <dir>/<chunk>.en.json <dir>/<chunk>.<locale>.json`
   must print `OK` or only `untranslated?` hints for URLs, code and product
   names. Fix everything else.
4. `node scripts/i18n-chrome.mjs assemble <dir> <locale>` rewrites the
   `.chrome.ts` file; never edit that file by hand.
5. Run step 7 of the upgrade list above.

Copy left over in English after that is hardcoded in the framework, not a
catalog key; note it in `docs/upstream/` and the backlog instead of patching
`node_modules`.

## Adding an app string

Add the key to `en-US.ts` first, then to all 12 other files in the same
commit; the test fails until parity is restored. Do not add English text to a
non-English file as a stopgap.

## Adding a locale

Copy `de-DE.ts` to `<code>.ts`, translate, then register it in `index.ts`
(`appLocales` metadata and `appLocaleLoaders`). The test picks the file up by
its name automatically.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Translating built-in locales from memory | Copy from the template file in `node_modules` |
| Leaving an English string in sk/cs "for now" | The test cannot see it; translate before done |
| Running `template sync` on `app/i18n` | Use `diff`, merge `index.ts` by hand |
| Renaming a `{{placeholder}}` | Placeholder names are code, keep them verbatim |
