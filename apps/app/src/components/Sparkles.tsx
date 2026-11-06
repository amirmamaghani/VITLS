/** The coach / AI identity mark — a filled sparkle, never a speech bubble (that reads as support chat). */
import { Sparkles as Lucide } from "lucide-react-native";

export function Sparkle({ size = 16, color = "#202124" }: { size?: number; color?: string }) {
  return <Lucide size={size} color={color} fill={color} strokeWidth={1.4} />;
}
