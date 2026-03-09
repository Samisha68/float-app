import React, { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  TextInput,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { useWalletContext } from "../context/WalletContext";
import { useMicroPool } from "../hooks/useMicroPool";
import { IDL } from "../idl/float";
import {
  AGENT_CONFIG_SEED,
  DEVNET_RPC,
  FLOAT_PROGRAM_ID,
  MICRO_COLLATERAL_RATIO,
  MICRO_LOAN_MAX_USDC,
  MICRO_LOAN_SEED,
  MICRO_POOL_SEED,
  MICRO_TERM_DAYS_MAX,
  MICRO_TERM_DAYS_MIN,
  USDC_MINT,
} from "../utils/constants";
import { colors, radius, spacing, typography } from "../theme/theme";

interface Props {
  navigation: any;
}

type Phase = "scan" | "check" | "ai" | "exec" | "done" | "reject";
interface AgentLog {
  phase: Phase;
  text: string;
}

const PHASE_COLORS: Record<Phase, string> = {
  scan: colors.primaryLight,
  check: colors.warning,
  ai: colors.info,
  exec: colors.primary,
  done: colors.success,
  reject: colors.error,
};

function parseUsdcInput(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed * 1e6);
}

function computeRiskScore(ageDays: number, collateralOk: boolean, poolOk: boolean): number {
  let score = 0.2;
  if (ageDays < 7) score += 0.55;
  else if (ageDays < 30) score += 0.25;
  if (!collateralOk) score += 0.2;
  if (!poolOk) score += 0.1;
  return Math.min(1, Number(score.toFixed(2)));
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as Error & {
      logs?: string[];
      transactionLogs?: string[];
      transactionMessage?: string;
      cause?: unknown;
    };
    const logs = anyErr.logs ?? anyErr.transactionLogs;
    const cause =
      anyErr.cause instanceof Error ? anyErr.cause.message : anyErr.cause ? String(anyErr.cause) : "";
    return [
      anyErr.message,
      anyErr.transactionMessage ? `tx: ${anyErr.transactionMessage}` : "",
      logs?.length ? `logs: ${logs.join(" | ")}` : "",
      cause ? `cause: ${cause}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return String(err);
}

export function AgentStatusScreen({ navigation }: Props) {
  const { publicKey, signAndSend } = useWalletContext();
  const { refetch: refetchPool } = useMicroPool();

  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [amountText, setAmountText] = useState("10");
  const [termDays, setTermDays] = useState("3");
  const [nonceText, setNonceText] = useState(String(Date.now() % 1000000));

  const scrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pausedRef = useRef(false);

  const amountLamports = useMemo(() => parseUsdcInput(amountText), [amountText]);
  const amountUsdc = amountLamports / 1e6;
  const term = Number(termDays);
  const nonce = Number(nonceText);

  const pushLog = (phase: Phase, text: string) => {
    setLogs((prev) => [...prev, { phase, text }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 30);
  };

  React.useEffect(() => {
    if (running) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
      return;
    }
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  }, [running, pulseAnim]);

  const handlePause = () => {
    const next = !paused;
    pausedRef.current = next;
    setPaused(next);
    if (next && running) {
      pushLog("reject", "Paused by human override.");
      setRunning(false);
    }
  };

  const failWith = (message: string) => {
    pushLog("reject", message);
    setRunning(false);
  };

  const handleRun = async () => {
    if (!publicKey) {
      Alert.alert("Wallet required", "Connect wallet first.");
      return;
    }
    if (paused) return;
    if (!Number.isInteger(term) || term < MICRO_TERM_DAYS_MIN || term > MICRO_TERM_DAYS_MAX) {
      Alert.alert("Invalid term", `Term must be ${MICRO_TERM_DAYS_MIN}-${MICRO_TERM_DAYS_MAX} days.`);
      return;
    }
    if (!Number.isInteger(nonce) || nonce <= 0) {
      Alert.alert("Invalid nonce", "Nonce must be a positive integer.");
      return;
    }
    if (amountLamports <= 0 || amountLamports > MICRO_LOAN_MAX_USDC) {
      Alert.alert("Invalid amount", "Loan amount must be between 0 and 100 USDC.");
      return;
    }

    setLogs([]);
    setRunning(true);
    pausedRef.current = false;

    const connection = new Connection(DEVNET_RPC, "confirmed");
    const collateralLamports = Math.ceil(amountLamports * MICRO_COLLATERAL_RATIO);
    const collateralUsdc = collateralLamports / 1e6;

    try {
      pushLog("scan", "Scanning request in self-agent mode (agent = borrower).");
      pushLog("check", `Requested: ${amountUsdc.toFixed(2)} USDC / ${term} day(s), nonce=${nonce}`);

      if (pausedRef.current) return failWith("Execution paused before checks.");

      const [poolStatePda] = PublicKey.findProgramAddressSync([MICRO_POOL_SEED], FLOAT_PROGRAM_ID);
      const [agentConfigPda] = PublicKey.findProgramAddressSync([AGENT_CONFIG_SEED], FLOAT_PROGRAM_ID);
      const nonceBuf = Buffer.alloc(8);
      nonceBuf.writeBigUInt64LE(BigInt(nonce));
      const [microLoanPda] = PublicKey.findProgramAddressSync(
        [MICRO_LOAN_SEED, publicKey.toBuffer(), USDC_MINT.toBuffer(), nonceBuf],
        FLOAT_PROGRAM_ID
      );

      const poolLoanAta = await getAssociatedTokenAddress(USDC_MINT, poolStatePda, true);
      const borrowerCollateralAta = await getAssociatedTokenAddress(USDC_MINT, publicKey);
      const borrowerLoanAta = borrowerCollateralAta;
      const vaultCollateralAta = await getAssociatedTokenAddress(USDC_MINT, microLoanPda, true);

      const agentCfg = await connection.getAccountInfo(agentConfigPda);
      if (!agentCfg?.data || agentCfg.data.length < 8 + 32) {
        return failWith("Agent config not initialized on-chain.");
      }
      const authorizedAgent = new PublicKey(agentCfg.data.subarray(8, 40));
      if (!authorizedAgent.equals(publicKey)) {
        return failWith("Connected wallet is not the authorized agent in agent_config.");
      }
      pushLog("check", "Authorized agent check passed.");

      if (pausedRef.current) return failWith("Execution paused before risk checks.");

      const signatures = await connection.getSignaturesForAddress(publicKey, { limit: 1000 });
      const oldestBlockTime = signatures.length > 0 ? signatures[signatures.length - 1].blockTime ?? null : null;
      const ageDays = oldestBlockTime
        ? Math.floor((Date.now() / 1000 - oldestBlockTime) / 86400)
        : 0;
      pushLog("check", `Wallet age: ${ageDays} day(s).`);

      let borrowerBalanceLamports = 0;
      try {
        const bal = await connection.getTokenAccountBalance(borrowerCollateralAta);
        borrowerBalanceLamports = Number(bal.value.amount);
      } catch {
        borrowerBalanceLamports = 0;
      }
      const borrowerBalanceUsdc = borrowerBalanceLamports / 1e6;
      pushLog("check", `Borrower USDC: ${borrowerBalanceUsdc.toFixed(2)} (need ${collateralUsdc.toFixed(2)}).`);

      let poolBalanceLamports = 0;
      try {
        const bal = await connection.getTokenAccountBalance(poolLoanAta);
        poolBalanceLamports = Number(bal.value.amount);
      } catch {
        poolBalanceLamports = 0;
      }
      const poolBalanceUsdc = poolBalanceLamports / 1e6;
      pushLog("check", `Pool USDC: ${poolBalanceUsdc.toFixed(2)} (need ${amountUsdc.toFixed(2)}).`);

      const collateralOk = borrowerBalanceLamports >= collateralLamports;
      const poolOk = poolBalanceLamports >= amountLamports;
      const ageOk = ageDays >= 7;
      const riskScore = computeRiskScore(ageDays, collateralOk, poolOk);

      if (!ageOk || !collateralOk || !poolOk) {
        const reasons: string[] = [];
        if (!ageOk) reasons.push("wallet age < 7 days");
        if (!collateralOk) reasons.push("insufficient collateral balance");
        if (!poolOk) reasons.push("insufficient pool liquidity");
        return failWith(`AI rejected (${riskScore.toFixed(2)}): ${reasons.join(", ")}.`);
      }

      pushLog("ai", `AI approved (${riskScore.toFixed(2)}): risk checks passed.`);
      if (pausedRef.current) return failWith("Execution paused before transaction.");

      pushLog("exec", "Submitting agent_match_loan transaction...");
      const result = await signAndSend(async (walletPubkey) => {
        const program = new anchor.Program(
          IDL as unknown as anchor.Idl,
          FLOAT_PROGRAM_ID,
          new anchor.AnchorProvider(
            connection,
            { publicKey: walletPubkey, signTransaction: async (t) => t, signAllTransactions: async (t) => t },
            { commitment: "confirmed" }
          )
        );
        return program.methods
          .agentMatchLoan(new anchor.BN(amountLamports), term, new anchor.BN(nonce))
          .accounts({
            agent: walletPubkey,
            agentConfig: agentConfigPda,
            borrower: walletPubkey,
            microLoan: microLoanPda,
            poolState: poolStatePda,
            poolLoanAta,
            borrowerCollateralAta,
            borrowerLoanAta,
            vaultCollateralAta,
            collateralMint: USDC_MINT,
            loanMint: USDC_MINT,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .transaction();
      });

      pushLog("done", `Loan matched on-chain. Tx: ${result.signature.slice(0, 8)}...`);
      setNonceText(String((Date.now() + Math.floor(Math.random() * 1000)) % 1000000));
      refetchPool();
      setRunning(false);
    } catch (e: unknown) {
      const message = extractErrorMessage(e);
      console.error("[AgentStatus] Execution failed:\n", message, "\nRaw:", e);
      failWith(`Execution failed: ${message}`);
    }
  };

  const latestPhase = logs[logs.length - 1]?.phase;
  const statusText = paused
    ? "Paused (human override)"
    : running
    ? "Running..."
    : latestPhase === "done"
    ? "Matched"
    : latestPhase === "reject"
    ? "Rejected"
    : "Idle";

  const statusColor = paused
    ? colors.warning
    : running
    ? colors.primaryLight
    : latestPhase === "done"
    ? colors.success
    : latestPhase === "reject"
    ? colors.error
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
          Real execution mode. This runs risk checks and submits `agentMatchLoan` on-chain.
        </Text>

        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>STATUS</Text>
            <Animated.View style={[styles.statusDot, { backgroundColor: statusColor, opacity: running ? pulseAnim : 1 }]} />
          </View>
          <Text style={[styles.statusValue, { color: statusColor }]}>{statusText}</Text>
          <View style={styles.capRow}>
            <Text style={styles.capItem}>Cap: $100 / loan</Text>
            <Text style={styles.capDivider}>·</Text>
            <Text style={styles.capItem}>Self-agent mode</Text>
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formLabel}>Loan amount (USDC)</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder="10"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            style={styles.input}
          />
          <Text style={styles.formLabel}>Term (days, 1-7)</Text>
          <TextInput
            value={termDays}
            onChangeText={setTermDays}
            placeholder="3"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            style={styles.input}
          />
          <Text style={styles.formLabel}>Nonce</Text>
          <TextInput
            value={nonceText}
            onChangeText={setNonceText}
            placeholder="1"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            style={styles.input}
          />
        </View>

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

        {logs.length > 0 && (
          <View style={styles.logCard}>
            <Text style={styles.logTitle}>AGENT LOG</Text>
            {logs.map((entry, index) => (
              <View key={`${entry.phase}-${index}`} style={styles.logRow}>
                <Text style={[styles.logIcon, { color: PHASE_COLORS[entry.phase] }]}>●</Text>
                <Text style={styles.logText}>{entry.text}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          Requires wallet to be the authorized on-chain agent. If not, initialize agent config with this wallet first.
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
  hint: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xl, lineHeight: 20 },
  statusCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
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
  formCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  formLabel: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm, textTransform: "uppercase" },
  input: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    marginBottom: spacing.md,
  },
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
  logCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  logTitle: { ...typography.label, color: colors.textMuted, marginBottom: spacing.md },
  logRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.sm },
  logIcon: { width: 16, fontSize: 12, marginTop: 2 },
  logText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },
  footer: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.lg,
  },
});
