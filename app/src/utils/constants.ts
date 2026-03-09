import { PublicKey } from "@solana/web3.js";

// ─── Network ──────────────────────────────────────────────────────────────────
export const DEVNET_RPC = "https://api.devnet.solana.com";

// ─── Program IDs ──────────────────────────────────────────────────────────────
// Replace after `anchor deploy` on devnet.
export const FLOAT_PROGRAM_ID = new PublicKey(
  "AeWSncwhRY2TyRnM7UByjhmmcgE8rrbMs9y8vwJomgmX"
);

// Devnet USDC mint (Circle's official devnet USDC — use with faucet.circle.com).
export const USDC_MINT = new PublicKey(
  "7whbViYZqoGxZ7B32crtGEcyCJEDZNPrqSQxm9LUUtGX"
);

// ─── PDA Seeds ────────────────────────────────────────────────────────────────
export const LOAN_SEED = Buffer.from("loan");
export const TREASURY_SEED = Buffer.from("treasury");
export const VAULT_SEED = Buffer.from("vault");
export const MICRO_POOL_SEED = Buffer.from("micro_pool");
export const MICRO_LOAN_SEED = Buffer.from("micro_loan");
export const AGENT_CONFIG_SEED = Buffer.from("agent_config");

// ─── AI Micro-Lending (MONOLITH Hackathon) ─────────────────────────────────────
export const MICRO_LOAN_MAX_USDC = 100 * 1e6;  // $100 (6 decimals)
export const MICRO_TERM_DAYS_MIN = 1;
export const MICRO_TERM_DAYS_MAX = 7;
export const MICRO_COLLATERAL_RATIO = 1.1;     // 110%

// ─── Loan constants ───────────────────────────────────────────────────────────
export const LTV_RATIO = 1.5;          // 150% collateral required
export const DEFAULT_APR_BPS = 1200;   // 12% APR
export const GRACE_PERIOD_DAYS = 7;

// ─── UI ───────────────────────────────────────────────────────────────────────
export const INSTALLMENT_OPTIONS = [3, 6, 12] as const;
export type InstallmentOption = typeof INSTALLMENT_OPTIONS[number];
