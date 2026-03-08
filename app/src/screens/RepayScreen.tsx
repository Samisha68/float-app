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
  LOAN_SEED,
  TREASURY_SEED,
} from "../utils/constants";
import { IDL } from "../idl/float";

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
        const [loanPda] = PublicKey.findProgramAddressSync(
          [LOAN_SEED, walletPubkey.toBuffer(), USDC_MINT.toBuffer()],
          FLOAT_PROGRAM_ID
        );
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
        const [loanPda] = PublicKey.findProgramAddressSync(
          [LOAN_SEED, walletPubkey.toBuffer(), USDC_MINT.toBuffer()],
          FLOAT_PROGRAM_ID
        );
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{isWithdraw ? "Withdraw Collateral" : "Repay EMI"}</Text>

        {/* Loan summary */}
        <View style={styles.summaryCard}>
          <Row label="Loan Amount" value={`$${formatUsdc(loan.loanAmount)} USDC`} />
          <Row label="Collateral Locked" value={`${formatUsdc(loan.collateralAmount)}`} />
          <Row label="Progress" value={`${loan.installmentsPaid}/${loan.totalInstallments}`} />
          {!isWithdraw && (
            <>
              <Row
                label="Next Due"
                value={days === 0 ? "Today!" : `${days}d — ${formatDueDate(loan.nextDueTimestamp)}`}
                valueColor={days <= 3 ? "#F87171" : "#94A3B8"}
              />
              <View style={styles.highlightBox}>
                <Text style={styles.highlightLabel}>Amount Due Now</Text>
                <Text style={styles.highlightValue}>
                  ${formatUsdc(loan.installmentAmount)} USDC
                </Text>
              </View>
            </>
          )}
          {isWithdraw && (
            <View style={styles.highlightBox}>
              <Text style={styles.highlightLabel}>Collateral to Return</Text>
              <Text style={styles.highlightValue}>
                {formatUsdc(loan.collateralAmount)} USDC
              </Text>
            </View>
          )}
        </View>

        {/* Action button */}
        <TouchableOpacity
          style={[styles.actionBtn, submitting && styles.actionBtnDisabled]}
          onPress={isWithdraw ? handleWithdraw : handleRepay}
          disabled={submitting || !publicKey}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.actionBtnText}>
              {isWithdraw ? "Withdraw Collateral →" : `Pay $${formatUsdc(loan.installmentAmount)} →`}
            </Text>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Transaction will be signed via your mobile wallet.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  valueColor = "#94A3B8",
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={[rowStyles.value, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  label: { color: "#64748B", fontSize: 14 },
  value: { fontSize: 14, fontWeight: "600" },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  scroll: { padding: 20, paddingBottom: 60 },
  backBtn: { marginBottom: 16 },
  backText: { color: "#6366F1", fontSize: 15, fontWeight: "600" },
  title: { fontSize: 32, fontWeight: "900", color: "#F1F5F9", marginBottom: 24 },
  summaryCard: {
    backgroundColor: "#13131A",
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#1E1E2E",
  },
  highlightBox: {
    backgroundColor: "#6366F111",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#6366F133",
    alignItems: "center",
  },
  highlightLabel: { color: "#94A3B8", fontSize: 13, marginBottom: 6 },
  highlightValue: { color: "#6366F1", fontSize: 28, fontWeight: "900" },
  actionBtn: {
    backgroundColor: "#6366F1",
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 16,
  },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { color: "#FFF", fontSize: 16, fontWeight: "800" },
  disclaimer: { color: "#334155", fontSize: 12, textAlign: "center" },
});
