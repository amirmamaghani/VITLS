import { Stack } from "expo-router";
import { useColorScheme } from "nativewind";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";

import "../../global.css"; // NativeWind: load Tailwind/VITLS styles before any route renders
import "@/sync"; // defines the background sync task before any route renders (also on headless launches)
import { loadThemePref } from "@/lib/appearance";
import { loadLang } from "@/lib/i18n";

export default function RootLayout() {
  const { setColorScheme } = useColorScheme();
  // Load the saved theme + language before the first paint, so neither flashes its default (EN/OS) then flips.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void Promise.all([loadThemePref().then((p) => p && setColorScheme(p)), loadLang()]).finally(() => setReady(true));
  }, [setColorScheme]);
  if (!ready) return <View style={{ flex: 1 }} className="bg-background" />;
  return (
    <KeyboardProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(main)" />
        {/* Chat is a native modal (slide-up + swipe-to-dismiss handled by the OS, not hand-rolled). */}
        <Stack.Screen name="chat" options={{ presentation: "modal" }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: true, title: "Sign in" }} />
        <Stack.Screen name="pair" options={{ headerShown: true, title: "Enter pairing code", presentation: "modal" }} />
      </Stack>
    </KeyboardProvider>
  );
}
