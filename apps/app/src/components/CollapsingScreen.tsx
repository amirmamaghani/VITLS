/** Industry-standard page header (iOS large-title / Material collapsing top app bar):
    a large title scrolls away with the content, while a compact top bar stays pinned — its
    background + hairline and its small centred title fade in once you scroll past the large title.
    Left/right actions (back, avatar) live in the pinned bar, so they're always reachable. */
import { ReactElement, ReactNode } from "react";
import { type RefreshControlProps, Text, View } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { navScrollY } from "@/lib/navScroll";
import { useColors } from "@/lib/theme";
import { s } from "@/lib/scale";

const BAR = 44;

export function CollapsingScreen({
  title,
  eyebrow,
  compactTitle,
  left,
  right,
  bottomInset = 0,
  refreshControl,
  children,
}: {
  title: string;
  eyebrow?: string;
  compactTitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  bottomInset?: number;
  refreshControl?: ReactElement<RefreshControlProps>;
  children: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
    navScrollY.value = e.contentOffset.y; // feeds the floating NavBar's hide-on-scroll
  });
  // Precompute every s()-scaled number OUTSIDE the worklets — a JS function can't be called on the UI runtime.
  const THRESH = s(38); // roughly the large-title height: past this, the compact bar takes over
  const T0 = THRESH * 0.55;
  const TY = s(9);
  const barH = insets.top + s(BAR);

  const barBg = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [0, THRESH], [0, 1], Extrapolation.CLAMP) }));
  const compact = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [T0, THRESH], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [T0, THRESH], [TY, 0], Extrapolation.CLAMP) }],
  }));

  return (
    <View className="flex-1 bg-background">
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        contentContainerStyle={{ paddingTop: barH + s(4), paddingHorizontal: s(20), paddingBottom: bottomInset + s(16), gap: s(14) }}
      >
        <View>
          {eyebrow ? <Text className="text-muted-foreground" style={{ fontSize: s(11), fontWeight: "700", letterSpacing: 1.1 }}>{eyebrow}</Text> : null}
          <Text className="text-foreground" style={{ fontSize: s(26), fontWeight: "800", letterSpacing: -0.6, marginTop: eyebrow ? s(3) : 0 }} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {children}
      </Animated.ScrollView>

      {/* pinned compact bar */}
      <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: barH }}>
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.bg, borderBottomWidth: 1, borderBottomColor: c.line }, barBg]} />
        <Animated.Text numberOfLines={1} style={[{ position: "absolute", left: s(56), right: s(56), bottom: s(11), textAlign: "center", fontSize: s(16), fontWeight: "700", color: c.fg }, compact]}>
          {compactTitle ?? title}
        </Animated.Text>
        <View style={{ position: "absolute", left: s(16), right: s(16), bottom: 0, height: s(BAR) }} className="flex-row items-center justify-between">
          <View style={{ minWidth: s(40) }}>{left}</View>
          <View style={{ minWidth: s(40), alignItems: "flex-end" }}>{right}</View>
        </View>
      </View>
    </View>
  );
}
