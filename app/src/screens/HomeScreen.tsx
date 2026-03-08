import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useWalletContext } from "../context/WalletContext";
import { useLoans } from "../hooks/useLoans";
import { LoanCard } from "../components/LoanCard";
import { formatUsdc } from "../utils/loanMath";
import { colors, spacing, typography, radius } from "../theme/theme";

interface Props {
  navigation: any;
}

export function HomeScreen({ navigation }: Props) {
  const { publicKey, connect, connecting, disconnect, usingMockWallet } = useWalletContext();
  const { loans, loading, error, refetch } = useLoans(publicKey);

  const activeLoan = loans.find((l) => l.status.toLowerCase() === "active");
  const totalLocked = loans.reduce(
    (acc, l) =>
      l.status.toLowerCase() === "active"
        ? acc + Number(l.collateralAmount)
        : acc,
    0
  );

  const handleRepay = useCallback(() => {
    if (activeLoan) {
      navigation.navigate("Repay", { loan: activeLoan });
    }
  }, [activeLoan, navigation]);

  const handleWithdraw = useCallback((loan: any) => {
    navigation.navigate("Repay", { loan, mode: "withdraw" });
  }, [navigation]);

  if (!publicKey) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <LinearGradient
          colors={["#050508", "#0a0a14", "#0f0f1a"]}
          style={styles.heroGradient}
        >
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>Float</Text>
            <Text style={styles.heroSubtitle}>
              Collateral-backed installment loans on Solana. Lock USDC, borrow instantly, repay on your terms.
            </Text>
            <TouchableOpacity
              onPress={connect}
              disabled={connecting}
              activeOpacity={0.9}
              style={styles.connectBtnWrapper}
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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.primary} />
        }
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {usingMockWallet && (
          <View style={styles.mockBanner}>
            <Text style={styles.mockBannerText}>
              🧪 Expo Go preview — UI only, no real transactions.{"\n"}
              Run <Text style={styles.mockBannerCode}>eas build --profile development</Text> for MWA.
            </Text>
          </View>
        )}

        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good morning</Text>
            <Text style={styles.address}>
              {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
            </Text>
          </View>
          <TouchableOpacity onPress={disconnect} style={styles.disconnectBtn} activeOpacity={0.7}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, styles.summaryCardLeft]}>
            <Text style={styles.summaryLabel}>Collateral Locked</Text>
            <Text style={styles.summaryValue}>${formatUsdc(totalLocked)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Active Loans</Text>
            <Text style={styles.summaryValue}>
              {loans.filter((l) => l.status.toLowerCase() === "active").length}
            </Text>
          </View>
        </View>

        {!activeLoan && (
          <TouchableOpacity
            style={styles.newLoanBtnWrapper}
            onPress={() => navigation.navigate("CreateLoan")}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={["#6366F1", "#4F46E5"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.newLoanBtn}
            >
              <Text style={styles.newLoanBtnText}>+ Take a Loan</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>Your Loans</Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
        {loading && !loans.length && (
          <ActivityIndicator color={colors.primary} size="large" style={styles.loader} />
        )}
        {!loading && !loans.length && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>◎</Text>
            <Text style={styles.emptyText}>No loans yet</Text>
            <Text style={styles.emptySubtext}>
              Lock collateral and get USDC instantly. Repay in fixed monthly installments.
            </Text>
          </View>
        )}
        {loans.map((loan) => (
          <LoanCard
            key={loan.publicKey.toBase58()}
            loan={loan}
            onRepay={handleRepay}
            onWithdraw={() => handleWithdraw(loan)}
          />
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
  heroTitle: {
    ...typography.hero,
    color: colors.text,
    marginBottom: spacing.md,
  },
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
  mockBannerText: { color: "#FCD34D", fontSize: 13, lineHeight: 20 },
  mockBannerCode: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", color: "#FDE68A" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  greeting: { ...typography.h3, color: colors.text },
  address: { ...typography.mono, color: colors.textMuted, marginTop: 4 },
  disconnectBtn: { padding: spacing.sm },
  disconnectText: { color: colors.textMuted, fontSize: 14 },
  summaryRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.xl },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  summaryCardLeft: { marginRight: 0 },
  summaryLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm },
  summaryValue: { ...typography.h2, color: colors.text },
  newLoanBtnWrapper: {
    borderRadius: radius.lg,
    marginBottom: spacing.xxl,
    ...Platform.select({
      ios: { shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10 },
      android: { elevation: 6 },
    }),
  },
  newLoanBtn: {
    paddingVertical: 18,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  newLoanBtnText: { color: "#FFF", fontSize: 17, fontWeight: "700" },
  sectionTitle: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  errorText: { color: colors.error, fontSize: 14, marginBottom: spacing.md },
  loader: { marginTop: 48 },
  emptyState: {
    alignItems: "center",
    paddingVertical: 56,
  },
  emptyIcon: { fontSize: 48, opacity: 0.3, marginBottom: spacing.lg },
  emptyText: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
  emptySubtext: { color: colors.textMuted, fontSize: 14, textAlign: "center", lineHeight: 22 },
});
