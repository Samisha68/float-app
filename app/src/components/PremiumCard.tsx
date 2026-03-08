import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { colors, radius, shadows } from "../theme/theme";

interface Props {
  children: React.ReactNode;
  variant?: "default" | "elevated" | "outlined";
  style?: ViewStyle;
}

export function PremiumCard({ children, variant = "default", style }: Props) {
  return (
    <View
      style={[
        styles.base,
        variant === "elevated" && [styles.elevated, shadows.md],
        variant === "outlined" && styles.outlined,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  elevated: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.surfaceBorderSubtle,
  },
  outlined: {
    backgroundColor: "transparent",
    borderColor: colors.primaryMuted,
  },
});
