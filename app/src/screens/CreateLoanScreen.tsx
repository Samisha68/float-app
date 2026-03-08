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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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

interface Props {
  navigation: any;
}

export function CreateLoanScreen({ navigation }: Props) {
  const { publicKey, signAndSend } = useWalletContext();
  const [loanAmount, setLoanAmount] = useState("");
  const [selectedTerm, setSelectedTerm] = useState<InstallmentOption>(6);
  const [submitting, setSubmitting] = useState(false);

  // Derived values
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

      // Scale to 6-decimal lamports
      const loanLamports = new anchor.BN(Math.floor(loanAmountNum * 1e6));
      const collateralLamports = new anchor.BN(Math.floor(collateralRequired * 1e6));
      const installments = selectedTerm;
      const annualRateBps = new anchor.BN(DEFAULT_APR_BPS);

      await signAndSend(async (walletPubkey) => {
        // Derive PDAs using confirmed pubkey from reauth
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

        // 1. Create vault collateral ATA (owner = loan PDA) — idempotent: no-op if it exists
        const createVaultAtaIx = createAssociatedTokenAccountIdempotentInstruction(
          walletPubkey,        // payer
          vaultCollateralAta,  // ATA address
          loanPda,             // owner (loan PDA)
          USDC_MINT,           // mint
        );

        // 2. Build the initializeLoan instruction
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

        // 3. Combine: create vault ATA first, then initialize loan
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
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>New Loan</Text>
        <Text style={styles.subtitle}>Lock collateral · Receive USDC · Repay in EMIs</Text>

        {/* Loan amount input */}
        <Text style={styles.inputLabel}>Loan Amount (USDC)</Text>
        <TextInput
          style={styles.input}
          value={loanAmount}
          onChangeText={setLoanAmount}
          keyboardType="decimal-pad"
          placeholder="100"
          placeholderTextColor="#334155"
        />

        {/* Collateral required */}
        {loanAmountNum > 0 && (
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Collateral Required (150% LTV)</Text>
            <Text style={styles.infoValue}>{collateralRequired.toFixed(2)} USDC</Text>
          </View>
        )}

        {/* Term selector */}
        <Text style={styles.inputLabel}>Loan Term</Text>
        <View style={styles.termRow}>
          {INSTALLMENT_OPTIONS.map((term) => (
            <TouchableOpacity
              key={term}
              style={[styles.termBtn, selectedTerm === term && styles.termBtnActive]}
              onPress={() => setSelectedTerm(term)}
            >
              <Text
                style={[styles.termText, selectedTerm === term && styles.termTextActive]}
              >
                {term}mo
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* EMI preview */}
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
              Collateral is returned after all {selectedTerm} payments.
              Miss 7+ days → liquidation risk.
            </Text>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, (!isValid || submitting) && styles.submitBtnDisabled]}
          onPress={handleCreateLoan}
          disabled={!isValid || submitting || !publicKey}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.submitBtnText}>Confirm Loan →</Text>
          )}
        </TouchableOpacity>

        {!publicKey && (
          <Text style={styles.walletWarning}>Connect your wallet first.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  scroll: { padding: 20, paddingBottom: 60 },
  backBtn: { marginBottom: 16 },
  backText: { color: "#6366F1", fontSize: 15, fontWeight: "600" },
  title: { fontSize: 32, fontWeight: "900", color: "#F1F5F9", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#64748B", marginBottom: 28, lineHeight: 20 },
  inputLabel: { color: "#94A3B8", fontSize: 13, fontWeight: "600", marginBottom: 8, letterSpacing: 0.5 },
  input: {
    backgroundColor: "#13131A",
    borderWidth: 1,
    borderColor: "#1E1E2E",
    borderRadius: 12,
    color: "#F1F5F9",
    fontSize: 20,
    fontWeight: "700",
    padding: 16,
    marginBottom: 16,
  },
  infoBox: {
    backgroundColor: "#13131A",
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#6366F122",
  },
  infoLabel: { color: "#64748B", fontSize: 13 },
  infoValue: { color: "#A5B4FC", fontSize: 16, fontWeight: "700" },
  termRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  termBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#13131A",
    borderWidth: 1,
    borderColor: "#1E1E2E",
  },
  termBtnActive: { backgroundColor: "#6366F1", borderColor: "#6366F1" },
  termText: { color: "#64748B", fontSize: 15, fontWeight: "700" },
  termTextActive: { color: "#FFF" },
  emiCard: {
    backgroundColor: "#13131A",
    borderRadius: 16,
    padding: 20,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: "#1E1E2E",
  },
  emiCardTitle: { color: "#94A3B8", fontSize: 13, fontWeight: "600", letterSpacing: 0.5, marginBottom: 16 },
  emiRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  emiLabel: { color: "#64748B", fontSize: 14 },
  emiAmount: { color: "#6366F1", fontSize: 22, fontWeight: "900" },
  emiSecondary: { color: "#94A3B8", fontSize: 14, fontWeight: "600" },
  divider: { height: 1, backgroundColor: "#1E1E2E", marginVertical: 12 },
  emiNote: { color: "#475569", fontSize: 12, lineHeight: 18 },
  submitBtn: {
    backgroundColor: "#6366F1",
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: "#FFF", fontSize: 16, fontWeight: "800" },
  walletWarning: { color: "#F87171", fontSize: 13, textAlign: "center", marginTop: 12 },
});
