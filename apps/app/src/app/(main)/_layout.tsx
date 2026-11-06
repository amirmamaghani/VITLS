import { Stack } from "expo-router";
import { useRef } from "react";
import { View } from "react-native";

import { BlurTargetView } from "@/components/Glass";
import { NavBar } from "@/nav";
import { usePushRouting } from "@/push";

/** The main area: a headerless stack (Today, boards) with the two floating menus overlaid on top.
    The stack is a BlurTargetView so the frosted nav pill can blur the screen scrolling under it. */
export default function MainLayout() {
  usePushRouting();
  const bgRef = useRef<View>(null);
  return (
    <View className="flex-1 bg-background">
      <BlurTargetView ref={bgRef} style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" } }} />
      </BlurTargetView>
      <NavBar blurTarget={bgRef} />
    </View>
  );
}
