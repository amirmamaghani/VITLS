import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { cachedDashboard, cachedMetrics, getDashboard, getLatestMetrics, loadCachedDashboard, loadCachedMetrics, type DashboardRecord } from "@/api";
import { CollapsingScreen } from "@/components/CollapsingScreen";
import { HealthWidget, metricLabel, type WidgetConfig } from "@/components/widgets";
import { useT } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { s } from "@/lib/scale";
import { useNavBarSpace } from "@/nav";

const fmt = (v: number): string => (Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString();

export default function Board() {
  const c = useColors();
  const t = useT();
  const space = useNavBarSpace();
  const { id, title: titleParam } = useLocalSearchParams<{ id: string; title?: string }>();
  const [board, setBoard] = useState<DashboardRecord | undefined>(() => (id ? cachedDashboard(id) : undefined)); // instant from cache
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      void loadCachedDashboard(id).then((d) => d && setBoard(d)); // disk cache on cold start
      void getDashboard(id).then(setBoard).catch(() => {}); // then refresh
    }, [id]),
  );

  // Prefer the title passed from the nav so it shows instantly (no "Board" placeholder flash before the fetch).
  const title = board?.title || titleParam || t("nav.board");
  const items = board?.config?.widgets ?? [];

  // Live values for the board's metric widgets — shown instantly from cache, then refreshed.
  const metrics = useMemo(() => Array.from(new Set(items.filter((w) => w.kind === "metric" && w.metric).map((w) => w.metric as string))), [items]);
  const [values, setValues] = useState<Record<string, number>>(cachedMetrics);
  const metricsKey = metrics.join(",");
  useEffect(() => {
    if (!metricsKey) return;
    void loadCachedMetrics().then(setValues);
    void getLatestMetrics(metricsKey.split(",")).then(setValues).catch(() => {});
  }, [metricsKey]);
  const dataFor = (w: WidgetConfig) => {
    if (w.kind !== "metric" || !w.metric || values[w.metric] === undefined) return undefined;
    const meta = metricLabel(t, w.metric);
    return { value: fmt(values[w.metric]), unit: meta.unit, label: meta.label };
  };
  return (
    <CollapsingScreen
      title={title}
      compactTitle={title}
      bottomInset={space}
      right={
        <Pressable onPress={() => router.push("/settings")} style={{ width: s(34), height: s(34), borderRadius: 999, backgroundColor: c.fg }} className="items-center justify-center" accessibilityLabel={t("a11y.account")}>
          <Text style={{ fontSize: s(13), fontWeight: "700", color: c.bg }}>AM</Text>
        </Pressable>
      }
    >
      <Text className="-mt-2 text-muted-foreground" style={{ fontSize: s(12) }}>{t("board.subtitle")}</Text>

      {items.length === 0 ? (
        <View className="items-center gap-3 rounded-[28px] border border-dashed border-border p-8">
          <Text className="text-center text-muted-foreground" style={{ fontSize: s(13) }}>{t("board.empty")}</Text>
        </View>
      ) : (
        items.map((w, i) =>
          w.kind === "section" ? (
            <Text key={i} className="pt-2 text-muted-foreground" style={{ fontSize: s(11), fontWeight: "700", letterSpacing: 1 }}>{String((w as WidgetConfig).title ?? "").toUpperCase()}</Text>
          ) : (
            <HealthWidget key={(w as WidgetConfig).id ?? i} widget={w as WidgetConfig} placement="board" data={dataFor(w as WidgetConfig)} />
          ),
        )
      )}

      <Pressable onPress={() => router.push({ pathname: "/chat", params: { prefill: t("board.changePrefill", { title }) } })} className="mt-1 items-center rounded-full border border-border" style={{ paddingVertical: s(12) }}>
        <Text className="font-semibold text-foreground" style={{ fontSize: s(14) }}>{t("board.change")}</Text>
      </Pressable>
    </CollapsingScreen>
  );
}
