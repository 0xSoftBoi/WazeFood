// Design tokens + theme provider. One source of truth for color (light/dark), type scale, spacing,
// radius, and elevation — tuned for an iOS-grade feel (true-black dark mode, restrained palette,
// SF-like type ramp). Components read tokens via useTheme(); nothing hardcodes a hex value.

import React, { createContext, useContext, useMemo } from "react";
import { Platform, useColorScheme, type TextStyle, type ViewStyle } from "react-native";

export type Scheme = "light" | "dark";

export type Colors = {
  bg: string;
  bgSubtle: string; // grouped background behind cards
  surface: string;
  surfaceElevated: string;
  surfaceSunken: string;
  border: string;
  hairline: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  primaryTint: string; // faint primary wash for cards/badges
  success: string;
  warning: string;
  danger: string;
  star: string;
  overlay: string;
};

const light: Colors = {
  bg: "#FFFFFF",
  bgSubtle: "#F2F3F5",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  surfaceSunken: "#F2F3F5",
  border: "#E4E7EC",
  hairline: "rgba(0,0,0,0.08)",
  textPrimary: "#0A0F1A",
  textSecondary: "#5A6472",
  textTertiary: "#99A1AE",
  primary: "#06A36A",
  primaryPressed: "#048455",
  onPrimary: "#FFFFFF",
  primaryTint: "#E6F7EF",
  success: "#16A34A",
  warning: "#D97706",
  danger: "#DC2626",
  star: "#F5A623",
  overlay: "rgba(0,0,0,0.45)",
};

const dark: Colors = {
  bg: "#000000",
  bgSubtle: "#0B0D10",
  surface: "#1A1C1F",
  surfaceElevated: "#26292E",
  surfaceSunken: "#101214",
  border: "rgba(255,255,255,0.12)",
  hairline: "rgba(255,255,255,0.10)",
  textPrimary: "#FFFFFF",
  textSecondary: "#A9B1BD",
  textTertiary: "#6B7480",
  primary: "#22C58B",
  primaryPressed: "#1AA976",
  onPrimary: "#04140E",
  primaryTint: "rgba(34,197,139,0.14)",
  success: "#34D399",
  warning: "#FBBF24",
  danger: "#F87171",
  star: "#FBBF24",
  overlay: "rgba(0,0,0,0.6)",
};

export const spacing = { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export type TypeVariant =
  | "largeTitle" | "title1" | "title2" | "title3" | "headline" | "body" | "callout" | "subhead" | "footnote" | "caption";

export const typography: Record<TypeVariant, TextStyle> = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "800", letterSpacing: 0.2 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: 0.2 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "700" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 23, fontWeight: "400" },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: "400" },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: "400" },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
};

export type Elevation = "none" | "sm" | "md" | "lg";

export function shadow(level: Elevation, scheme: Scheme): ViewStyle {
  if (level === "none" || scheme === "dark") return {}; // dark mode leans on surface contrast, not shadows
  const map = {
    sm: { o: 0.06, r: 6, y: 2, e: 2 },
    md: { o: 0.08, r: 14, y: 6, e: 5 },
    lg: { o: 0.12, r: 28, y: 12, e: 10 },
  } as const;
  const s = map[level];
  return Platform.select<ViewStyle>({
    ios: { shadowColor: "#0A0F1A", shadowOpacity: s.o, shadowRadius: s.r, shadowOffset: { width: 0, height: s.y } },
    android: { elevation: s.e },
    default: { boxShadow: `0 ${s.y}px ${s.r}px rgba(10,15,26,${s.o})` } as unknown as ViewStyle,
  })!;
}

export type Theme = {
  scheme: Scheme;
  colors: Colors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadow: (level: Elevation) => ViewStyle;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const scheme: Scheme = system === "dark" ? "dark" : "light";
  const value = useMemo<Theme>(
    () => ({
      scheme,
      colors: scheme === "dark" ? dark : light,
      spacing,
      radius,
      typography,
      shadow: (level: Elevation) => shadow(level, scheme),
    }),
    [scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
