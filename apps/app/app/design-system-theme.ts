/**
 * VITLS theme — three colours, soft "bento" dashboard style (white page, light grey cards, large radii, no borders
 * where tone separates, big light numbers):
 *
 *   primary    coral      #cc4b2c / dark #f07a5e → primary, ring, charts, key figures (white text on it 4.56:1, AA)
 *   secondary  ink        #141414 / dark #f2f2f2 → foreground, strong pills (user bubble)
 *   tertiary   soft grey  #f4f4f5 / dark #1c1c1e → muted, secondary, accent (hover/selection), widget surface
 *
 * The page and sidebar are one surface (white / near-black). shadcn's `secondary` token stays a soft fill on purpose:
 * the toolkit uses it for subtle backgrounds, so the ink "secondary colour" is expressed through `foreground`.
 * Dependency-light on purpose: vite.config.ts imports it at build time.
 */
import { defineTheme } from "@agent-native/toolkit/design-system";

export const vitlsTheme = defineTheme({
  colors: {
    light: {
      background: "#ffffff",
      foreground: "#141414",
      card: "#ffffff",
      "card-foreground": "#141414",
      popover: "#ffffff",
      "popover-foreground": "#141414",
      primary: "#cc4b2c",
      "primary-foreground": "#ffffff",
      secondary: "#f4f4f5",
      "secondary-foreground": "#141414",
      muted: "#f4f4f5",
      "muted-foreground": "#6b6b70",
      accent: "#ececee",
      "accent-foreground": "#141414",
      destructive: "#b42318",
      "destructive-foreground": "#ffffff",
      border: "#e8e8ea",
      input: "#e8e8ea",
      ring: "#cc4b2c",
      "sidebar-background": "#ffffff",
      "sidebar-foreground": "#6b6b70",
      "sidebar-primary": "#cc4b2c",
      "sidebar-primary-foreground": "#ffffff",
      "sidebar-accent": "#f4f4f5",
      "sidebar-accent-foreground": "#141414",
      "sidebar-border": "#e8e8ea",
      "sidebar-ring": "#cc4b2c",
    },
    dark: {
      background: "#0e0e0f",
      foreground: "#f2f2f2",
      card: "#161617",
      "card-foreground": "#f2f2f2",
      popover: "#1c1c1e",
      "popover-foreground": "#f2f2f2",
      primary: "#f07a5e",
      "primary-foreground": "#141414",
      secondary: "#1c1c1e",
      "secondary-foreground": "#f2f2f2",
      muted: "#1c1c1e",
      "muted-foreground": "#9a9aa0",
      accent: "#242426",
      "accent-foreground": "#f2f2f2",
      destructive: "#f97066",
      "destructive-foreground": "#141414",
      border: "#26262a",
      // Control boundary (inputs, selects, switch track, composer). Deliberately quiet: 1.6:1 on the page, 1.5:1
      // on a card (the original #2e2e32 was 1.4:1 and vanished); the line is 2 px instead (global.css) so the
      // boundary reads through weight, not contrast. WCAG 1.4.11 would want ≥ 3:1 (#63636a); the coral focus ring
      // carries the active field.
      input: "#36363b",
      ring: "#f07a5e",
      "sidebar-background": "#0e0e0f",
      "sidebar-foreground": "#9a9aa0",
      "sidebar-primary": "#f07a5e",
      "sidebar-primary-foreground": "#141414",
      "sidebar-accent": "#1c1c1e",
      "sidebar-accent-foreground": "#f2f2f2",
      "sidebar-border": "#26262a",
      "sidebar-ring": "#f07a5e",
    },
  },
  // Soft, rounded controls; toolkit derives lg/md/sm = 16/14/12 px from this. Widget cards go larger (global.css).
  radius: "1rem",
  // System UI stack for the shell; widgets use Google Sans Flex (global.css).
  typography: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif' },
});
