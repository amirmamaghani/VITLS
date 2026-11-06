import { Stack } from "expo-router";

import "@/sync"; // defines the background sync task before any route renders (also on headless launches)

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" options={{ headerShown: true, title: "Sign in" }} />
      <Stack.Screen name="pair" options={{ headerShown: true, title: "Enter pairing code", presentation: "modal" }} />
    </Stack>
  );
}
