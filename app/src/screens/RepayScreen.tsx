import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { useWalletContext } from "../context/WalletContext";
import { LoanData } from "../hooks/useLoans";
import { formatUsdc, formatDueDate, daysUntilDue } from "../utils/loanMath";
import {
  DEVNET_RPC,
  FLOAT_PROGRAM_ID,
  USDC_MINT,
  TREASURY_SEED,
} from "../utils/constants";
import { IDL } from "../idl/float";
import { colors, radius, typography, spacing } from "../theme/theme";

interface Props {
  navigation: any;
  route: { params: { loan: LoanData; mode?: "repay" | "withdraw" } };
}

export function RepayScreen({ navigation, route }: Props) {
  const { loan, mode = "repay" } = route.params;
  const { publicKey, signAndSend } = useWalletContext();
  const [submitting, setSubmitting] = useState(false);

  const isWithdraw = mode === "withdraw" || loan.status.toLowerCase() === "repaid";
  const days = daysUntilDue(loan.nextDueTimestamp);
  const remaining = loan.totalInstallments - loan.installmentsPaid;

  const handleRepay = async () => {
    if (!publicKey) return;
    setSubmitting(true);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      await signAndSend(async (walletPubkey) => {
        // Use the loan's existing PDA address (nonce is part of seeds, can't re-derive without it)
        const loanPda = loan.publicKey;
        const [treasuryPda] = PublicKey.findProgramAddressSync(
          [TREASURY_SEED],
          FLOAT_PROGRAM_ID
        );
        const borrowerLoanAta = await getAssociatedTokenAddress(USDC_MINT, walletPubkey);
        const treasuryLoanAta = await getAssociatedTokenAddress(USDC_MINT, treasuryPda, true);

        const provider = new anchor.AnchorProvider(
          connection,
          { publicKey: walletPubkey, signTransaction: async (t) => t, signAllTransactions: async (t) => t },
          { commitment: "confirmed" }
        );
        const program = new anchor.Program(IDL as unknown as anchor.Idl, FLOAT_PROGRAM_ID, provider);

        const tx = await program.methods
          .repayInstallment()
          .accounts({
            borrower: walletPubkey,
            loan: loanPda,
            borrowerLoanAta,
            treasuryLoanAta,
            loanMint: USDC_MINT,
            treasury: treasuryPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .transaction();

        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = walletPubkey;
        return tx;
      });

      Alert.alert(
        remaining === 1 ? "Loan Fully Repaid!" : "Payment Successful!",
        remaining === 1
          ? "All installments paid. You can now withdraw your collateral."
          : `${remaining - 1} payment(s) remaining.`,
        [{ text: "OK", onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    if (!publicKey) return;
    setSubmitting(true);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      await signAndSend(async (walletPubkey) => {
        const loanPda = loan.publicKey;
        const vaultCollateralAta = await getAssociatedTokenAddress(USDC_MINT, loanPda, true);
        const borrowerCollateralAta = await getAssociatedTokenAddress(USDC_MINT, walletPubkey);

        const provider = new anchor.AnchorProvider(
          connection,
          { publicKey: walletPubkey, signTransaction: async (t) => t, signAllTransactions: async (t) => t },
          { commitment: "confirmed" }
        );
        const program = new anchor.Program(IDL as unknown as anchor.Idl, FLOAT_PROGRAM_ID, provider);

        const tx = await program.methods
          .withdrawCollateral()
          .accounts({
            borrower: walletPubkey,
            loan: loanPda,
            vaultCollateralAta,
            borrowerCollateralAta,
            collateralMint: USDC_MINT,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .transaction();

        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = walletPubkey;
        return tx;
      });

      Alert.alert("Collateral Withdrawn!", "Your collateral has been returned.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  const Row = ({
    label,
    value,
    valueColor = colors.textSecondary,
  }: {
    label: string;
    value: string;
    valueColor?: string;
  }) => (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor }]}>{value}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{isWithdraw ? "Withdraw Collateral" : "Repay EMI"}</Text>

        <View style={styles.summaryCard}>
          <Row label="Loan Amount" value={`$${formatUsdc(loan.loanAmount)} USDC`} />
          <Row label="Collateral Locked" value={`${formatUsdc(loan.collateralAmount)}`} />
          <Row label="Progress" value={`${loan.installmentsPaid}/${loan.totalInstallments}`} />
          {!isWithdraw && (
            <>
              <Row
                label="Next Due"
                value={days === 0 ? "Today!" : `${days}d — ${formatDueDate(loan.nextDueTimestamp)}`}
                valueColor={days <= 3 ? colors.error : colors.textSecondary}
              />
              <View style={styles.highlightBox}>
                <Text style={styles.highlightLabel}>Amount Due Now</Text>
                <Text style={styles.highlightValue}>${formatUsdc(loan.installmentAmount)} USDC</Text>
              </View>
            </>
          )}
          {isWithdraw && (
            <View style={styles.highlightBox}>
              <Text style={styles.highlightLabel}>Collateral to Return</Text>
              <Text style={styles.highlightValue}>{formatUsdc(loan.collateralAmount)} USDC</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          onPress={isWithdraw ? handleWithdraw : handleRepay}
          disabled={submitting || !publicKey}
          activeOpacity={0.9}
          style={styles.actionBtnWrapper}
        >
          <LinearGradient
            colors={(submitting || !publicKey) ? ["#374151", "#374151"] : [colors.primary, colors.primaryDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.actionBtn, (submitting || !publicKey) && styles.actionBtnDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.actionBtnText}>
                {isWithdraw ? "Withdraw Collateral →" : `Pay $${formatUsdc(loan.installmentAmount)} →`}
              </Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>Transaction will be signed via your mobile wallet.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, paddingBottom: 72 },
  backBtn: { marginBottom: spacing.lg },
  backText: { color: colors.primaryLight, fontSize: 16, fontWeight: "600" },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.xxl },
  summaryCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.lg },
  rowLabel: { color: colors.textMuted, fontSize: 15 },
  rowValue: { fontSize: 15, fontWeight: "600" },
  highlightBox: {
    backgroundColor: colors.primaryMuted,
    borderRadius: radius.md,
    padding: spacing.xl,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.25)",
    alignItems: "center",
  },
  highlightLabel: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.sm },
  highlightValue: { color: colors.primary, fontSize: 28, fontWeight: "900" },
  actionBtnWrapper: { borderRadius: radius.lg, overflow: "hidden" },
  actionBtn: {
    paddingVertical: 20,
    borderRadius: radius.lg,
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { color: "#FFF", fontSize: 17, fontWeight: "800" },
  disclaimer: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
});
