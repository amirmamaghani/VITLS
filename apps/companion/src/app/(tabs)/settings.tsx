import * as BackgroundTask from "expo-background-task";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Button, Linking, StyleSheet, Text, View } from "react-native";

import { disconnect, loadState, syncOrDisconnect, type State } from "@/sync";
import { SERVER } from "../login";

export default function Settings() {
  const [state, setState] = useState<State | null>();
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => void loadState().then((s) => setState(s ?? null)), []));
  if (state === undefined) return null;
  if (state === null)
    return (
      <View style={styles.screen}>
        <Text style={styles.body}>This phone is not connected to VITLS yet.</Text>
        <Button title="Sign in" onPress={() => router.push("/login")} />
      </View>
    );
  const run = async () => {
    setBusy(true);
    setState(await syncOrDisconnect(state));
    setBusy(false);
  };
  return (
    <View style={styles.screen}>
      <Text style={styles.body}>Server: {state.server}</Text>
      <Text style={styles.body}>Device: {state.deviceId}</Text>
      <Text style={styles.body}>Last sync: {state.lastSyncAt ?? "never"} (runs when you open the app and every ~15 min in the background)</Text>
      {state.lastError ? <Text style={[styles.body, styles.error]}>Last error: {state.lastError}</Text> : null}
      <Button title={busy ? "Syncing…" : "Sync now"} onPress={run} disabled={busy} />
      {__DEV__ ? <Button title="Run background task now (dev)" onPress={() => void BackgroundTask.triggerTaskWorkerForTestingAsync()} /> : null}
      <Button title="Enter pairing code" onPress={() => router.push("/pair")} />
      <Button title="Privacy policy" onPress={() => void Linking.openURL(`${SERVER}/privacy`)} />
      <Text style={styles.small}>VITLS is a coach, not a doctor. Nothing here is medical advice.</Text>
      <Button title="Disconnect" color="#c0392b" onPress={() => disconnect().then(() => setState(null))} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  body: { fontSize: 16 },
  small: { fontSize: 12, color: "#666" },
  error: { color: "#c0392b" },
});
