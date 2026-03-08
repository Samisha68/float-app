import { PublicKey } from "@solana/web3.js";

// ─── Network ──────────────────────────────────────────────────────────────────
export const DEVNET_RPC = "https://api.devnet.solana.com";

// ─── Program IDs ──────────────────────────────────────────────────────────────
// Replace after `anchor deploy` on devnet.
export const FLOAT_PROGRAM_ID = new PublicKey(
  "AeWSncwhRY2TyRnM7UByjhmmcgE8rrbMs9y8vwJomgmX"
);

// Devnet USDC mint (Circle's official devnet USDC).
export const USDC_MINT = new PublicKey(
  "7whbViYZqoGxZ7B32crtGEcyCJEDZNPrqSQxm9LUUtGX"

);

// ─── PDA Seeds ────────────────────────────────────────────────────────────────
export const LOAN_SEED = Buffer.from("loan");
export const TREASURY_SEED = Buffer.from("treasury");
export const VAULT_SEED = Buffer.from("vault");

// ─── Loan constants ───────────────────────────────────────────────────────────
export const LTV_RATIO = 1.5;          // 150% collateral required
export const DEFAULT_APR_BPS = 1200;   // 12% APR
export const GRACE_PERIOD_DAYS = 7;

// ─── UI ───────────────────────────────────────────────────────────────────────
export const INSTALLMENT_OPTIONS = [3, 6, 12] as const;
export type InstallmentOption = typeof INSTALLMENT_OPTIONS[number];
