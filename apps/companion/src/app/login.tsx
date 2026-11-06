import { router } from "expo-router";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

import { clearDisconnected } from "@/sync";

export const SERVER = process.env.EXPO_PUBLIC_VITLS_SERVER ?? "";

/** Asks the server for a magic link; the link opens this app (Universal/App Link) and lands in the Coach tab (spec §3). */
export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    try {
      await clearDisconnected(); // an explicit sign-in re-enables pairing from the Coach WebView
      const res = await fetch(`${SERVER}/api/devices/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <View style={styles.screen}>
      {sent ? (
        <Text style={styles.body}>Check your e-mail and tap the sign-in link. It opens this app.</Text>
      ) : (
        <>
          <Text style={styles.body}>Sign in with the e-mail you use for VITLS.</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Send sign-in link" onPress={submit} disabled={!email.includes("@")} />
        </>
      )}
      <Button title="I have a pairing code" onPress={() => router.push("/pair")} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  body: { fontSize: 16 },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 8, padding: 12, fontSize: 16 },
  error: { color: "#c0392b" },
});
