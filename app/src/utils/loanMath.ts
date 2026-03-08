/**
 * Flat-interest EMI calculator — mirrors the on-chain formula exactly.
 *
 * total_interest = principal * annualRateBps * (n / 12) / 10_000
 * EMI            = (principal + total_interest) / n
 */
export function calculateEMI(
  loanAmount: number,    // USDC units (e.g. 100 for $100)
  installments: number,  // 3 | 6 | 12
  annualRateBps: number  // e.g. 1200 for 12%
): { emi: number; totalInterest: number; totalRepayable: number } {
  const totalInterest =
    (loanAmount * annualRateBps * installments) / 12 / 10_000;
  const totalRepayable = loanAmount + totalInterest;
  const emi = totalRepayable / installments;
  return { emi, totalInterest, totalRepayable };
}

/**
 * Minimum collateral required for a given loan amount (150% LTV).
 */
export function minCollateral(loanAmount: number): number {
  return (loanAmount * 150) / 100;
}

/**
 * Format a unix timestamp to a human-readable date string.
 */
export function formatDueDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format USDC amount from on-chain u64 (6 decimals) to display string.
 */
export function formatUsdc(lamports: bigint | number): string {
  const n = Number(lamports) / 1e6;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Check if a loan is overdue (past due date + grace period).
 */
export function isLiquidatable(nextDueTs: number, gracePeriodSecs: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now >= nextDueTs + gracePeriodSecs;
}

/**
 * Days remaining until next payment is due.
 */
export function daysUntilDue(nextDueTs: number): number {
  const now = Math.floor(Date.now() / 1000);
  const diff = nextDueTs - now;
  return Math.max(0, Math.ceil(diff / 86400));
}
