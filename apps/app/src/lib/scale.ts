/** The design (Claude canvas / prototype) is drawn in a 390px-wide phone frame.
    `s()` maps a measurement from that frame onto the real screen, so fonts, paddings and
    radii keep the design's proportions on a small phone and grow on a large one (Pixel 10,
    tablets) instead of looking tiny. Gentle clamp so big screens don't balloon. */
import { Dimensions } from "react-native";

export const DESIGN_WIDTH = 390;
const { width } = Dimensions.get("window");
const factor = Math.min(Math.max(width / DESIGN_WIDTH, 1), 1.3);

export const s = (n: number): number => Math.round(n * factor);
