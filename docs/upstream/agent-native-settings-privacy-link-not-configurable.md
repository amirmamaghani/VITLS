# Upstream issue draft: Settings › Security links to agent-native.com with no way to change it

**Package:** `@agent-native/toolkit` 0.206.0, `dist/app/settings/account/SecuritySettings.js` (`YourDataGroup`) and
`dist/app/settings/AccountSettingsCard.js`

## Symptom
Both render `<a href={docsUrl("privacy-and-data-rights")}>` ("Read about privacy and data rights"), a hard-coded link
to `https://www.agent-native.com/docs/privacy-and-data-rights`. A white-label app has no prop, config key or i18n
hook to point it at its own privacy policy or drop it; `docsUrl` has a fixed origin.

## Workaround in VITLS
`app/routes/settings.tsx` re-registers the core `security` page (same definition, component wrapped in
`.no-vendor-links`) and `app/global.css` hides `a[href*="agent-native.com"]` inside it.

## Ask
`privacyPolicyUrl?: string | null` in the app config (or on `SettingsTabsPage`): a URL replaces the docs link, `null`
removes the row's link.
