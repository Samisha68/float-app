import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, radius, typography, spacing } from "../theme/theme";

const PREF_KEY = "float_agent_preferences";

export interface AgentPreferences {
  maxAmountUsd: number;
  aprBps: number;
  riskLevel: "low" | "medium";
}

const DEFAULT_PREFS: AgentPreferences = {
  maxAmountUsd: 50,
  aprBps: 500,
  riskLevel: "low",
};

interface Props {
  navigation: any;
}

export function AgentPreferencesScreen({ navigation }: Props) {
  const [maxAmountUsd, setMaxAmountUsd] = useState(DEFAULT_PREFS.maxAmountUsd.toString());
  const [aprPercent, setAprPercent] = useState(DEFAULT_PREFS.aprBps / 100);
  const [riskLevel, setRiskLevel] = useState<AgentPreferences["riskLevel"]>(DEFAULT_PREFS.riskLevel);

  const save = async () => {
    const prefs: AgentPreferences = {
      maxAmountUsd: Math.min(100, Math.max(1, parseFloat(maxAmountUsd) || 50)),
      aprBps: Math.min(2000, Math.max(0, Math.round(aprPercent * 100))),
      riskLevel,
    };
    await AsyncStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Agent preferences</Text>
        <Text style={styles.hint}>Used by the rule-based agent to match micro-loans (MVP).</Text>

        <Text style={styles.label}>Max loan amount (USDC)</Text>
        <View style={styles.chipRow}>
          {[10, 25, 50, 100].map((n) => (
            <TouchableOpacity
              key={n}
              style={[styles.chip, maxAmountUsd === String(n) && styles.chipActive]}
              onPress={() => setMaxAmountUsd(String(n))}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, maxAmountUsd === String(n) && styles.chipTextActive]}>${n}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Target APR %</Text>
        <View style={styles.sliderRow}>
          <TouchableOpacity onPress={() => setAprPercent((p) => Math.max(0, p - 1))} style={styles.sliderBtn} activeOpacity={0.7}>
            <Text style={styles.sliderBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.sliderVal}>{aprPercent}%</Text>
          <TouchableOpacity onPress={() => setAprPercent((p) => Math.min(20, p + 1))} style={styles.sliderBtn} activeOpacity={0.7}>
            <Text style={styles.sliderBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Risk level</Text>
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, riskLevel === "low" && styles.chipActive]}
            onPress={() => setRiskLevel("low")}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, riskLevel === "low" && styles.chipTextActive]}>Low</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, riskLevel === "medium" && styles.chipActive]}
            onPress={() => setRiskLevel("medium")}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, riskLevel === "medium" && styles.chipTextActive]}>Medium</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={save} activeOpacity={0.9}>
          <Text style={styles.saveBtnText}>Save</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl },
  backBtn: { marginBottom: spacing.lg },
  backText: { color: colors.primaryLight, fontSize: 16, fontWeight: "600" },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.sm },
  hint: { color: colors.textMuted, fontSize: 14, marginBottom: spacing.xxl },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.md },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.xl },
  chip: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 15, fontWeight: "600" },
  chipTextActive: { color: "#FFF" },
  sliderRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.xxl },
  sliderBtn: { padding: spacing.md },
  sliderBtnText: { color: colors.primaryLight, fontSize: 28, fontWeight: "600" },
  sliderVal: { color: colors.text, fontSize: 20, fontWeight: "700", marginHorizontal: spacing.lg },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 18,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  saveBtnText: { color: "#FFF", fontSize: 17, fontWeight: "700" },
  cancelBtn: { marginTop: spacing.lg, alignItems: "center" },
  cancelText: { color: colors.textMuted, fontSize: 15 },
});
