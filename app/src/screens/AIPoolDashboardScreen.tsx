import React, { useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { useWalletContext } from "../context/WalletContext";
import { useMicroPool } from "../hooks/useMicroPool";
import { useMicroLoans } from "../hooks/useMicroLoans";
import { formatUsdc } from "../utils/loanMath";
import { DEVNET_RPC, FLOAT_PROGRAM_ID, USDC_MINT, MICRO_POOL_SEED } from "../utils/constants";
import { IDL } from "../idl/float";
import { colors, radius, typography, spacing, shadows } from "../theme/theme";

interface Props {
  navigation: any;
}

export function AIPoolDashboardScreen({ navigation }: Props) {
  const { publicKey, connect, connecting, disconnect, usingMockWallet, signAndSend } = useWalletContext();
  const { pool, loading, error, refetch } = useMicroPool();
  const { loans: microLoans, loading: loansLoading, refetch: refetchLoans } = useMicroLoans(publicKey);
  const [initializing, setInitializing] = useState(false);

  const activeMicro = microLoans.filter((l) => l.status === "Active");

  // Refetch when screen comes back into focus (e.g. after repay)
  useFocusEffect(
    React.useCallback(() => {
      if (publicKey) {
        refetch();
        refetchLoans();
      }
    }, [publicKey, refetch, refetchLoans])
  );

  const handleInitializePool = async () => {
    if (!publicKey || usingMockWallet) return;
    setInitializing(true);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const [poolStatePda] = PublicKey.findProgramAddressSync(
        [MICRO_POOL_SEED],
        FLOAT_PROGRAM_ID
      );
      const poolLoanAta = await getAssociatedTokenAddress(USDC_MINT, poolStatePda, true);
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
          .initializeMicroPool()
          .accounts({
            payer: walletPubkey,
            poolState: poolStatePda,
            loanMint: USDC_MINT,
            poolLoanAta,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .transaction();
      });
      refetch();
    } catch (e: any) {
      Alert.alert("Init pool failed", e?.message ?? String(e));
    } finally {
      setInitializing(false);
    }
  };

  if (!publicKey) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <LinearGradient colors={["#050508", "#0a0a14", "#0f0f1a"]} style={styles.heroGradient}>
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>AI Pool</Text>
            <Text style={styles.heroSubtitle}>
              Micro-lending powered by autonomous agents. Deposit USDC, set preferences, earn yield.
            </Text>
            <TouchableOpacity
              style={styles.connectBtnWrapper}
              onPress={connect}
              disabled={connecting}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={["#6366F1", "#4F46E5"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.connectBtn}
              >
                {connecting ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.connectBtnText}>Connect Wallet</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  const poolBalance = pool?.ataBalance ?? BigInt(0);
  const isLoading = loading || loansLoading;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={async () => {
              refetch();
              refetchLoans();
            }}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {usingMockWallet && (
          <View style={styles.mockBanner}>
            <Text style={styles.mockBannerText}>Expo Go — UI only. Build dev client for real txs.</Text>
          </View>
        )}

        <View style={styles.header}>
          <Text style={styles.greeting}>AI Pool</Text>
          <TouchableOpacity onPress={disconnect} style={styles.disconnectBtn} activeOpacity={0.7}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, shadows.sm]}>
          <Text style={styles.cardLabel}>Pool balance (USDC)</Text>
          {loading && !pool ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 12 }} />
          ) : (
            <Text style={styles.cardValue}>${formatUsdc(Number(poolBalance))}</Text>
          )}
          {!pool?.exists && (
            <>
              <Text style={styles.hint}>Pool not initialized. One-time setup:</Text>
              <TouchableOpacity
                style={styles.initBtn}
                onPress={handleInitializePool}
                disabled={initializing}
                activeOpacity={0.85}
              >
                {initializing ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.initBtnText}>Initialize pool</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtnWrapper, !pool?.exists && styles.btnDisabled]}
          onPress={() => navigation.navigate("DepositToPool")}
          disabled={!pool?.exists}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={!pool?.exists ? ["#374151", "#374151"] : [colors.primary, colors.primaryDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.primaryBtn}
          >
            <Text style={styles.primaryBtnText}>Deposit to pool</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => navigation.navigate("AgentPreferences")}
          activeOpacity={0.9}
        >
          <Text style={styles.secondaryBtnText}>Set agent preferences</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => navigation.navigate("AgentStatus")}
          activeOpacity={0.9}
        >
          <Text style={styles.secondaryBtnText}>Agent status</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>My micro-loans</Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
        {loansLoading && (
          <View style={styles.emptyState}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.emptyText, { marginTop: spacing.md }]}>Loading loans...</Text>
          </View>
        )}
        {!loansLoading && activeMicro.length === 0 && microLoans.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>◇</Text>
            <Text style={styles.emptyText}>No micro-loans yet</Text>
            <Text style={styles.emptySubtext}>Deposit to pool and let the agent match.</Text>
          </View>
        )}
        {activeMicro.map((loan) => (
          <View key={loan.publicKey.toBase58()} style={[styles.loanRow, shadows.sm]}>
            <View style={styles.loanRowLeft}>
              <Text style={styles.loanAmount}>${formatUsdc(Number(loan.amount))}</Text>
              <Text style={styles.loanMeta}>
                {loan.termDays}d · Due {new Date(loan.dueAt * 1000).toLocaleDateString()}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.smallBtn}
              onPress={() => navigation.navigate("RepayMicro", { loan })}
              activeOpacity={0.85}
            >
              <Text style={styles.smallBtnText}>Repay</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  heroGradient: { flex: 1 },
  hero: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  heroTitle: { ...typography.hero, fontSize: 40, color: colors.text, marginBottom: spacing.md },
  heroSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 40,
  },
  connectBtnWrapper: {
    borderRadius: radius.full,
    ...Platform.select({
      ios: { shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
      android: { elevation: 8 },
    }),
  },
  connectBtn: {
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: radius.full,
  },
  connectBtnText: { color: "#FFF", fontSize: 17, fontWeight: "700" },
  scroll: { padding: spacing.xl, paddingBottom: 48 },
  mockBanner: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  mockBannerText: { color: "#FCD34D", fontSize: 13 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xxl },
  greeting: { ...typography.h3, color: colors.text },
  disconnectBtn: { padding: spacing.sm },
  disconnectText: { color: colors.textMuted, fontSize: 14 },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  cardLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm },
  cardValue: { ...typography.h1, color: colors.text, fontSize: 28 },
  hint: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.lg },
  initBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    alignSelf: "flex-start",
    marginTop: spacing.lg,
  },
  initBtnText: { color: "#FFF", fontSize: 14, fontWeight: "600" },
  btnDisabled: { opacity: 0.6 },
  primaryBtnWrapper: {
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10 },
      android: { elevation: 6 },
    }),
  },
  primaryBtn: { paddingVertical: 18, borderRadius: radius.lg, alignItems: "center" },
  primaryBtnText: { color: "#FFF", fontSize: 17, fontWeight: "700" },
  secondaryBtn: {
    backgroundColor: colors.surface,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  secondaryBtnText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  sectionTitle: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xxl, marginBottom: spacing.lg },
  errorText: { color: colors.error, fontSize: 14, marginBottom: spacing.md },
  emptyState: { alignItems: "center", paddingVertical: 48 },
  emptyIcon: { fontSize: 40, opacity: 0.25, marginBottom: spacing.lg },
  emptyText: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
  emptySubtext: { color: colors.textMuted, fontSize: 14 },
  loanRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
    backgroundColor: colors.bgCard,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  loanRowLeft: { flex: 1 },
  loanAmount: { ...typography.h3, color: colors.text, marginBottom: 4 },
  loanMeta: { color: colors.textMuted, fontSize: 13 },
  smallBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  smallBtnText: { color: "#FFF", fontSize: 14, fontWeight: "600" },
});
