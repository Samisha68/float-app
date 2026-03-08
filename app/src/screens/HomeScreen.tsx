import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useWalletContext } from "../context/WalletContext";
import { useLoans } from "../hooks/useLoans";
import { LoanCard } from "../components/LoanCard";
import { formatUsdc } from "../utils/loanMath";

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
      <SafeAreaView style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Float</Text>
          <Text style={styles.heroSubtitle}>
            Collateral-backed installment loans on Solana
          </Text>
          <TouchableOpacity
            style={styles.connectBtn}
            onPress={connect}
            disabled={connecting}
          >
            {connecting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.connectBtnText}>Connect Wallet</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch} tintColor="#6366F1" />
        }
        contentContainerStyle={styles.scroll}
      >
        {/* Mock mode banner */}
        {usingMockWallet && (
          <View style={styles.mockBanner}>
            <Text style={styles.mockBannerText}>
              🧪 Expo Go preview — UI only, no real transactions.{"\n"}
              Run <Text style={styles.mockBannerCode}>eas build --profile development</Text> for MWA.
            </Text>
          </View>
        )}

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good morning 👋</Text>
            <Text style={styles.address}>
              {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
            </Text>
          </View>
          <TouchableOpacity onPress={disconnect} style={styles.disconnectBtn}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
        </View>

        {/* Summary cards */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Collateral Locked</Text>
            <Text style={styles.summaryValue}>
              ${formatUsdc(totalLocked)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Active Loans</Text>
            <Text style={styles.summaryValue}>
              {loans.filter((l) => l.status.toLowerCase() === "active").length}
            </Text>
          </View>
        </View>

        {/* CTA */}
        {!activeLoan && (
          <TouchableOpacity
            style={styles.newLoanBtn}
            onPress={() => navigation.navigate("CreateLoan")}
          >
            <Text style={styles.newLoanBtnText}>+ Take a Loan</Text>
          </TouchableOpacity>
        )}

        {/* Loans */}
        <Text style={styles.sectionTitle}>Your Loans</Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
        {loading && !loans.length && (
          <ActivityIndicator color="#6366F1" style={{ marginTop: 32 }} />
        )}
        {!loading && !loans.length && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No loans yet.</Text>
            <Text style={styles.emptySubtext}>
              Lock collateral and get USDC instantly.
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
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  scroll: { padding: 20, paddingBottom: 40 },
  mockBanner: {
    backgroundColor: "#1C1700",
    borderWidth: 1,
    borderColor: "#854D0E",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  mockBannerText: { color: "#FDE68A", fontSize: 12, lineHeight: 18 },
  mockBannerCode: { fontFamily: "monospace", color: "#FCD34D" },
  hero: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  heroTitle: {
    fontSize: 52,
    fontWeight: "900",
    color: "#FFF",
    letterSpacing: -2,
  },
  heroSubtitle: {
    fontSize: 16,
    color: "#64748B",
    textAlign: "center",
    marginTop: 12,
    marginBottom: 40,
    lineHeight: 24,
  },
  connectBtn: {
    backgroundColor: "#6366F1",
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 100,
  },
  connectBtnText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  greeting: { color: "#F1F5F9", fontSize: 20, fontWeight: "700" },
  address: { color: "#64748B", fontSize: 13, marginTop: 2, fontFamily: "monospace" },
  disconnectBtn: { padding: 8 },
  disconnectText: { color: "#64748B", fontSize: 13 },
  summaryRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  summaryCard: {
    flex: 1,
    backgroundColor: "#13131A",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1E1E2E",
  },
  summaryLabel: { color: "#64748B", fontSize: 12, marginBottom: 8 },
  summaryValue: { color: "#F1F5F9", fontSize: 24, fontWeight: "800" },
  newLoanBtn: {
    backgroundColor: "#6366F1",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 24,
  },
  newLoanBtnText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  sectionTitle: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 16,
  },
  errorText: { color: "#F87171", fontSize: 14, marginBottom: 12 },
  emptyState: { alignItems: "center", paddingVertical: 48 },
  emptyText: { color: "#F1F5F9", fontSize: 18, fontWeight: "700" },
  emptySubtext: { color: "#64748B", fontSize: 14, marginTop: 8 },
});
