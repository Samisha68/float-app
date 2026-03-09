import React, { useCallback, useEffect, useMemo, useState } from "react";
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

interface CollateralToken {
  mint: PublicKey;
  mintStr: string;
  symbol: string;
  balanceUi: number;
  balanceRaw: bigint;
  decimals: number;
  priceUsd: number | null;
}

const KNOWN_SYMBOLS: Record<string, string> = {
  "So11111111111111111111111111111111111111112": "SOL",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6J6V5x5kNnCf7fE": "BONK",
};

function shortMint(mint: string) {
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function symbolForMint(mint: string): string {
  if (mint === USDC_MINT.toBase58()) return "USDC";
  return KNOWN_SYMBOLS[mint] ?? shortMint(mint);
}

async function fetchTokenPriceUsd(mint: string): Promise<number | null> {
  try {
    if (mint === USDC_MINT.toBase58()) return 1;
    const res = await fetch(`https://price.jup.ag/v6/price?ids=${mint}`);
    if (!res.ok) return null;
    const json = await res.json();
    const price = json?.data?.[mint]?.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
    return price;
  } catch {
    return null;
  }
}

export function CreateLoanScreen({ navigation }: Props) {
  const { publicKey, signAndSend } = useWalletContext();
  const [loanAmount, setLoanAmount] = useState("");
  const [selectedTerm, setSelectedTerm] = useState<InstallmentOption>(6);
  const [submitting, setSubmitting] = useState(false);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [collateralTokens, setCollateralTokens] = useState<CollateralToken[]>([]);
  const [selectedCollateralMint, setSelectedCollateralMint] = useState<string | null>(null);

  const loanAmountNum = parseFloat(loanAmount) || 0;
  const requiredCollateralUsd = minCollateral(loanAmountNum);
  const { emi, totalInterest, totalRepayable } = useMemo(
    () => calculateEMI(loanAmountNum, selectedTerm, DEFAULT_APR_BPS),
    [loanAmountNum, selectedTerm]
  );
  const isValid = loanAmountNum > 0;

  const selectedCollateral = useMemo(
    () =>
      collateralTokens.find((t) => t.mintStr === selectedCollateralMint) ??
      collateralTokens[0] ??
      null,
    [collateralTokens, selectedCollateralMint]
  );

  const collateralRequiredTokenUi = useMemo(() => {
    if (!selectedCollateral) return 0;
    if (selectedCollateral.priceUsd && selectedCollateral.priceUsd > 0) {
      return requiredCollateralUsd / selectedCollateral.priceUsd;
    }
    // Fallback if no price is available.
    return requiredCollateralUsd;
  }, [requiredCollateralUsd, selectedCollateral]);

  const collateralRequiredLamports = useMemo(() => {
    if (!selectedCollateral) return 0;
    const raw = Math.ceil(collateralRequiredTokenUi * 10 ** selectedCollateral.decimals);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw;
  }, [collateralRequiredTokenUi, selectedCollateral]);

  const fetchWalletTokens = useCallback(async () => {
    if (!publicKey) {
      setCollateralTokens([]);
      setSelectedCollateralMint(null);
      return;
    }

    setTokensLoading(true);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const parsedAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID,
      });

      const tokens: CollateralToken[] = [];
      const usdcMintStr = USDC_MINT.toBase58();
      for (const { account } of parsedAccounts.value) {
        const info = account.data.parsed?.info;
        if (!info?.mint || !info?.tokenAmount?.amount) continue;

        const mintStr = String(info.mint);
        // Only show the app's USDC mint as collateral (both sides use USDC on devnet)
        if (mintStr !== usdcMintStr) continue;
        const rawAmount = BigInt(String(info.tokenAmount.amount));
        if (rawAmount <= 0) continue;

        const uiAmount = Number(info.tokenAmount.uiAmount ?? info.tokenAmount.uiAmountString ?? 0);
        const decimals = Number(info.tokenAmount.decimals ?? 0);

        tokens.push({
          mint: new PublicKey(mintStr),
          mintStr,
          symbol: symbolForMint(mintStr),
          balanceUi: Number.isFinite(uiAmount) ? uiAmount : 0,
          balanceRaw: rawAmount,
          decimals,
          priceUsd: null,
        });
      }

      const withPrices = await Promise.all(
        tokens.map(async (token) => ({
          ...token,
          priceUsd: await fetchTokenPriceUsd(token.mintStr),
        }))
      );

      withPrices.sort((a, b) => {
        const aUsd = (a.priceUsd ?? 1) * a.balanceUi;
        const bUsd = (b.priceUsd ?? 1) * b.balanceUi;
        return bUsd - aUsd;
      });

      setCollateralTokens(withPrices);
      if (!selectedCollateralMint && withPrices.length > 0) {
        setSelectedCollateralMint(withPrices[0].mintStr);
      } else if (
        selectedCollateralMint &&
        !withPrices.some((token) => token.mintStr === selectedCollateralMint)
      ) {
        setSelectedCollateralMint(withPrices[0]?.mintStr ?? null);
      }
    } catch {
      setCollateralTokens([]);
      setSelectedCollateralMint(null);
    } finally {
      setTokensLoading(false);
    }
  }, [publicKey, selectedCollateralMint]);

  useEffect(() => {
    fetchWalletTokens();
  }, [fetchWalletTokens]);

  const handleCreateLoan = async () => {
    if (!publicKey || !isValid) return;
    if (!selectedCollateral) {
      Alert.alert("Select collateral", "Pick a token from your wallet to use as collateral.");
      return;
    }
    if (collateralRequiredLamports <= 0) {
      Alert.alert("Invalid collateral", "Could not compute collateral for selected token.");
      return;
    }

    setSubmitting(true);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const loanLamports = new anchor.BN(Math.floor(loanAmountNum * 1e6));
      const collateralLamports = new anchor.BN(String(collateralRequiredLamports));
      const installments = selectedTerm;
      const annualRateBps = new anchor.BN(DEFAULT_APR_BPS);

      const borrowerCollateralAta = await getAssociatedTokenAddress(selectedCollateral.mint, publicKey);
      let walletCollateralRaw = BigInt(0);
      try {
        const bal = await connection.getTokenAccountBalance(borrowerCollateralAta);
        walletCollateralRaw = BigInt(String(bal.value.amount));
      } catch {
        walletCollateralRaw = BigInt(0);
      }

      if (walletCollateralRaw < BigInt(collateralRequiredLamports)) {
        Alert.alert(
          "Insufficient collateral",
          `Need ${collateralRequiredTokenUi.toFixed(6)} ${selectedCollateral.symbol}, wallet has ${selectedCollateral.balanceUi.toFixed(6)}.`
        );
        return;
      }

      await signAndSend(async (walletPubkey) => {
        // Use timestamp as nonce so each loan gets a unique PDA
        const loanNonce = new anchor.BN(Date.now());
        const nonceBuf = loanNonce.toArrayLike(Buffer, "le", 8);
        const [loanPda] = PublicKey.findProgramAddressSync(
          [LOAN_SEED, walletPubkey.toBuffer(), USDC_MINT.toBuffer(), nonceBuf],
          FLOAT_PROGRAM_ID
        );
        const [treasuryPda] = PublicKey.findProgramAddressSync([TREASURY_SEED], FLOAT_PROGRAM_ID);

        const borrowerCollateralAtaIx = await getAssociatedTokenAddress(selectedCollateral.mint, walletPubkey);
        const borrowerLoanAta = await getAssociatedTokenAddress(USDC_MINT, walletPubkey);
        const treasuryLoanAta = await getAssociatedTokenAddress(USDC_MINT, treasuryPda, true);
        const vaultCollateralAta = await getAssociatedTokenAddress(selectedCollateral.mint, loanPda, true);

        const provider = new anchor.AnchorProvider(
          connection,
          { publicKey: walletPubkey, signTransaction: async (t) => t, signAllTransactions: async (t) => t },
          { commitment: "confirmed" }
        );
        const program = new anchor.Program(IDL as unknown as anchor.Idl, FLOAT_PROGRAM_ID, provider);

        const createBorrowerCollateralAtaIx = createAssociatedTokenAccountIdempotentInstruction(
          walletPubkey,
          borrowerCollateralAtaIx,
          walletPubkey,
          selectedCollateral.mint
        );
        const createTreasuryLoanAtaIx = createAssociatedTokenAccountIdempotentInstruction(
          walletPubkey,
          treasuryLoanAta,
          treasuryPda,
          USDC_MINT
        );
        const createVaultCollateralAtaIx = createAssociatedTokenAccountIdempotentInstruction(
          walletPubkey,
          vaultCollateralAta,
          loanPda,
          selectedCollateral.mint
        );

        const initLoanTx = await program.methods
          .initializeLoan(collateralLamports, loanLamports, installments, annualRateBps, loanNonce)
          .accounts({
            borrower: walletPubkey,
            loan: loanPda,
            collateralMint: selectedCollateral.mint,
            loanMint: USDC_MINT,
            borrowerCollateralAta: borrowerCollateralAtaIx,
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
        tx.add(createBorrowerCollateralAtaIx);
        tx.add(createTreasuryLoanAtaIx);
        tx.add(createVaultCollateralAtaIx);
        tx.add(...initLoanTx.instructions);
        return tx;
      });

      Alert.alert("Loan Created!", "Loan token was disbursed successfully.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
      fetchWalletTokens();
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>New Loan</Text>
        <Text style={styles.subtitle}>Lock collateral token · Receive loan token · Repay in EMIs</Text>
        <Text style={styles.loanMintText}>Loan token mint: {shortMint(USDC_MINT.toBase58())}</Text>

        <Text style={styles.inputLabel}>Loan Amount (loan token)</Text>
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
            <Text style={styles.infoValue}>
              {selectedCollateral
                ? `${collateralRequiredTokenUi.toFixed(6)} ${selectedCollateral.symbol}`
                : `${requiredCollateralUsd.toFixed(2)} (select token)`}
            </Text>
            {selectedCollateral && (
              <Text style={styles.infoSub}>
                ≈ ${requiredCollateralUsd.toFixed(2)} using {selectedCollateral.priceUsd ? "Jupiter price" : "1:1 fallback"}
              </Text>
            )}
          </View>
        )}

        <Text style={styles.inputLabel}>Collateral Token</Text>
        {tokensLoading ? (
          <View style={styles.tokenLoadingRow}>
            <ActivityIndicator color={colors.primaryLight} />
            <Text style={styles.tokenLoadingText}>Reading wallet tokens…</Text>
          </View>
        ) : collateralTokens.length === 0 ? (
          <Text style={styles.walletWarning}>No SPL tokens with balance found in connected wallet.</Text>
        ) : (
          <View style={styles.tokenGrid}>
            {collateralTokens.map((token) => {
              const selected = selectedCollateralMint === token.mintStr;
              return (
                <TouchableOpacity
                  key={token.mintStr}
                  style={[styles.tokenChip, selected && styles.tokenChipActive]}
                  onPress={() => setSelectedCollateralMint(token.mintStr)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.tokenChipTitle, selected && styles.tokenChipTitleActive]}>
                    {token.symbol}
                  </Text>
                  <Text style={[styles.tokenChipSub, selected && styles.tokenChipSubActive]}>
                    Bal: {token.balanceUi.toFixed(4)}
                  </Text>
                  <Text style={[styles.tokenChipSub, selected && styles.tokenChipSubActive]}>
                    {token.priceUsd ? `~$${(token.balanceUi * token.priceUsd).toFixed(2)}` : "No price feed"}
                  </Text>
                </TouchableOpacity>
              );
            })}
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
          disabled={!isValid || submitting || !publicKey || !selectedCollateral}
          activeOpacity={0.9}
          style={styles.submitBtnWrapper}
        >
          <LinearGradient
            colors={(!isValid || submitting || !selectedCollateral) ? ["#374151", "#374151"] : [colors.primary, colors.primaryDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.submitBtn, (!isValid || submitting || !selectedCollateral) && styles.submitBtnDisabled]}
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
  subtitle: { color: colors.textMuted, fontSize: 15, marginBottom: spacing.sm, lineHeight: 22 },
  loanMintText: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.xl },
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
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.25)",
  },
  infoLabel: { color: colors.textMuted, fontSize: 14 },
  infoValue: { color: colors.primaryLight, fontSize: 17, fontWeight: "700", marginTop: 4 },
  infoSub: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  tokenLoadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xl },
  tokenLoadingText: { color: colors.textMuted, fontSize: 13 },
  tokenGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.xl },
  tokenChip: {
    width: "48%",
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.md,
  },
  tokenChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  tokenChipTitle: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 4 },
  tokenChipTitleActive: { color: colors.primaryLight },
  tokenChipSub: { color: colors.textMuted, fontSize: 12 },
  tokenChipSubActive: { color: colors.textSecondary },
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
