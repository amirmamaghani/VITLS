"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, Flip);

export { gsap, useGSAP, SplitText, Flip };

// Dev-only handle for driving timelines from browser automation / devtools.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  Object.assign(window, { gsap, ScrollTrigger });
}
