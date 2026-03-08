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

interface Props {
  navigation: any;
}

export function HistoryScreen({ navigation }: Props) {
  const { publicKey } = useWalletContext();
  const { loans, loading, refetch } = useLoans(publicKey);

  const historical = loans.filter(
    (l) => l.status.toLowerCase() !== "active"
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>History</Text>
      {loading && !historical.length && (
        <ActivityIndicator color="#6366F1" style={{ marginTop: 40 }} />
      )}
      {!publicKey && (
        <Text style={styles.info}>Connect your wallet to see loan history.</Text>
      )}
      {publicKey && !loading && !historical.length && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No past loans.</Text>
          <Text style={styles.emptySubtext}>Completed loans appear here.</Text>
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
          <RefreshControl refreshing={loading} onRefresh={refetch} tintColor="#6366F1" />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#F1F5F9",
    padding: 20,
    paddingBottom: 8,
  },
  list: { padding: 20, paddingTop: 8, paddingBottom: 40 },
  info: { color: "#64748B", fontSize: 14, padding: 20 },
  emptyState: { alignItems: "center", paddingVertical: 48 },
  emptyText: { color: "#F1F5F9", fontSize: 18, fontWeight: "700" },
  emptySubtext: { color: "#64748B", fontSize: 14, marginTop: 8 },
});
