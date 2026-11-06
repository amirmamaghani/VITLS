import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";

import { captureSession } from "@/server-client";

/** Landing for a magic link opened in the app: completes the verify, stores the session token, then enters the app. */
export default function Verify() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    captureSession(url).then((ok) => (ok ? router.replace("/") : setFailed(true)), () => setFailed(true));
  }, [url]);
  return (
    <View style={styles.screen}>
      <Text>{failed ? "This sign-in link is invalid or expired." : "Signing in..."}</Text>
      {failed ? <Button title="Back to sign in" onPress={() => router.replace("/login")} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 } });
