/** Two floating menus (matches the design): LEFT = a frosted nav pill holding tabs — each tab is an
    icon over a tiny label. The ACTIVE tab is a dark ink pill that slides between tabs.

    The sliding indicator uses the robust, industry-standard pattern (the same one the tab-bar libs use
    internally): FIXED equal-width slots, so the pill is pure math — left = activeIndex × (slot + gap),
    width = slot. No per-tab onLayout measuring (that was unreliable inside the BlurView, breaking tabs
    2–3). Today is fixed; up to 3 coach-curated board tabs follow; an "Ask coach" tab shows while there's
    room. RIGHT = a round peach Chat button. */
import { router, useFocusEffect, usePathname } from "expo-router";
import { House, LayoutGrid, Plus } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { Easing, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { listTabs, type Tab } from "@/api";
import { Glass } from "@/components/Glass";
import { Sparkle } from "@/components/Sparkles";
import { useT } from "@/lib/i18n";
import { navScrollY } from "@/lib/navScroll";
import { useColors } from "@/lib/theme";
import { s } from "@/lib/scale";

const GAP = 14; // distance of the bar above the home indicator
const EASE = Easing.out(Easing.cubic); // snappy decelerate
const DUR = 200;

/** Bottom space a screen must reserve so its content clears the floating menus. */
export function useNavBarSpace(): number {
  return useSafeAreaInsets().bottom + GAP + s(60);
}

const SHADOW = { shadowColor: "#202124", shadowOpacity: 0.12, shadowRadius: 30, shadowOffset: { width: 0, height: 10 }, elevation: 8 } as const;

export function NavBar({ blurTarget }: { blurTarget?: React.RefObject<View | null> }) {
  const c = useColors();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const [tabs, setTabs] = useState<Tab[]>([]);
  useFocusEffect(useCallback(() => void listTabs().then(setTabs).catch(() => {}), []));

  const SLOT = s(66); // fixed per-tab width → the pill is pure math, no measuring
  const STEP = SLOT + s(2); // slot + row gap

  const onToday = path === "/" || path === "/index" || path === "";
  const curated = tabs.slice(0, 3);
  const boardIndex = curated.findIndex((t) => path === `/board/${t.id}`);
  const activeIndex = onToday || boardIndex < 0 ? 0 : boardIndex + 1;

  const x = useSharedValue(activeIndex * STEP);
  const first = useRef(true);
  useEffect(() => {
    const target = activeIndex * STEP;
    if (first.current) {
      x.value = target;
      first.current = false;
    } else {
      x.value = withTiming(target, { duration: DUR, easing: EASE });
    }
  }, [activeIndex, STEP, x]);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  // Hide on scroll-down: follow the scroll delta 1:1, clamped to fully off-screen; snap back on scroll-up / at top.
  const HIDDEN = insets.bottom + GAP + s(72);
  const hide = useSharedValue(0);
  useEffect(() => { hide.value = 0; }, [path, hide]); // show again on every screen change
  useAnimatedReaction(
    () => navScrollY.value,
    (y, prev) => {
      if (prev == null || y <= 0) hide.value = 0;
      else hide.value = Math.min(HIDDEN, Math.max(0, hide.value + (y - prev)));
    },
  );
  const hideStyle = useAnimatedStyle(() => ({ transform: [{ translateY: hide.value }] }));

  return (
    <Animated.View pointerEvents="box-none" style={[{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + GAP }, hideStyle]} className="flex-row items-center justify-between px-3">
      <Glass blurTarget={blurTarget} style={{ borderRadius: s(28), padding: s(6), ...SHADOW }}>
        <View className="flex-row items-stretch" style={{ gap: s(2) }}>
          <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, bottom: 0, left: 0, width: SLOT, borderRadius: s(18), backgroundColor: c.fg }, pillStyle]} />
          <NavTab width={SLOT} active={activeIndex === 0} label={tr("nav.today")} onPress={() => router.replace("/")} c={c} render={(col) => <House color={col} size={s(23)} strokeWidth={2.1} />} />
          {curated.map((t, k) => (
            <NavTab key={t.id} width={SLOT} active={activeIndex === k + 1} label={t.title || tr("nav.board")} onPress={() => router.replace({ pathname: "/board/[id]", params: { id: t.id, title: t.title ?? "" } } as never)} c={c} render={(col) => <LayoutGrid color={col} size={s(22)} strokeWidth={2} />} />
          ))}
          {curated.length < 3 ? <NavTab width={SLOT} active={false} label={tr("nav.askCoach")} onPress={() => router.push({ pathname: "/chat", params: { prefill: tr("chat.addTabPrefill") } })} c={c} render={(col) => <Plus color={col} size={s(22)} strokeWidth={2.2} />} /> : null}
        </View>
      </Glass>

      <Pressable onPress={() => router.push("/chat")} style={{ width: s(56), height: s(56), borderRadius: 999, shadowColor: "#202124", shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 8 }} className="items-center justify-center bg-primary" accessibilityLabel={tr("a11y.openChat")}>
        <Sparkle size={s(27)} color={c.onAccent} />
      </Pressable>
    </Animated.View>
  );
}

/** One fixed-width tab: its icon+label crossfades grey→paper as it becomes active, in sync with the pill. */
function NavTab({ width, active, label, onPress, render, c }: { width: number; active: boolean; label: string; onPress: () => void; render: (color: string) => ReactNode; c: ReturnType<typeof useColors> }) {
  const on = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    on.value = withTiming(active ? 1 : 0, { duration: DUR, easing: EASE });
  }, [active, on]);
  const grey = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  const paper = useAnimatedStyle(() => ({ opacity: on.value }));
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} className="items-center justify-center" style={{ width, paddingVertical: s(7) }}>
      <Animated.View className="items-center" style={[{ gap: s(3) }, grey]}>
        {render(c.muted)}
        <Text numberOfLines={1} style={{ fontSize: s(9.5), fontWeight: "700", color: c.muted, maxWidth: width - s(6) }}>{label}</Text>
      </Animated.View>
      <Animated.View pointerEvents="none" className="absolute items-center justify-center" style={[{ top: 0, bottom: 0, left: 0, right: 0, gap: s(3) }, paper]}>
        {render(c.bg)}
        <Text numberOfLines={1} style={{ fontSize: s(9.5), fontWeight: "800", color: c.bg, maxWidth: width - s(6) }}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}
