import { router } from "expo-router";
import { useColorScheme } from "nativewind";
import { Bell, ChevronLeft, ChevronRight, Database, Languages, LogOut, type LucideIcon, Moon, Share2, Shield, Smartphone, Target, UserRound } from "lucide-react-native";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CollapsingScreen } from "@/components/CollapsingScreen";
import { saveThemePref } from "@/lib/appearance";
import { langLabel, useLang, useT } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { s } from "@/lib/scale";
import { clearCachedToday } from "@/api";
import { clearSession, SERVER } from "@/server-client";
import { loadState, selfPair, syncOrDisconnect } from "@/sync";

const signOut = async () => {
  clearCachedToday();
  await clearSession();
  router.replace("/login");
};
const askCoach = (prefill: string) => router.push({ pathname: "/chat", params: { prefill } });

export default function Settings() {
  const c = useColors();
  const t = useT();
  const lang = useLang();
  const insets = useSafeAreaInsets();
  const [sync, setSync] = useState<{ connected: boolean; busy: boolean; note?: string }>({ connected: false, busy: false });

  const refreshSync = useCallback(async () => {
    const st = await loadState();
    setSync((p) => ({ ...p, connected: !!st }));
  }, []);
  useEffect(() => void refreshSync(), [refreshSync]);

  const { colorScheme, setColorScheme } = useColorScheme();
  const toggleTheme = useCallback(() => {
    const next = colorScheme === "dark" ? "light" : "dark";
    setColorScheme(next);
    void saveThemePref(next);
  }, [colorScheme, setColorScheme]);
  // Per-app language is an OS setting. Open the system per-app language screen (API 33+);
  // older Androids and iOS fall back to the app's settings page.
  const openLangSettings = useCallback(() => {
    if (Platform.OS !== "android") return void Linking.openSettings();
    IntentLauncher.startActivityAsync("android.settings.APP_LOCALE_SETTINGS", { data: "package:ai.vitls.app" }).catch(() => Linking.openSettings());
  }, []);

  /** Manual re-sync: pairing is automatic, so this just syncs now (self-pairing first if reconnecting). The OS asks for health permission on the first sync. */
  const connectPhone = useCallback(() => {
    setSync((p) => ({ ...p, busy: true, note: undefined }));
    void (async () => {
      try {
        const st = (await loadState()) ?? (await selfPair(SERVER));
        const next = await syncOrDisconnect(st);
        setSync({ connected: !!next, busy: false, note: next?.lastError ?? "Synced." });
      } catch (e) {
        setSync({ connected: false, busy: false, note: (e as Error).message });
      }
    })();
  }, []);
  return (
    <CollapsingScreen
      title={t("settings.title")}
      compactTitle={t("settings.title")}
      bottomInset={insets.bottom + s(16)}
      left={
        <Pressable onPress={() => router.back()} style={{ width: s(34), height: s(34), borderRadius: 999 }} className="items-center justify-center bg-muted" accessibilityLabel={t("a11y.back")}>
          <ChevronLeft color={c.fg} size={s(20)} />
        </Pressable>
      }
    >
      <View className="flex-row items-center" style={{ gap: s(12), marginTop: s(4) }}>
        <View style={{ width: s(48), height: s(48), borderRadius: 999, backgroundColor: c.fg }} className="items-center justify-center"><Text style={{ fontSize: s(16), fontWeight: "700", color: c.bg }}>AM</Text></View>
        <View style={{ gap: s(2) }}>
          <Text className="text-foreground" style={{ fontSize: s(16), fontWeight: "700" }}>{t("settings.account")}</Text>
          <Text className="text-muted-foreground" style={{ fontSize: s(13) }}>{t("settings.signedInOn")}</Text>
        </View>
      </View>

      <Section title={t("settings.sec.coaching")} c={c}>
        <Row icon={Target} label={t("settings.coachingStyle")} value={t("settings.coachingStyleVal")} onPress={() => askCoach(t("settings.prefill.coachingStyle"))} c={c} />
        <Row icon={UserRound} label={t("settings.goals")} onPress={() => askCoach(t("settings.prefill.goals"))} c={c} />
        <Row icon={Languages} label={t("settings.coachingLang")} onPress={() => askCoach(t("settings.prefill.language"))} c={c} last />
      </Section>

      <Section title={t("settings.sec.devices")} c={c}>
        <Row icon={Smartphone} label={sync.busy ? t("settings.syncing") : t("settings.phoneSync")} value={sync.note ?? (sync.connected ? t("settings.connectedSync") : t("settings.connect"))} onPress={sync.busy ? undefined : connectPhone} c={c} />
        <Row icon={Database} label={t("settings.yourData")} onPress={() => askCoach(t("settings.prefill.data"))} c={c} last />
      </Section>

      <Section title={t("settings.sec.sharing")} c={c}>
        <Row icon={Share2} label={t("settings.doctorAccess")} value={t("settings.off")} onPress={() => askCoach(t("settings.prefill.doctor"))} c={c} last />
      </Section>

      <Section title={t("settings.sec.prefs")} c={c}>
        <Row icon={Bell} label={t("settings.notifications")} onPress={() => askCoach(t("settings.prefill.reminders"))} c={c} />
        <Row icon={Languages} label={t("settings.language")} value={langLabel(lang)} onPress={openLangSettings} c={c} />
        <Row icon={Moon} label={t("settings.appearance")} value={t(colorScheme === "dark" ? "theme.dark" : "theme.light")} onPress={toggleTheme} c={c} />
        <Row icon={Shield} label={t("settings.privacy")} value={t("settings.privacyVal")} c={c} last />
      </Section>

      <Pressable onPress={() => void signOut()} className="flex-row items-center bg-muted" style={{ gap: s(12), borderRadius: s(18), paddingHorizontal: s(16), paddingVertical: s(13) }}>
        <LogOut color={c.danger} size={s(18)} />
        <Text style={{ fontSize: s(15), fontWeight: "600", color: c.danger }}>{t("settings.signOut")}</Text>
      </Pressable>

      <Text className="text-center text-muted-foreground" style={{ fontSize: s(11.5) }}>{t("settings.footer")}</Text>
    </CollapsingScreen>
  );
}

function Section({ title, children, c }: { title: string; children: ReactNode; c: ReturnType<typeof useColors> }) {
  return (
    <View style={{ gap: s(6) }}>
      <Text className="text-muted-foreground" style={{ fontSize: s(11), fontWeight: "700", letterSpacing: 1, paddingHorizontal: s(4) }}>{title}</Text>
      <View className="overflow-hidden bg-muted" style={{ borderRadius: s(18) }}>{children}</View>
    </View>
  );
}

function Row({ icon: Icon, label, value, onPress, last, c }: { icon: LucideIcon; label: string; value?: string; onPress?: () => void; last?: boolean; c: ReturnType<typeof useColors> }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} className="flex-row items-center" style={{ gap: s(12), paddingHorizontal: s(16), paddingVertical: s(13), borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line }}>
      <View style={{ width: s(32), height: s(32), borderRadius: 999 }} className="items-center justify-center bg-background"><Icon color={c.fg} size={s(17)} /></View>
      <Text className="flex-1 text-foreground" style={{ fontSize: s(15) }}>{label}</Text>
      {value ? <Text className="text-muted-foreground" style={{ fontSize: s(13) }} numberOfLines={1}>{value}</Text> : null}
      {onPress ? <ChevronRight color={c.muted} size={s(18)} /> : null}
    </Pressable>
  );
}
