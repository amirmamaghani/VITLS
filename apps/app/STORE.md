# Store submission checklist (spec §8)

## Reviewer notes (paste into App Store Connect / Play Console)
VITLS Companion is the phone companion of the VITLS web coach. Native features: Apple Health / Health Connect sync
(foreground and background), native push notifications, a Today screen with the coach's readout and quick logging.
The Coach tab shows the user's web account. Every feature in the app is free; subscriptions are managed on the
website only and are neither sold nor referenced in the app.
Test account: see checklist (paired device with 14 days of data).

## Both platforms
- [ ] Fill in the test account (e-mail + magic-link inbox) before submission
- [ ] Deep links: magic link and `vitls://open` land in the Coach tab, `vitls://pair` in the native pair screen — verify on both platforms
- [ ] `extra.eas.projectId` set in `app.json` (run `eas init` before store builds; push registration stays inactive until it is set)
- [ ] `PWA_DOMAIN` in `app.json` (`associatedDomains`, `intentFilters`) replaced with the production domain

## iOS
- [ ] `NSHealthShareUsageDescription` names each data type's purpose (app.json)
- [ ] Privacy policy URL in App Store Connect and in Settings → Privacy policy
- [ ] Associated domains `applinks:<domain>`; AASA reachable (`swcutil dl -d <domain>` or https://app-site-association.cdn-apple.com/a/v1/<domain>)
- [ ] AASA is served by the route `apps/app/server/routes/.well-known/apple-app-site-association.get.ts` from `apps/app/server/lib/apple-app-site-association.json`; edit the JSON, not the route
- [ ] Background modes: processing (expo-background-task)
- [ ] Health data is never used for advertising (declare in App Privacy)

## Android
- [ ] Play Console → Health Connect declaration: data types read, purposes, privacy policy
- [ ] Separate justification for READ_HEALTH_DATA_IN_BACKGROUND (background sync of the user's own data)
- [ ] `adb shell pm verify-app-links --re-verify ai.vitls.companion` reports verified for the PWA domain
- [ ] `assetlinks.json` (`apps/app/public/.well-known/`) carries the release signing certificate fingerprint
