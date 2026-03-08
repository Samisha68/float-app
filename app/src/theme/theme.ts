/**
 * Float — Premium Design System
 * Dark, refined aesthetic with indigo/violet accents
 */

import { Platform } from "react-native";

export const colors = {
  // Backgrounds
  bg: "#050508",
  bgElevated: "#0C0C12",
  bgCard: "#12121A",
  bgCardHover: "#18182A",
  bgInput: "#0E0E14",

  // Surface
  surface: "#16161F",
  surfaceBorder: "#1E1E2E",
  surfaceBorderSubtle: "#252532",

  // Text
  text: "#FAFAFC",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  textDisabled: "#475569",

  // Accent
  primary: "#6366F1",
  primaryLight: "#818CF8",
  primaryDark: "#4F46E5",
  primaryMuted: "rgba(99, 102, 241, 0.15)",
  primaryGlow: "rgba(99, 102, 241, 0.4)",

  // Semantic
  success: "#22C55E",
  successMuted: "rgba(34, 197, 94, 0.15)",
  warning: "#F59E0B",
  warningMuted: "rgba(245, 158, 11, 0.15)",
  error: "#EF4444",
  errorMuted: "rgba(239, 68, 68, 0.15)",
  info: "#3B82F6",

  // Status
  active: "#4ADE80",
  repaid: "#60A5FA",
  liquidated: "#F87171",
  collateralWithdrawn: "#A78BFA",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 9999,
};

export const typography = {
  hero: {
    fontSize: 48,
    fontWeight: "900" as const,
    letterSpacing: -2,
  },
  h1: {
    fontSize: 32,
    fontWeight: "800" as const,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 24,
    fontWeight: "700" as const,
  },
  h3: {
    fontSize: 20,
    fontWeight: "700" as const,
  },
  body: {
    fontSize: 16,
    fontWeight: "500" as const,
  },
  bodySm: {
    fontSize: 14,
    fontWeight: "500" as const,
  },
  caption: {
    fontSize: 12,
    fontWeight: "500" as const,
  },
  label: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 1,
  },
  mono: {
    fontSize: 13,
    fontWeight: "600" as const,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
};

export const shadows = {
  sm: Platform.select({
    ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.4, shadowRadius: 2 },
    android: { elevation: 2 },
  }),
  md: Platform.select({
    ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 4 },
    android: { elevation: 4 },
  }),
  lg: Platform.select({
    ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
    android: { elevation: 8 },
  }),
  glow: Platform.select({
    ios: { shadowColor: colors.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 12 },
    android: { elevation: 6 },
  }),
};
