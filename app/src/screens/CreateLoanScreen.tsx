import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { useWalletContext } from "../context/WalletContext";
import { calculateEMI, minCollateral } from "../utils/loanMath";
import {
  DEVNET_RPC,
  FLOAT_PROGRAM_ID,
  USDC_MINT,
  LOAN_SEED,
  TREASURY_SEED,
  INSTALLMENT_OPTIONS,
  DEFAULT_APR_BPS,
  type InstallmentOption,
} from "../utils/constants";
import { IDL } from "../idl/float";
import { colors, radius, typography, spacing } from "../theme/theme";

interface Props {
  navigation: any;
}

export function CreateLoanScreen({ navigation }: Props) {
  const { publicKey, signAndSend } = useWalletContext();
  const [loanAmount, setLoanAmount] = useState("");
  const [selectedTerm, setSelectedTerm] = useState<InstallmentOption>(6);
  const [submitting, setSubmitting] = useState(false);

  const loanAmountNum = parseFloat(loanAmount) || 0;
  const collateralRequired = minCollateral(loanAmountNum);
  const { emi, totalInterest, totalRepayable } = useMemo(
    () => calculateEMI(loanAmountNum, selectedTerm, DEFAULT_APR_BPS),
    [loanAmountNum, selectedTerm]
  );

  const isValid = loanAmountNum > 0;

  const handleCreateLoan = async () => {
    if (!publicKey || !isValid) return;
    setSubmitting(true);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const loanLamports = new anchor.BN(Math.floor(loanAmountNum * 1e6));
      const collateralLamports = new anchor.BN(Math.floor(collateralRequired * 1e6));
      const installments = selectedTerm;
      const annualRateBps = new anchor.BN(DEFAULT_APR_BPS);

      await signAndSend(async (walletPubkey) => {
        const [loanPda] = PublicKey.findProgramAddressSync(
          [LOAN_SEED, walletPubkey.toBuffer(), USDC_MINT.toBuffer()],
          FLOAT_PROGRAM_ID
        );
        const [treasuryPda] = PublicKey.findProgramAddressSync(
          [TREASURY_SEED],
          FLOAT_PROGRAM_ID
        );
        const borrowerCollateralAta = await getAssociatedTokenAddress(USDC_MINT, walletPubkey);
        const borrowerLoanAta = await getAssociatedTokenAddress(USDC_MINT, walletPubkey);
        const treasuryLoanAta = await getAssociatedTokenAddress(USDC_MINT, treasuryPda, true);
        const vaultCollateralAta = await getAssociatedTokenAddress(USDC_MINT, loanPda, true);

        const provider = new anchor.AnchorProvider(
          connection,
          { publicKey: walletPubkey, signTransaction: async (t) => t, signAllTransactions: async (t) => t },
          { commitment: "confirmed" }
        );
        const program = new anchor.Program(IDL as unknown as anchor.Idl, FLOAT_PROGRAM_ID, provider);

        const createVaultAtaIx = createAssociatedTokenAccountIdempotentInstruction(
          walletPubkey,
          vaultCollateralAta,
          loanPda,
          USDC_MINT,
        );

        const initLoanTx = await program.methods
          .initializeLoan(collateralLamports, loanLamports, installments, annualRateBps)
          .accounts({
            borrower: walletPubkey,
            loan: loanPda,
            collateralMint: USDC_MINT,
            loanMint: USDC_MINT,
            borrowerCollateralAta,
            borrowerLoanAta,
            vaultCollateralAta,
            treasury: treasuryPda,
            treasuryLoanAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .transaction();

        const tx = new Transaction();
        tx.add(createVaultAtaIx);
        tx.add(...initLoanTx.instructions);

        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = walletPubkey;
        return tx;
      });

      Alert.alert("Loan Created!", "Your USDC has been disbursed. Check your wallet.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>New Loan</Text>
        <Text style={styles.subtitle}>Lock collateral · Receive USDC · Repay in EMIs</Text>

        <Text style={styles.inputLabel}>Loan Amount (USDC)</Text>
        <TextInput
          style={styles.input}
          value={loanAmount}
          onChangeText={setLoanAmount}
          keyboardType="decimal-pad"
          placeholder="100"
          placeholderTextColor={colors.textMuted}
        />

        {loanAmountNum > 0 && (
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Collateral Required (150% LTV)</Text>
            <Text style={styles.infoValue}>{collateralRequired.toFixed(2)} USDC</Text>
          </View>
        )}

        <Text style={styles.inputLabel}>Loan Term</Text>
        <View style={styles.termRow}>
          {INSTALLMENT_OPTIONS.map((term) => (
            <TouchableOpacity
              key={term}
              style={[styles.termBtn, selectedTerm === term && styles.termBtnActive]}
              onPress={() => setSelectedTerm(term)}
              activeOpacity={0.8}
            >
              <Text style={[styles.termText, selectedTerm === term && styles.termTextActive]}>
                {term}mo
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loanAmountNum > 0 && (
          <View style={styles.emiCard}>
            <Text style={styles.emiCardTitle}>Repayment Summary</Text>
            <View style={styles.emiRow}>
              <Text style={styles.emiLabel}>Monthly EMI</Text>
              <Text style={styles.emiAmount}>${emi.toFixed(2)}</Text>
            </View>
            <View style={styles.emiRow}>
              <Text style={styles.emiLabel}>Interest (12% APR)</Text>
              <Text style={styles.emiSecondary}>${totalInterest.toFixed(2)}</Text>
            </View>
            <View style={styles.emiRow}>
              <Text style={styles.emiLabel}>Total Repayable</Text>
              <Text style={styles.emiSecondary}>${totalRepayable.toFixed(2)}</Text>
            </View>
            <View style={styles.divider} />
            <Text style={styles.emiNote}>
              Collateral is returned after all {selectedTerm} payments. Miss 7+ days → liquidation risk.
            </Text>
          </View>
        )}

        <TouchableOpacity
          onPress={handleCreateLoan}
          disabled={!isValid || submitting || !publicKey}
          activeOpacity={0.9}
          style={styles.submitBtnWrapper}
        >
          <LinearGradient
            colors={(!isValid || submitting) ? ["#374151", "#374151"] : [colors.primary, colors.primaryDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.submitBtn, (!isValid || submitting) && styles.submitBtnDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.submitBtnText}>Confirm Loan →</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {!publicKey && (
          <Text style={styles.walletWarning}>Connect your wallet first.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, paddingBottom: 72 },
  backBtn: { marginBottom: spacing.lg },
  backText: { color: colors.primaryLight, fontSize: 16, fontWeight: "600" },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.sm },
  subtitle: { color: colors.textMuted, fontSize: 15, marginBottom: spacing.xxl, lineHeight: 22 },
  inputLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  infoBox: {
    backgroundColor: colors.primaryMuted,
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.25)",
  },
  infoLabel: { color: colors.textMuted, fontSize: 14 },
  infoValue: { color: colors.primaryLight, fontSize: 17, fontWeight: "700" },
  termRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.xxl },
  termBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: "center",
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  termBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  termText: { color: colors.textMuted, fontSize: 16, fontWeight: "700" },
  termTextActive: { color: "#FFF" },
  emiCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  emiCardTitle: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.lg },
  emiRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.md },
  emiLabel: { color: colors.textMuted, fontSize: 15 },
  emiAmount: { color: colors.primary, fontSize: 24, fontWeight: "900" },
  emiSecondary: { color: colors.textSecondary, fontSize: 15, fontWeight: "600" },
  divider: { height: 1, backgroundColor: colors.surfaceBorder, marginVertical: spacing.lg },
  emiNote: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  submitBtnWrapper: { borderRadius: radius.lg, overflow: "hidden" },
  submitBtn: {
    paddingVertical: 20,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: "#FFF", fontSize: 17, fontWeight: "800" },
  walletWarning: { color: colors.error, fontSize: 14, textAlign: "center", marginTop: spacing.lg },
});
