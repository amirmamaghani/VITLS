/** VITLS bento primitives — sizes/weights taken straight from the design frame (390px) and scaled
    to the screen via s(). Role split: peach is a FILL only; text/units/icons are ink or grey.
    Numbers/headings are bold (the prototype's weights); the "light" Google-Sans look needs the
    bundled font (not yet shipped). */
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { cn } from "@/lib/utils";
import { s } from "@/lib/scale";

/** The bento card: grey tint, large radius, flat (no shadow). padding 18 / radius 26 from the design. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <View style={{ borderRadius: s(26), padding: s(18) }} className={cn("gap-3 overflow-hidden bg-muted", className)}>
      {children}
    </View>
  );
}

/** Round disc behind a small icon (chip-ic: 34px, paper fill). */
export function IconBadge({ children }: { children: ReactNode }) {
  return (
    <View style={{ width: s(34), height: s(34), borderRadius: 999 }} className="items-center justify-center bg-background">
      {children}
    </View>
  );
}

export function CardHeader({ icon, title, right }: { icon?: ReactNode; title: string; right?: ReactNode }) {
  return (
    <View className="flex-row items-center" style={{ gap: s(11) }}>
      {icon ? <IconBadge>{icon}</IconBadge> : null}
      <Text className="flex-1 text-foreground" style={{ fontSize: s(15), fontWeight: "700", letterSpacing: -0.2 }} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

/** Big bold number + grey unit. `lg` = hero figure (34), `md` = stat figure (21) — the design's sizes. */
export function Figure({ value, unit, size = "lg" }: { value: string; unit?: string; size?: "lg" | "md" }) {
  return (
    <View className="flex-row items-baseline" style={{ gap: s(3) }}>
      <Text className="text-foreground" style={{ fontSize: size === "lg" ? s(34) : s(21), fontWeight: "800", letterSpacing: -0.5, fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      {unit ? (
        <Text className="text-muted-foreground" style={{ fontSize: size === "lg" ? s(14) : s(12), fontWeight: "600" }}>
          {unit}
        </Text>
      ) : null}
    </View>
  );
}

/** Stat tile: icon chip, big number, small grey label beneath (stat-l: 10.5/600). */
export function Stat({ label, value, unit, icon }: { label: string; value: string; unit?: string; icon?: ReactNode }) {
  return (
    <Card className="flex-1 gap-2">
      {icon ? <IconBadge>{icon}</IconBadge> : null}
      <Figure value={value} unit={unit} size="md" />
      <Text className="text-muted-foreground" style={{ fontSize: s(10.5), fontWeight: "600" }}>
        {label}
      </Text>
    </Card>
  );
}

/** Hairline pill. `tone="primary"` = peach FILL with ink text (accent is never text on white). */
export function Pill({ children, tone }: { children: ReactNode; tone?: "primary" }) {
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: s(12), paddingVertical: s(4) }} className={cn("self-start", tone === "primary" ? "bg-primary" : "border border-border bg-background")}>
      <Text style={{ fontSize: s(13), fontVariant: ["tabular-nums"] }} className={tone === "primary" ? "text-primary-foreground" : "text-muted-foreground"}>
        {children}
      </Text>
    </View>
  );
}
