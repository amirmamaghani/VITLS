import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { BlurTargetView, Glass } from "@/components/Glass";
import { fetch as expoFetch } from "expo/fetch";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowUp, Camera, ChevronDown, ImagePlus, Plus, Square, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { applyCoachLocale, pinWidget } from "@/api";
import { Markdown } from "@/MarkdownView";
import { Sparkle } from "@/components/Sparkles";
import { HealthWidget, type WidgetConfig } from "@/components/widgets";
import { chatTitle, classifyPart, isUnauthorized, pickCurrentChat, type ChatSummary } from "@/chat";
import { useT } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { s } from "@/lib/scale";
import { apiGet, apiPost, clearSession, loadLastChat, loadSession, SERVER, saveLastChat, Unauthorized } from "@/server-client";

const toLogin = async () => {
  await clearSession();
  router.replace("/login");
};

/** Output of the coach's `ask-question` tool — rendered as tappable multiple-choice (Claude-app style). */
type AskQuestion = {
  question: string;
  label?: string;
  options: { label: string; value?: string; description?: string; recommended?: boolean }[];
  allowFreeText?: boolean;
  allowMultiple?: boolean;
};

export default function Chat() {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const [dashboardId, setDashboardId] = useState<string>();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [text, setText] = useState(prefill ?? "");
  const [attachments, setAttachments] = useState<{ mediaType: string; url: string }[]>([]);
  const [pinned, setPinned] = useState<Record<string, boolean>>({});
  const [composerH, setComposerH] = useState(0);
  const keyboard = useReanimatedKeyboardAnimation(); // { height, progress } shared values that track the keyboard frame-by-frame
  // A spacer at the inverted list's visual bottom grows/shrinks with the keyboard, so messages glide with it (no jump).
  const kbSpacer = useAnimatedStyle(() => ({ height: Math.abs(keyboard.height.value) }));

  const msgTarget = useRef<View>(null); // the message list, blurred behind the frosted composer
  const board = useRef<string>(undefined);
  board.current = dashboardId;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${SERVER}/api/chat`,
        fetch: expoFetch as unknown as typeof globalThis.fetch,
        prepareSendMessagesRequest: async ({ messages, body }) => {
          const token = await loadSession();
          if (!token) throw new Unauthorized();
          return { body: { ...body, dashboardId: board.current, messages: messages.slice(-1) }, headers: { Authorization: `Bearer ${token}` } };
        },
      }),
    [],
  );
  const { messages, setMessages, sendMessage, stop, status, error } = useChat({ transport, onError: (e) => isUnauthorized(e) && void toLogin() });
  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  const refreshChats = useCallback(async () => {
    try {
      setChats(await apiGet<ChatSummary[]>("/api/chat/threads"));
    } catch (e) {
      if (isUnauthorized(e)) void toLogin();
    }
  }, []);

  const openChat = useCallback(
    async (id: string) => {
      setDashboardId(id);
      void saveLastChat(id);
      setMenuOpen(false);
      try {
        const { messages: msgs } = await apiGet<{ messages: unknown[] }>(`/api/chat/threads/${id}`);
        setMessages(msgs as never);
      } catch (e) {
        if (isUnauthorized(e)) void toLogin();
      }
    },
    [setMessages],
  );

  const newChat = useCallback(async () => {
    try {
      const d = await apiPost<{ id: string }>("/api/dashboards", { title: "New chat" });
      setMessages([] as never);
      setDashboardId(d.id);
      void saveLastChat(d.id);
      setMenuOpen(false);
    } catch (e) {
      if (isUnauthorized(e)) void toLogin();
    }
  }, [setMessages]);

  useEffect(() => {
    void (async () => {
      try {
        if (!(await loadSession())) return router.replace("/login");
        const list = await apiGet<ChatSummary[]>("/api/chat/threads");
        setChats(list);
        const id = pickCurrentChat(list, await loadLastChat()) ?? (await apiGet<{ id: string }[]>("/api/dashboards"))[0]?.id ?? "default";
        await openChat(id);
      } catch (e) {
        if (isUnauthorized(e)) void toLogin();
      }
    })();
  }, [openChat]);

  // When the coach switches the app language (set-localization-preference tool), flip it live from the stream — no restart.
  useEffect(() => {
    let locale: string | undefined;
    for (const m of messages)
      for (const p of m.parts as { type: string; output?: { localization?: { locale?: string } } }[])
        if (p.type === "tool-set-localization-preference") locale = p.output?.localization?.locale ?? locale;
    applyCoachLocale(locale);
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";
  const prevBusy = useRef(busy);
  useEffect(() => {
    if (prevBusy.current && !busy) void refreshChats();
    prevBusy.current = busy;
  }, [busy, refreshChats]);

  const send = () => {
    const t = text.trim();
    if ((!t && attachments.length === 0) || !dashboardId || busy) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const files = attachments.map((a) => ({ type: "file" as const, mediaType: a.mediaType, url: a.url }));
    void sendMessage(t ? { text: t, files } : { files });
    setText("");
    setAttachments([]);
  };

  /** A tapped ask-question option is sent as the user's next message (Claude-app quick replies). */
  const sendQuick = (value: string) => {
    if (!dashboardId || busy || !value.trim()) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void sendMessage({ text: value });
  };

  const addImage = async (fromCamera: boolean) => {
    const perm = await (fromCamera ? ImagePicker.requestCameraPermissionsAsync() : ImagePicker.requestMediaLibraryPermissionsAsync());
    if (!perm.granted) return;
    const res = await (fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({ mediaTypes: "images", quality: 0.5, base64: true });
    const a = res.canceled ? undefined : res.assets[0];
    if (!a?.base64) return;
    const mediaType = a.mimeType ?? "image/jpeg";
    setAttachments((xs) => [...xs, { mediaType, url: `data:${mediaType};base64,${a.base64}` }]);
  };

  const pin = async (key: string, widget: WidgetConfig) => {
    if (!dashboardId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await pinWidget(dashboardId, widget);
      setPinned((p) => ({ ...p, [key]: true }));
    } catch {
      /* leave unpinned; the user can retry */
    }
  };

  const title = chatTitle(chats, dashboardId);
  // Static space for the resting composer; the animated keyboard spacer (ListHeaderComponent) adds the keyboard height.
  const restGap = insets.bottom + s(20); // how high the composer floats above the bottom when the keyboard is closed
  const bottomReserve = restGap + composerH + s(16);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        {/* header = chat switcher */}
        <View className="flex-row items-center justify-between border-b border-border px-4 pb-3 pt-2">
          <Pressable
            onPress={() => {
              setMenuOpen((o) => !o);
              void refreshChats();
            }}
            className="max-w-[240px] flex-row items-center gap-2"
            accessibilityLabel="Switch chat"
          >
            <View style={{ width: s(28), height: s(28), borderRadius: 999 }} className="items-center justify-center bg-primary"><Sparkle size={s(15)} color={c.onAccent} /></View>
            <Text className="font-bold text-foreground" style={{ fontSize: s(17) }} numberOfLines={1}>{title}</Text>
            <ChevronDown color={c.muted} size={s(18)} />
          </Pressable>
          <Pressable onPress={() => router.back()} className="h-9 w-9 items-center justify-center rounded-xl bg-muted" accessibilityLabel="Close">
            <X color={c.muted} size={18} />
          </Pressable>
        </View>

        <BlurTargetView ref={msgTarget} style={{ flex: 1 }}>
        <FlatList
          style={{ flex: 1 }}
          inverted
          data={reversed}
          keyExtractor={(m, index) => m.id || `row-${index}`}
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 14, gap: 14, paddingTop: bottomReserve }}
          ListHeaderComponent={<Animated.View style={kbSpacer} />}
          renderItem={({ item }) => {
            const mine = item.role === "user";
            return (
              <View className={mine ? "items-end" : "w-full"}>
                {item.parts.map((p, i) => {
                  const part = p as { type: string; output?: { widget?: WidgetConfig } & AskQuestion; input?: AskQuestion };
                  if (part.type === "tool-show-widget" && part.output?.widget) {
                    const w = part.output.widget;
                    const key = `${item.id}-${i}`;
                    return (
                      <View key={i} className="ml-9 w-[86%] py-1">
                        <HealthWidget widget={w} placement="chat" onPin={() => void pin(key, w)} pinned={pinned[key]} />
                      </View>
                    );
                  }
                  if (part.type === "tool-ask-question") {
                    const q = (part.output ?? part.input) as AskQuestion | undefined;
                    if (q?.options?.length) return <AskQuestionCard key={i} q={q} onPick={sendQuick} disabled={busy} c={c} />;
                    return null;
                  }
                  const v = classifyPart(p as never);
                  if (!v) return null;
                  if (v.kind === "image") return <Image key={i} source={{ uri: v.url }} className="h-48 w-48 rounded-2xl" resizeMode="cover" />;
                  if (v.kind === "text")
                    return mine ? (
                      <View key={i} className="self-end rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5">
                        <Text className="text-primary-foreground" style={{ fontSize: s(14.5), lineHeight: Math.round(s(14.5) * 1.5) }}>{v.text}</Text>
                      </View>
                    ) : (
                      <View key={i} className="flex-row gap-2.5">
                        <View style={{ width: s(28), height: s(28), borderRadius: 999, marginTop: s(2) }} className="items-center justify-center bg-muted"><Sparkle size={s(15)} color={c.fg} /></View>
                        <View className="flex-1"><Markdown text={v.text} color={c.fg} size={s(14.5)} /></View>
                      </View>
                    );
                  return (
                    <View key={i} className="ml-9 self-start rounded-xl border border-border bg-muted px-2.5 py-2">
                      <Text className="font-semibold text-foreground" style={{ fontSize: s(12) }}>{v.name}</Text>
                    </View>
                  );
                })}
              </View>
            );
          }}
          ListFooterComponent={error ? <Text className="p-2 text-destructive">{error.message}</Text> : null}
        />
        </BlurTargetView>

        {menuOpen ? (
          <>
            <Pressable className="absolute inset-0 z-10" onPress={() => setMenuOpen(false)} accessibilityLabel="Close chat list" />
            <View className="absolute left-2 right-2 z-20 rounded-3xl border border-border bg-background p-1.5" style={{ top: insets.top + s(54), shadowColor: "#202124", shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 10 }}>
              <Text className="px-3 pb-1 pt-2 font-bold tracking-widest text-muted-foreground" style={{ fontSize: s(11) }}>{t("chat.yourChats")}</Text>
              <ScrollView className="max-h-80">
                {chats.map((ch) => {
                  const active = ch.dashboardId === dashboardId;
                  return (
                    <Pressable key={ch.dashboardId} onPress={() => void openChat(ch.dashboardId)} className="flex-row items-center gap-3 rounded-2xl px-2.5 py-2.5" style={active ? { backgroundColor: c.tint } : undefined}>
                      <View style={{ width: s(34), height: s(34), borderRadius: s(11), backgroundColor: active ? c.accent : c.card }} className="items-center justify-center"><Sparkle size={s(15)} color={active ? c.onAccent : c.fg} /></View>
                      <Text className={`flex-1 ${active ? "font-semibold" : ""} text-foreground`} style={{ fontSize: s(14.5) }} numberOfLines={1}>{ch.title || "New chat"}</Text>
                    </Pressable>
                  );
                })}
                {chats.length === 0 ? <Text className="px-3 py-3 text-muted-foreground" style={{ fontSize: s(13) }}>{t("chat.noChats")}</Text> : null}
              </ScrollView>
              <Pressable onPress={() => void newChat()} className="mt-1 flex-row items-center gap-3 border-t border-border px-2.5 py-3">
                <View style={{ width: s(34), height: s(34), borderRadius: s(11) }} className="items-center justify-center bg-primary"><Plus color={c.onAccent} size={s(16)} /></View>
                <Text className="font-semibold text-foreground" style={{ fontSize: s(14.5) }}>{t("chat.newChat")}</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {/* floating composer */}
        <KeyboardStickyView style={{ position: "absolute", left: 0, right: 0, bottom: 0 }} offset={{ closed: -restGap, opened: -s(8) }}>
          <Glass
            onLayout={(e) => setComposerH(e.nativeEvent.layout.height)}
            blurTarget={msgTarget}
            style={{
              marginHorizontal: 12,
              borderRadius: 28,
              borderColor: c.line,
              paddingHorizontal: 12,
              paddingTop: 12,
              paddingBottom: 8,
              gap: 8,
              shadowColor: "#202124",
              shadowOpacity: 0.22,
              shadowRadius: 30,
              shadowOffset: { width: 0, height: 14 },
              elevation: 24,
            }}
          >
            {attachments.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <View key={i} className="relative">
                    <Image source={{ uri: a.url }} className="h-16 w-16 rounded-lg" resizeMode="cover" />
                    <Pressable onPress={() => setAttachments((xs) => xs.filter((_, j) => j !== i))} className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full bg-foreground" accessibilityLabel="Remove photo">
                      <X color={c.bg} size={12} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            <TextInput className="max-h-32 px-1 text-foreground" style={{ fontSize: s(15.5) }} placeholder={dashboardId ? t("chat.messagePlaceholder") : t("chat.loading")} placeholderTextColor={c.muted} value={text} onChangeText={setText} editable={!!dashboardId} multiline />
            <View className="flex-row items-center">
              <Pressable onPress={() => void addImage(false)} disabled={!dashboardId} className="h-9 w-9 items-center justify-center rounded-full" accessibilityLabel="Add photo from library"><ImagePlus color={c.muted} size={22} /></Pressable>
              <Pressable onPress={() => void addImage(true)} disabled={!dashboardId} className="h-9 w-9 items-center justify-center rounded-full" accessibilityLabel="Take a photo"><Camera color={c.muted} size={22} /></Pressable>
              <View className="flex-1" />
              <Pressable onPress={busy ? () => void stop() : send} className={`h-9 w-9 items-center justify-center rounded-full ${busy ? "bg-secondary" : "bg-primary"}`} accessibilityLabel={busy ? "Stop" : "Send"}>
                {busy ? <Square color={c.fg} size={16} fill={c.fg} /> : <ArrowUp color={c.onAccent} size={20} />}
              </Pressable>
            </View>
          </Glass>
        </KeyboardStickyView>
    </View>
  );
}

/** The coach's multiple-choice question: the prompt plus tappable option buttons; a tap sends that option. */
function AskQuestionCard({ q, onPick, disabled, c }: { q: AskQuestion; onPick: (value: string) => void; disabled: boolean; c: ReturnType<typeof useColors> }) {
  const t = useT();
  return (
    <View className="flex-row gap-2.5">
      <View style={{ width: s(28), height: s(28), borderRadius: 999, marginTop: s(2) }} className="items-center justify-center bg-muted"><Sparkle size={s(15)} color={c.fg} /></View>
      <View className="flex-1" style={{ gap: s(8) }}>
        {q.label ? <Text className="text-muted-foreground" style={{ fontSize: s(11), fontWeight: "700", letterSpacing: 0.6 }}>{q.label.toUpperCase()}</Text> : null}
        <Text className="text-foreground" style={{ fontSize: s(14.5), lineHeight: Math.round(s(14.5) * 1.5), fontWeight: "600" }}>{q.question}</Text>
        <View style={{ gap: s(8) }}>
          {q.options.map((o, i) => (
            <Pressable
              key={i}
              onPress={() => onPick(o.value ?? o.label)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              style={{ borderRadius: s(16), paddingHorizontal: s(14), paddingVertical: s(11), borderWidth: 1.5, borderColor: o.recommended ? c.accent : c.line, backgroundColor: o.recommended ? c.tint : "transparent", opacity: disabled ? 0.5 : 1 }}
            >
              <Text className="text-foreground" style={{ fontSize: s(14), fontWeight: "600" }}>{o.label}</Text>
              {o.description ? <Text className="text-muted-foreground" style={{ fontSize: s(12), marginTop: s(2) }}>{o.description}</Text> : null}
            </Pressable>
          ))}
        </View>
        {q.allowFreeText ? <Text className="text-muted-foreground" style={{ fontSize: s(11.5) }}>{t("chat.orType")}</Text> : null}
      </View>
    </View>
  );
}
