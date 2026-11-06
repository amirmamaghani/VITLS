import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind/NativeWind class strings (same contract as apps/app's cn). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
