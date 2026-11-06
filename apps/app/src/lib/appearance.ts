/** Theme preference (Light / Dark), persisted. Applied via NativeWind's setColorScheme, which drives
    both the prefers-color-scheme CSS and our imperative useColors(). No "system" option: on Android
    `Appearance.setColorScheme(null)` throws, so we only ever pass a concrete "light"|"dark". When no
    preference is saved the app simply follows the OS (we never call setColorScheme). */
import * as SecureStore from "expo-secure-store";

export type ThemePref = "light" | "dark";
const KEY = "vitls-appearance";

/** The saved override, or null when none is set (follow the OS). */
export async function loadThemePref(): Promise<ThemePref | null> {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* none */
  }
  return null;
}

export const saveThemePref = (p: ThemePref) => SecureStore.setItemAsync(KEY, p).catch(() => {});
