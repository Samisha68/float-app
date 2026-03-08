import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { LoanData } from "../hooks/useLoans";
import { formatUsdc, formatDueDate, daysUntilDue } from "../utils/loanMath";

interface Props {
  loan: LoanData;
  onRepay?: () => void;
  onWithdraw?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: "#4ADE80",
  repaid: "#60A5FA",
  liquidated: "#F87171",
  collateralWithdrawn: "#A78BFA",
};

export function LoanCard({ loan, onRepay, onWithdraw }: Props) {
  const statusKey = loan.status.toLowerCase();
  const color = STATUS_COLORS[statusKey] ?? "#94A3B8";
  const remaining = loan.totalInstallments - loan.installmentsPaid;
  const days = daysUntilDue(loan.nextDueTimestamp);

  return (
    <View style={styles.card}>
      {/* Header row */}
      <View style={styles.row}>
        <Text style={styles.label}>Loan</Text>
        <View style={[styles.badge, { backgroundColor: color + "22" }]}>
          <Text style={[styles.badgeText, { color }]}>
            {loan.status.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Amount row */}
      <View style={[styles.row, { marginTop: 12 }]}>
        <View>
          <Text style={styles.smallLabel}>Loan Amount</Text>
          <Text style={styles.amount}>${formatUsdc(loan.loanAmount)} USDC</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.smallLabel}>Collateral</Text>
          <Text style={styles.amount}>{formatUsdc(loan.collateralAmount)}</Text>
        </View>
      </View>

      {/* Progress row */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${(loan.installmentsPaid / loan.totalInstallments) * 100}%`,
              },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {loan.installmentsPaid}/{loan.totalInstallments} payments
        </Text>
      </View>

      {/* Due date */}
      {statusKey === "active" && (
        <View style={styles.row}>
          <Text style={styles.smallLabel}>Next EMI</Text>
          <Text style={[styles.dueText, days <= 3 && { color: "#F87171" }]}>
            {days === 0 ? "Due today!" : `${days}d — ${formatDueDate(loan.nextDueTimestamp)}`}
          </Text>
        </View>
      )}

      {/* EMI amount */}
      {statusKey === "active" && (
        <View style={styles.row}>
          <Text style={styles.smallLabel}>EMI Amount</Text>
          <Text style={styles.emiText}>${formatUsdc(loan.installmentAmount)} USDC</Text>
        </View>
      )}

      {/* Actions */}
      <View style={[styles.row, { marginTop: 16, gap: 8 }]}>
        {statusKey === "active" && onRepay && (
          <TouchableOpacity style={styles.primaryBtn} onPress={onRepay}>
            <Text style={styles.primaryBtnText}>Pay EMI →</Text>
          </TouchableOpacity>
        )}
        {statusKey === "repaid" && onWithdraw && (
          <TouchableOpacity style={styles.secondaryBtn} onPress={onWithdraw}>
            <Text style={styles.secondaryBtnText}>Withdraw Collateral</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#13131A",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#1E1E2E",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: { color: "#94A3B8", fontSize: 13, fontWeight: "600", letterSpacing: 1 },
  smallLabel: { color: "#64748B", fontSize: 11, marginBottom: 2 },
  amount: { color: "#F1F5F9", fontSize: 18, fontWeight: "700" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  progressContainer: { marginVertical: 12 },
  progressBar: {
    height: 4,
    backgroundColor: "#1E1E2E",
    borderRadius: 2,
    marginBottom: 6,
  },
  progressFill: {
    height: 4,
    backgroundColor: "#6366F1",
    borderRadius: 2,
  },
  progressText: { color: "#64748B", fontSize: 11, textAlign: "right" },
  dueText: { color: "#94A3B8", fontSize: 13, fontWeight: "600" },
  emiText: { color: "#A5B4FC", fontSize: 14, fontWeight: "700" },
  primaryBtn: {
    flex: 1,
    backgroundColor: "#6366F1",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: "#1E1E2E",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#6366F1",
  },
  secondaryBtnText: { color: "#A5B4FC", fontWeight: "700", fontSize: 15 },
});
