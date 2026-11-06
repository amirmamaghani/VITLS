/** Reusable frosted-glass surface with REAL backdrop blur.
    expo-blur 57 Android blur only works when `blurTarget` points at a <BlurTargetView> wrapping the
    content to blur — without it the blur silently falls back to "none" (plain translucency). So each
    caller wraps its scrollable/background content in <BlurTargetView ref={r}> and passes r here.
    iOS blurs natively and ignores blurTarget. */
import { BlurView } from "expo-blur";
import { ReactNode, RefObject } from "react";
import { LayoutChangeEvent, StyleProp, View, ViewStyle } from "react-native";

import { useColors } from "@/lib/theme";

export { BlurTargetView } from "expo-blur";

export function Glass({
  children,
  style,
  intensity,
  tint = true,
  blurTarget,
  onLayout,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  tint?: boolean; // faint color wash over the blur (off for a pure clear-glass look)
  blurTarget?: RefObject<View | null>;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const c = useColors();
  return (
    <BlurView
      onLayout={onLayout}
      intensity={intensity ?? (c.dark ? 64 : 84)}
      tint={c.dark ? "dark" : "light"}
      blurMethod="dimezisBlurView"
      blurTarget={blurTarget}
      style={[
        { overflow: "hidden", borderWidth: 1, borderColor: c.dark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.6)" },
        tint ? { backgroundColor: c.dark ? "rgba(24,24,27,0.20)" : "rgba(255,255,255,0.20)" } : null,
        style,
      ]}
    >
      {children}
    </BlurView>
  );
}
