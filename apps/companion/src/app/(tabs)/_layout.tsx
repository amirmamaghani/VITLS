import { Tabs } from "expo-router";

import { usePushRouting } from "@/push";

export default function TabsLayout() {
  usePushRouting();
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="coach" options={{ title: "Coach" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
