/** Imperative colors for icons/SVG that className can't drive. Mirrors global.css tokens.
    Role split: `accent` (peach) is a FILL only; icon/text strokes use `fg`/`onAccent` (ink), never peach.
    Uses NativeWind's color scheme so the in-app theme switcher (setColorScheme) drives these too. */
import { useColorScheme } from "nativewind";

export interface Colors {
  dark: boolean;
  fg: string; // ink foreground (text, icons on light surfaces)
  bg: string; // paper
  card: string; // bento surface
  muted: string; // secondary text / inactive icons
  line: string; // hairlines
  accent: string; // peach — fills (buttons, FAB, badges, active pill)
  onAccent: string; // ink sitting on peach
  tint: string; // soft peach — active tab/row background
  danger: string;
}

export function useColors(): Colors {
  const dark = useColorScheme().colorScheme === "dark";
  return {
    dark,
    fg: dark ? "#f2f2f2" : "#141414",
    bg: dark ? "#0f0f10" : "#ffffff",
    card: dark ? "#1c1c1f" : "#f4f4f6",
    muted: dark ? "#9a9aa0" : "#6b6b70",
    line: dark ? "#2a2a2e" : "#e8e8ea",
    accent: "#ffe2d1",
    onAccent: "#202124",
    tint: dark ? "rgba(255,226,209,0.14)" : "#fff2ea",
    danger: dark ? "#f97066" : "#b42318",
  };
}
