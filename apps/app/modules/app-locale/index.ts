import { Platform } from "react-native";

import AppLocale from "./src/AppLocaleModule";

/** Set the per-app language (BCP-47 tag, "" = follow system). Android-only; no-op elsewhere.
    On iOS there is no sanctioned API to change the app's own language — the user does it in Settings. */
export const setAppLocale = (tag: string): void => {
  if (Platform.OS === "android") AppLocale.setLocale(tag);
};

/** The currently applied per-app language tag ("" when following the system). */
export const getAppLocale = (): string => (Platform.OS === "android" ? AppLocale.getLocale() : "");
