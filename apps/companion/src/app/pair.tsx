import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

import { clearDisconnected, pair } from "@/sync";
import { SERVER } from "./login";

export default function Pair() {
  const params = useLocalSearchParams<{ code?: string }>();
  const [server, setServer] = useState(SERVER || "https://");
  const [code, setCode] = useState(params.code ?? "");
  const [error, setError] = useState<string>();

  const submit = () =>
    pair(server, code)
      .then(() => clearDisconnected())
      .then(() => router.replace("/(tabs)"))
      .catch((e: Error) => setError(e.message));

  return (
    <View style={styles.screen}>
      <TextInput style={styles.input} value={server} onChangeText={setServer} placeholder="https://vitls.example" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <TextInput style={styles.input} value={code} onChangeText={setCode} placeholder="XXXX-XXXX-XXXX" autoCapitalize="characters" autoCorrect={false} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Pair" onPress={submit} disabled={!server || code.length < 12} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 8, padding: 12, fontSize: 16 },
  error: { color: "#c0392b" },
});
