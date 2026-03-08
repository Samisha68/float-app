import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, typography, spacing } from "../theme/theme";

interface Props {
  navigation: any;
}

// ── AI agent reasoning steps (simulated for MVP demo) ─────────────────────────
interface AgentStep {
  ms: number;        // delay from "run" press
  phase: "scan" | "check" | "ai" | "exec" | "done" | "reject";
  icon: string;
  text: string;
}

const AGENT_STEPS: AgentStep[] = [
  { ms: 600,  phase: "scan",   icon: "◎",  text: "Scanning on-chain for borrow requests…" },
  { ms: 1800, phase: "scan",   icon: "◇",  text: "Found: 10 USDC / 3 days / nonce=1 (borrower: 4xKj…mP9r)" },
  { ms: 3000, phase: "check",  icon: "◈",  text: "Checking wallet age → first tx: 47 days ago ✓" },
  { ms: 4100, phase: "check",  icon: "◈",  text: "Checking USDC balance → 15.40 USDC (need 11.00 ✓)" },
  { ms: 5200, phase: "check",  icon: "◈",  text: "Checking pool liquidity → 487 USDC available ✓" },
  { ms: 6500, phase: "ai",     icon: "◆",  text: "GPT-4o: wallet age ≥ 30 days → LOW risk" },
  { ms: 7400, phase: "ai",     icon: "◆",  text: "GPT-4o decision: APPROVE — collateral sufficient" },
  { ms: 8600, phase: "exec",   icon: "✦",  text: "Submitting agent_match_loan on-chain…" },
  { ms: 10200, phase: "done",  icon: "✓",  text: "Loan matched! Tx: 5MXz…qR7k confirmed." },
];

const PHASE_COLORS: Record<AgentStep["phase"], string> = {
  scan:   colors.primaryLight,
  check:  colors.warning,
  ai:     colors.info,
  exec:   colors.primary,
  done:   colors.success,
  reject: colors.error,
};

export function AgentStatusScreen({ navigation }: Props) {
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);
  const [logEntries, setLogEntries] = useState<AgentStep[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation while running
  useEffect(() => {
    if (running) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [running]);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const handleRun = () => {
    if (paused) return;
    clearTimers();
    setLogEntries([]);
    setRunning(true);

    AGENT_STEPS.forEach((step) => {
      const t = setTimeout(() => {
        setLogEntries((prev) => [...prev, step]);
        scrollRef.current?.scrollToEnd({ animated: true });
        if (step.phase === "done" || step.phase === "reject") {
          setRunning(false);
        }
      }, step.ms);
      timersRef.current.push(t);
    });
  };

  const handlePause = () => {
    const next = !paused;
    setPaused(next);
    if (next) {
      clearTimers();
      setRunning(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => () => clearTimers(), []);

  const agentStatus = paused
    ? "Paused (human override)"
    : running
    ? "Running…"
    : logEntries.length > 0
    ? logEntries[logEntries.length - 1].phase === "done" ? "Matched" : "Idle"
    : "Idle";

  const statusColor = paused
    ? colors.warning
    : running
    ? colors.primaryLight
    : logEntries[logEntries.length - 1]?.phase === "done"
    ? colors.success
    : colors.textMuted;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Agent status</Text>
        <Text style={styles.hint}>
          AI agent (GPT-4o + Solana Agent Kit). Off-chain decisions, on-chain execution.
        </Text>

        {/* Status card */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>STATUS</Text>
            <Animated.View style={[styles.statusDot, { backgroundColor: statusColor, opacity: running ? pulseAnim : 1 }]} />
          </View>
          <Text style={[styles.statusValue, { color: statusColor }]}>{agentStatus}</Text>
          <View style={styles.capRow}>
            <Text style={styles.capItem}>Cap: $100 / loan</Text>
            <Text style={styles.capDivider}>·</Text>
            <Text style={styles.capItem}>Max: 10% pool exposure</Text>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.runBtn, (paused || running) && styles.runBtnDisabled]}
            onPress={handleRun}
            disabled={paused || running}
            activeOpacity={0.85}
          >
            <Text style={styles.runBtnText}>▶ Run agent</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.pauseBtn, paused && styles.pauseBtnActive]}
            onPress={handlePause}
            activeOpacity={0.85}
          >
            <Text style={[styles.pauseBtnText, paused && styles.pauseBtnTextActive]}>
              {paused ? "Resume" : "Pause"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Reasoning log */}
        {logEntries.length > 0 && (
          <View style={styles.logCard}>
            <Text style={styles.logTitle}>AGENT REASONING LOG</Text>
            {logEntries.map((entry, i) => (
              <View key={i} style={styles.logRow}>
                <Text style={[styles.logIcon, { color: PHASE_COLORS[entry.phase] }]}>
                  {entry.icon}
                </Text>
                <Text style={[styles.logText, { color: entry.phase === "done" ? colors.success : entry.phase === "reject" ? colors.error : colors.text }]}>
                  {entry.text}
                </Text>
              </View>
            ))}
            {running && (
              <View style={styles.logRow}>
                <Animated.Text style={[styles.logIcon, { color: colors.primaryLight, opacity: pulseAnim }]}>
                  ◌
                </Animated.Text>
                <Text style={styles.logCursor}>Thinking…</Text>
              </View>
            )}
          </View>
        )}

        <Text style={styles.footer}>
          Human override: pause the agent to halt new loan matches at any time.
          In production this runs continuously, 24/7.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  backBtn: { marginBottom: spacing.lg },
  backText: { color: colors.primaryLight, fontSize: 16, fontWeight: "600" },

  title: { ...typography.h1, color: colors.text, marginBottom: spacing.sm },
  hint: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xxl, lineHeight: 20 },

  // Status card
  statusCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  statusLabel: { ...typography.label, color: colors.textMuted },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusValue: { fontSize: 18, fontWeight: "700", marginBottom: spacing.md },
  capRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  capItem: { color: colors.textMuted, fontSize: 12 },
  capDivider: { color: colors.surfaceBorder, fontSize: 12 },

  // Controls
  controls: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.xl },
  runBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  runBtnDisabled: { opacity: 0.4 },
  runBtnText: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  pauseBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  pauseBtnActive: { backgroundColor: colors.warningMuted, borderColor: colors.warning },
  pauseBtnText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  pauseBtnTextActive: { color: colors.warning },

  // Reasoning log
  logCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  logTitle: { ...typography.label, color: colors.textMuted, marginBottom: spacing.lg },
  logRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.md, gap: spacing.md },
  logIcon: { fontSize: 14, marginTop: 1, width: 16 },
  logText: { flex: 1, fontSize: 13, lineHeight: 20, fontFamily: "monospace" },
  logCursor: { flex: 1, fontSize: 13, color: colors.textMuted, fontStyle: "italic" },

  footer: { color: colors.textMuted, fontSize: 12, lineHeight: 20, textAlign: "center" },
});
