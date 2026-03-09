import React from "react";
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, spacing, typography } from "../theme/theme";

type Variant = "primary" | "secondary" | "ghost" | "outline";

interface Props {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function PremiumButton({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  size = "md",
  fullWidth,
  style,
  textStyle,
}: Props) {
  const isDisabled = disabled || loading;
  const paddingY = size === "sm" ? 12 : size === "lg" ? 20 : 16;
  const fontSize = size === "sm" ? 14 : size === "lg" ? 18 : 16;

  if (variant === "primary") {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.85}
        style={[fullWidth && { width: "100%" }, style]}
      >
        <LinearGradient
          colors={isDisabled ? ["#374151", "#374151"] : [colors.primary, colors.primaryDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.base,
            { paddingVertical: paddingY, borderRadius: radius.lg },
            isDisabled && styles.disabled,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <Text style={[styles.primaryText, { fontSize }, textStyle]}>{title}</Text>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  const bgColor =
    variant === "secondary"
      ? colors.surface
      : variant === "outline"
      ? "transparent"
      : "transparent";
  const borderWidth = variant === "outline" ? 1.5 : 0;
  const textColor =
    variant === "secondary"
      ? colors.text
      : variant === "outline"
      ? colors.primaryLight
      : colors.textSecondary;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      style={[
        styles.base,
        { paddingVertical: paddingY, borderRadius: radius.lg, backgroundColor: bgColor, borderWidth, borderColor: colors.primary },
        fullWidth && { width: "100%" },
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <Text style={[styles.secondaryText, { fontSize, color: textColor }, textStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.5 },
  primaryText: { color: "#FFF", fontWeight: "700" },
  secondaryText: { fontWeight: "600" },
});
