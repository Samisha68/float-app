import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { LoanData } from "../hooks/useLoans";
import { formatUsdc, formatDueDate, daysUntilDue } from "../utils/loanMath";
import { colors, radius, typography, spacing, shadows } from "../theme/theme";

interface Props {
  loan: LoanData;
  onRepay?: () => void;
  onWithdraw?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: "#4ADE80",
  repaid: "#60A5FA",
  liquidated: "#F87171",
  collateralwithdrawn: "#A78BFA",
};

export function LoanCard({ loan, onRepay, onWithdraw }: Props) {
  const statusKey = loan.status.toLowerCase().replace(" ", "");
  const color = STATUS_COLORS[statusKey] ?? colors.textSecondary;
  const remaining = loan.totalInstallments - loan.installmentsPaid;
  const days = daysUntilDue(loan.nextDueTimestamp);
  const progressPct = (loan.installmentsPaid / loan.totalInstallments) * 100;

  return (
    <View style={[styles.card, shadows.sm]}>
      <View style={styles.row}>
        <Text style={styles.label}>Loan</Text>
        <View style={[styles.badge, { backgroundColor: color + "22" }]}>
          <Text style={[styles.badgeText, { color }]}>{loan.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={[styles.row, { marginTop: spacing.lg }]}>
        <View>
          <Text style={styles.smallLabel}>Loan Amount</Text>
          <Text style={styles.amount}>${formatUsdc(loan.loanAmount)} USDC</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.smallLabel}>Collateral</Text>
          <Text style={styles.amount}>{formatUsdc(loan.collateralAmount)}</Text>
        </View>
      </View>

      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {loan.installmentsPaid}/{loan.totalInstallments} payments
        </Text>
      </View>

      {statusKey === "active" && (
        <>
          <View style={styles.row}>
            <Text style={styles.smallLabel}>Next EMI</Text>
            <Text style={[styles.dueText, days <= 3 && { color: colors.error }]}>
              {days === 0 ? "Due today!" : `${days}d — ${formatDueDate(loan.nextDueTimestamp)}`}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.smallLabel}>EMI Amount</Text>
            <Text style={styles.emiText}>${formatUsdc(loan.installmentAmount)} USDC</Text>
          </View>
        </>
      )}

      <View style={[styles.actions, { marginTop: spacing.xl }]}>
        {statusKey === "active" && onRepay && (
          <TouchableOpacity style={styles.primaryBtn} onPress={onRepay} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Pay EMI →</Text>
          </TouchableOpacity>
        )}
        {statusKey === "repaid" && onWithdraw && (
          <TouchableOpacity style={styles.secondaryBtn} onPress={onWithdraw} activeOpacity={0.85}>
            <Text style={styles.secondaryBtnText}>Withdraw Collateral</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: { ...typography.label, color: colors.textSecondary },
  smallLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  amount: { ...typography.h3, color: colors.text },
  badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  progressContainer: { marginVertical: spacing.lg },
  progressBar: {
    height: 6,
    backgroundColor: colors.surfaceBorder,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  progressFill: {
    height: 6,
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  progressText: { color: colors.textMuted, fontSize: 12, textAlign: "right" },
  dueText: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
  emiText: { color: colors.primaryLight, fontSize: 15, fontWeight: "700" },
  actions: { flexDirection: "row", gap: spacing.sm },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  primaryBtnText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.primary,
  },
  secondaryBtnText: { color: colors.primaryLight, fontWeight: "700", fontSize: 15 },
});
