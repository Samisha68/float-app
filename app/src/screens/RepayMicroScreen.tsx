import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { useWalletContext } from "../context/WalletContext";
import { useMicroPool } from "../hooks/useMicroPool";
import {
  DEVNET_RPC,
  FLOAT_PROGRAM_ID,
  USDC_MINT,
  MICRO_POOL_SEED,
} from "../utils/constants";
import { formatUsdc } from "../utils/loanMath";
import type { MicroLoanData } from "../hooks/useMicroLoans";
import { IDL } from "../idl/float";
import { colors, radius, typography, spacing } from "../theme/theme";

interface Props {
  navigation: any;
  route: { params: { loan: MicroLoanData } };
}

type Step = "repay" | "withdraw" | "done";

function initialStep(status: string): Step {
  if (status === "Repaid") return "withdraw";
  if (status === "CollateralWithdrawn") return "done";
  return "repay";
}

export function RepayMicroScreen({ navigation, route }: Props) {
  const { loan } = route.params;
  const { publicKey, signAndSend } = useWalletContext();
  const { refetch } = useMicroPool();
  const [step, setStep] = useState<Step>(initialStep(loan.status));
  const [submitting, setSubmitting] = useState(false);

  // ── Step 1: Repay the loan ────────────────────────────────────────────────
  const handleRepay = async () => {
    if (!publicKey) return;
    setSubmitting(true);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const [poolStatePda] = PublicKey.findProgramAddressSync(
        [MICRO_POOL_SEED],
        FLOAT_PROGRAM_ID
      );
      const poolLoanAta = await getAssociatedTokenAddress(USDC_MINT, poolStatePda, true);
      const borrowerLoanAta = await getAssociatedTokenAddress(USDC_MINT, publicKey);

      await signAndSend(async (walletPubkey) => {
        const program = new anchor.Program(
          IDL as unknown as anchor.Idl,
          FLOAT_PROGRAM_ID,
          new anchor.AnchorProvider(
            connection,
            { publicKey: walletPubkey, signTransaction: async (t) => t, signAllTransactions: async (t) => t },
            { commitment: "confirmed" }
          )
        );
        return await program.methods
          .repayMicroLoan()
          .accounts({
            borrower: walletPubkey,
            microLoan: loan.publicKey,
            borrowerLoanAta,
            poolLoanAta,
            poolState: poolStatePda,
            loanMint: USDC_MINT,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .transaction();
      });
      setStep("withdraw");
    } catch (e: any) {
      Alert.alert("Repay failed", e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 2: Withdraw collateral from vault ────────────────────────────────
  const handleWithdraw = async () => {
    if (!publicKey) return;
    setSubmitting(true);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const [poolStatePda] = PublicKey.findProgramAddressSync(
        [MICRO_POOL_SEED],
        FLOAT_PROGRAM_ID
      );
      // Vault ATA is owned by the micro_loan PDA (allowOwnerOffCurve = true)
      const vaultCollateralAta = await getAssociatedTokenAddress(
        USDC_MINT,
        loan.publicKey,
        true
      );
      const borrowerCollateralAta = await getAssociatedTokenAddress(USDC_MINT, publicKey);

      await signAndSend(async (walletPubkey) => {
        const program = new anchor.Program(
          IDL as unknown as anchor.Idl,
          FLOAT_PROGRAM_ID,
          new anchor.AnchorProvider(
            connection,
            { publicKey: walletPubkey, signTransaction: async (t) => t, signAllTransactions: async (t) => t },
            { commitment: "confirmed" }
          )
        );
        return await program.methods
          .withdrawCollateralMicro()
          .accounts({
            borrower: walletPubkey,
            microLoan: loan.publicKey,
            vaultCollateralAta,
            borrowerCollateralAta,
            poolState: poolStatePda,
            collateralMint: USDC_MINT,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .transaction();
      });
      refetch();
      setStep("done");
    } catch (e: any) {
      Alert.alert("Withdraw failed", e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Done screen ───────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.doneContainer}>
          <Text style={styles.doneIcon}>✓</Text>
          <Text style={styles.doneTitle}>All done!</Text>
          <Text style={styles.doneSubtitle}>
            Loan repaid & collateral returned to your wallet.
          </Text>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
          >
            <Text style={styles.doneBtnText}>Back to dashboard</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.inner}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        {/* 2-step progress indicator */}
        <View style={styles.steps}>
          <View style={[styles.stepDot, step === "repay" && styles.stepDotActive]} />
          <View style={[styles.stepLine, step === "withdraw" && styles.stepLineDone]} />
          <View style={[styles.stepDot, step === "withdraw" && styles.stepDotActive]} />
        </View>

        {step === "repay" ? (
          <>
            <Text style={styles.title}>Repay micro-loan</Text>
            <Text style={styles.amount}>${formatUsdc(Number(loan.totalRepay))} USDC</Text>
            <Text style={styles.sub}>Step 1 of 2 — repay principal + interest</Text>

            <TouchableOpacity
              style={[styles.btnWrapper, submitting && styles.btnDisabled]}
              onPress={handleRepay}
              disabled={submitting}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={submitting ? ["#374151", "#374151"] : [colors.primary, colors.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.btn}
              >
                {submitting
                  ? <ActivityIndicator color="#FFF" />
                  : <Text style={styles.btnText}>Repay now</Text>
                }
              </LinearGradient>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Withdraw collateral</Text>
            <Text style={styles.amount}>${formatUsdc(Number(loan.collateralAmount))} USDC</Text>
            <Text style={styles.sub}>Step 2 of 2 — reclaim your collateral from vault</Text>

            <TouchableOpacity
              style={[styles.btnWrapper, submitting && styles.btnDisabled]}
              onPress={handleWithdraw}
              disabled={submitting}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={submitting ? ["#374151", "#374151"] : [colors.primary, colors.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.btn}
              >
                {submitting
                  ? <ActivityIndicator color="#FFF" />
                  : <Text style={styles.btnText}>Withdraw collateral</Text>
                }
              </LinearGradient>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.xl },

  // Back button
  backBtn: { marginBottom: spacing.lg },
  backText: { color: colors.primaryLight, fontSize: 16, fontWeight: "600" },

  // Step indicator
  steps: { flexDirection: "row", alignItems: "center", marginBottom: spacing.xxl },
  stepDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 2, borderColor: colors.surfaceBorder,
  },
  stepDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.surfaceBorder, marginHorizontal: spacing.sm },
  stepLineDone: { backgroundColor: colors.primary },

  // Content
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.sm },
  amount: { color: colors.primaryLight, fontSize: 28, fontWeight: "800", marginBottom: spacing.sm },
  sub: { color: colors.textMuted, fontSize: 14, marginBottom: spacing.xxl },

  // Button
  btnWrapper: { borderRadius: radius.lg, overflow: "hidden" },
  btnDisabled: { opacity: 0.6 },
  btn: { paddingVertical: 18, borderRadius: radius.lg, alignItems: "center" },
  btnText: { color: "#FFF", fontSize: 17, fontWeight: "700" },
  cancelBtn: { marginTop: spacing.lg, alignItems: "center" },
  cancelText: { color: colors.textMuted, fontSize: 15 },

  // Done screen
  doneContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
  },
  doneIcon: { fontSize: 72, color: colors.success, marginBottom: spacing.lg },
  doneTitle: { ...typography.h1, color: colors.text, marginBottom: spacing.sm },
  doneSubtitle: {
    color: colors.textMuted, fontSize: 16,
    textAlign: "center", marginBottom: spacing.xxl,
    lineHeight: 24,
  },
  doneBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16, paddingHorizontal: spacing.xxl,
    borderRadius: radius.lg,
  },
  doneBtnText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
});
