import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
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
import { IDL } from "../idl/float";
import { colors, radius, typography, spacing } from "../theme/theme";

interface Props {
  navigation: any;
}

export function DepositToPoolScreen({ navigation }: Props) {
  const { publicKey, signAndSend } = useWalletContext();
  const { refetch } = useMicroPool();
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const amountLamports = Math.floor(parseFloat(amount || "0") * 1e6);

  const handleDeposit = async () => {
    if (!publicKey || amountLamports <= 0) return;
    setSubmitting(true);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const [poolStatePda] = PublicKey.findProgramAddressSync(
        [MICRO_POOL_SEED],
        FLOAT_PROGRAM_ID
      );
      const poolLoanAta = await getAssociatedTokenAddress(USDC_MINT, poolStatePda, true);
      const depositorAta = await getAssociatedTokenAddress(USDC_MINT, publicKey);

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
          .depositToPool(new anchor.BN(amountLamports))
          .accounts({
            depositor: walletPubkey,
            poolState: poolStatePda,
            depositorAta,
            poolLoanAta,
            loanMint: USDC_MINT,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .transaction();
      });
      refetch();
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Deposit failed", e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.inner}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Deposit to AI pool</Text>
        <Text style={styles.subtitle}>USDC (6 decimals)</Text>

        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
        />

        <TouchableOpacity
          style={[styles.btnWrapper, (amountLamports <= 0 || submitting) && styles.btnDisabled]}
          onPress={handleDeposit}
          disabled={amountLamports <= 0 || submitting}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={(amountLamports <= 0 || submitting) ? ["#374151", "#374151"] : [colors.primary, colors.primaryDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.btn}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.btnText}>Deposit</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

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
  backBtn: { marginBottom: spacing.lg },
  backText: { color: colors.primaryLight, fontSize: 16, fontWeight: "600" },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.sm },
  subtitle: { color: colors.textMuted, fontSize: 15, marginBottom: spacing.xl },
  input: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.lg,
    padding: spacing.xl,
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  btnWrapper: { borderRadius: radius.lg, overflow: "hidden" },
  btnDisabled: { opacity: 0.5 },
  btn: { paddingVertical: 18, borderRadius: radius.lg, alignItems: "center" },
  btnText: { color: "#FFF", fontSize: 17, fontWeight: "700" },
  cancelBtn: { marginTop: spacing.lg, alignItems: "center" },
  cancelText: { color: colors.textMuted, fontSize: 15 },
});
