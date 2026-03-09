import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useWalletContext } from "../context/WalletContext";
import { useLoans } from "../hooks/useLoans";
import { LoanCard } from "../components/LoanCard";
import { colors, typography, spacing } from "../theme/theme";

interface Props {
  navigation: any;
}

export function HistoryScreen({ navigation }: Props) {
  const { publicKey } = useWalletContext();
  const { loans, loading, refetch } = useLoans(publicKey);

  const historical = loans.filter((l) => l.status.toLowerCase() !== "active");

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>Completed and past loans</Text>
      </View>

      {loading && !historical.length && (
        <ActivityIndicator color={colors.primary} size="large" style={styles.loader} />
      )}
      {!publicKey && (
        <Text style={styles.info}>Connect your wallet to see loan history.</Text>
      )}
      {publicKey && !loading && !historical.length && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>◷</Text>
          <Text style={styles.emptyText}>No past loans</Text>
          <Text style={styles.emptySubtext}>Completed loans will appear here.</Text>
        </View>
      )}
      <FlatList
        data={historical}
        keyExtractor={(item) => item.publicKey.toBase58()}
        renderItem={({ item }) => (
          <LoanCard
            loan={item}
            onWithdraw={
              item.status.toLowerCase() === "repaid"
                ? () => navigation.navigate("Repay", { loan: item, mode: "withdraw" })
                : undefined
            }
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.md },
  title: { ...typography.h1, color: colors.text },
  subtitle: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  list: { padding: spacing.xl, paddingTop: spacing.md, paddingBottom: 48 },
  loader: { marginTop: 48 },
  info: { color: colors.textMuted, fontSize: 15, padding: spacing.xl },
  emptyState: { alignItems: "center", paddingVertical: 64 },
  emptyIcon: { fontSize: 48, opacity: 0.25, marginBottom: spacing.lg },
  emptyText: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
  emptySubtext: { color: colors.textMuted, fontSize: 14 },
});
