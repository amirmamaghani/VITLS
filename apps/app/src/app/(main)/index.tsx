import { router, useFocusEffect } from "expo-router";
import { Footprints, HeartPulse, Moon } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { AppState, Pressable, RefreshControl, Text, View } from "react-native";

import { cachedToday, getToday, loadCachedToday } from "@/api";
import { CollapsingScreen } from "@/components/CollapsingScreen";
import { Card, CardHeader, Figure, Stat } from "@/components/ui";
import { HealthWidget } from "@/components/widgets";
import { type Lang, type TFunc, useLang, useT } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { s } from "@/lib/scale";
import { useNavBarSpace } from "@/nav";
import { clearSession, loadSession, SERVER } from "@/server-client";
import { isDisconnected, loadState, selfPair, syncOrDisconnect } from "@/sync";
import { formatMinutes, isStale, type TodayView } from "@/today";

// DEV: skip auto device-pairing + health sync while iterating on widget visuals (Health Connect has no
// data on the emulator and its permission screen interrupts). Set back to false before shipping.
const SKIP_HEALTH_SYNC = true;

export default function Today() {
  const c = useColors();
  const t = useT();
  const lang = useLang();
  const space = useNavBarSpace();
  const [signedIn, setSignedIn] = useState<boolean>();
  const [view, setView] = useState<TodayView | undefined>(cachedToday); // instant first paint from the cache
  const [refreshing, setRefreshing] = useState(false);
  const syncing = useRef(false);

  /** Fetch Today from the server (updates the cache). Used on first load and on pull-to-refresh. */
  const fetchToday = useCallback(async () => {
    try {
      setView(await getToday());
    } catch (e) {
      if ((e as Error).message === "unauthorized") {
        await clearSession();
        setSignedIn(false);
      } // other read errors are non-fatal: the cached view stays
    }
  }, []);

  /** On focus/resume: auth, auto-pair + background sync. Today itself is shown from cache — only fetched
      the first time (no cache yet), never re-fetched on every visit; a pull-to-refresh forces it. */
  const load = useCallback(async () => {
    const token = await loadSession();
    setSignedIn(!!token);
    if (!token) return;
    if (!SKIP_HEALTH_SYNC) {
      let device = await loadState();
      if (!device && !(await isDisconnected())) device = (await selfPair(SERVER).catch(() => undefined)) ?? undefined;
      if (device && isStale(device.lastSyncAt) && !syncing.current) {
        syncing.current = true;
        void syncOrDisconnect(device).finally(() => (syncing.current = false));
      }
    }
    if (!cachedToday()) {
      const disk = await loadCachedToday();
      if (disk) setView(disk);
      else await fetchToday();
    }
  }, [fetchToday]);
  useFocusEffect(
    useCallback(() => {
      void load();
      const sub = AppState.addEventListener("change", (st) => st === "active" && void load());
      return () => sub.remove();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchToday();
    setRefreshing(false);
  }, [fetchToday]);

  if (signedIn === undefined) return <View className="flex-1 bg-background" />;
  if (!signedIn)
    return (
      <View className="flex-1 justify-center gap-5 bg-background p-6">
        <Text className="text-base text-foreground">{t("today.signedOutIntro")}</Text>
        <Pressable onPress={() => router.push("/login")} className="items-center rounded-full bg-primary py-3">
          <Text className="text-base font-semibold text-primary-foreground">{t("today.signIn")}</Text>
        </Pressable>
      </View>
    );

  const m = view?.metrics;
  return (
    <CollapsingScreen
      eyebrow={eyebrow(view?.date, lang)}
      title={view?.readout?.greeting || greeting(t)}
      compactTitle={t("today.compact")}
      bottomInset={space}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.muted} colors={[c.fg]} progressViewOffset={60} />}
      right={
        <Pressable onPress={() => router.push("/settings")} style={{ width: s(34), height: s(34), borderRadius: 999, backgroundColor: c.fg }} className="items-center justify-center" accessibilityLabel={t("a11y.account")}>
          <Text style={{ fontSize: s(13), fontWeight: "700", color: c.bg }}>AM</Text>
        </Pressable>
      }
    >
      <HealthWidget widget={{ kind: "week" }} placement="today" />
      <HealthWidget widget={{ kind: "readout" }} placement="today" data={{ readout: view?.readout ?? null }} />

      <View className="flex-row gap-4">
        <Stat label={t("stat.steps")} icon={<Footprints color={c.fg} size={18} />} value={m?.steps?.toLocaleString() ?? "–"} />
        <Stat label={t("stat.restingHr")} icon={<HeartPulse color={c.fg} size={18} />} value={m?.resting_hr !== undefined ? String(m.resting_hr) : "–"} unit={m?.resting_hr !== undefined ? "bpm" : undefined} />
      </View>
      <Card className="gap-2">
        <CardHeader icon={<Moon color={c.fg} size={18} />} title={t("card.sleep")} />
        <Figure value={m?.sleep_min !== undefined ? formatMinutes(m.sleep_min) : "–"} size="md" />
      </Card>

      <HealthWidget widget={{ kind: "macros" }} placement="today" data={{ macros: view?.macros }} />
      <HealthWidget widget={{ kind: "workout-today" }} placement="today" />

      <Text className="px-1 text-muted-foreground" style={{ fontSize: s(11.5) }}>{t("today.disclaimer")}</Text>
    </CollapsingScreen>
  );
}

function eyebrow(date: string | undefined, lang: Lang): string {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleDateString(lang === "sk" ? "sk-SK" : "en-US", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
}

/** Stable, local time-based greeting for the title, so it never flashes a placeholder while data loads. */
function greeting(t: TFunc): string {
  const h = new Date().getHours();
  return t(h < 12 ? "greeting.morning" : h < 18 ? "greeting.afternoon" : "greeting.evening");
}
