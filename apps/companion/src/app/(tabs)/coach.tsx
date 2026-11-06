import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, BackHandler, Button, Platform, StyleSheet, TextInput, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { injectToWeb, isDirectLink, parseFromWeb, sameOrigin, serverUrl, SHELL_INIT } from "@/bridge";
import { isDisconnected, loadState, pair, syncOrDisconnect, type State } from "@/sync";
import { SERVER } from "../login";

if (!SERVER) throw new Error("EXPO_PUBLIC_VITLS_SERVER is required");

const UA_SUFFIX = `VITLSCompanion/${Constants.expoConfig?.version ?? "0"}`;

/** The account comes from the web page, so the user confirms it before this phone's health data goes there. */
const confirmPair = (email: string) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(
      "Connect this phone?",
      `Send this phone's health data to ${email}?`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Pair", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );

/** The PWA. The initial URL is the incoming link (magic link / push url) when there is one, else /home. */
export default function Coach() {
  const params = useLocalSearchParams<{ url?: string }>();
  const web = useRef<WebView>(null);
  const pairing = useRef(false); // a pair redemption is in flight
  const [state, setState] = useState<State>();
  const [canGoBack, setCanGoBack] = useState(false);
  const [devInput, setDevInput] = useState("");
  const [devUrl, setDevUrl] = useState<string>();
  useFocusEffect(useCallback(() => void loadState().then(setState), []));

  // params.url is the full link (magic link / push url) or a server path; anything off our origin falls back to /home.
  // Sign-in paths load only from a direct https App/Universal Link (or the dev URL box), never from a vitls:// or push param.
  const link = devUrl ?? params.url;
  const start = (link && serverUrl(link, SERVER, devUrl !== undefined || isDirectLink(params.url))) || `${SERVER}/home`;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => (canGoBack ? (web.current?.goBack(), true) : false));
    return () => sub.remove();
  }, [canGoBack]);

  const push = (s: Partial<State> | undefined) => web.current?.injectJavaScript(injectToWeb({ v: 1, type: "sync-status", lastSyncAt: s?.lastSyncAt, lastError: s?.lastError, deviceId: s?.deviceId }));

  const onMessage = async (e: WebViewMessageEvent) => {
    if (!sameOrigin(e.nativeEvent.url, SERVER)) return; // only our own pages get the bridge
    const m = parseFromWeb(e.nativeEvent.data);
    if (!m) return;
    if (m.type === "pair") {
      if (pairing.current) return; // one redemption at a time (set before any await)
      pairing.current = true;
    }
    let current: State | undefined;
    try {
      // Read the stored state, not the render's copy: it may be stale (another pair or a disconnect since).
      current = await loadState();
      if (m.type === "pair") {
        if (current) return push(current); // already paired: just report status
        if (await isDisconnected()) return push(undefined); // the user disconnected (or was revoked): no silent re-pair
        if (!(await confirmPair(m.email))) return push(undefined);
        const s = await pair(SERVER, m.code);
        setState(s);
        push(s);
      } else if (current) {
        const s = await syncOrDisconnect(current);
        setState(s ?? undefined);
        push(s ?? undefined);
      } else {
        push(undefined);
      }
    } catch (err) {
      push({ ...current, lastError: (err as Error).message });
    } finally {
      if (m.type === "pair") pairing.current = false;
    }
  };

  return (
    <View style={styles.fill}>
      {__DEV__ ? (
        <View style={styles.dev}>
          <TextInput style={styles.devInput} value={devInput} onChangeText={setDevInput} placeholder="Open URL (dev)" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Button title="Open" onPress={() => setDevUrl(devInput.trim())} disabled={!devInput.trim()} />
        </View>
      ) : null}
      <WebView
        key={start}
        ref={web}
        source={{ uri: start }}
        applicationNameForUserAgent={UA_SUFFIX}
        injectedJavaScriptBeforeContentLoaded={SHELL_INIT(Platform.OS)}
        onMessage={onMessage}
        onLoadEnd={() => push(state)}
        onNavigationStateChange={(nav) => setCanGoBack(nav.canGoBack)}
        onShouldStartLoadWithRequest={(req) => (sameOrigin(req.url, SERVER) ? true : (void Linking.openURL(req.url), false))}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsBackForwardNavigationGestures
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dev: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8 },
  devInput: { flex: 1, borderWidth: 1, borderColor: "#999", borderRadius: 8, padding: 8, fontSize: 14 },
});
