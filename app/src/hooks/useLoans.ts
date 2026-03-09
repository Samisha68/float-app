import { useCallback, useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { DEVNET_RPC, FLOAT_PROGRAM_ID, LOAN_SEED, USDC_MINT } from "../utils/constants";

export interface LoanData {
  publicKey: PublicKey;
  borrower: PublicKey;
  collateralAmount: number;
  collateralMint: PublicKey;
  loanAmount: number;
  loanMint: PublicKey;
  installmentAmount: number;
  totalInstallments: number;
  installmentsPaid: number;
  nextDueTimestamp: number;
  gracePeriod: number;
  status: string;
  createdAt: number;
  annualRateBps: number;
  nonce: number;
}

const STATUS_MAP: Record<number, string> = {
  0: "active",
  1: "repaid",
  2: "liquidated",
  3: "collateralWithdrawn",
};

/**
 * Read a u64 (little-endian) from a Buffer at a given offset.
 * Uses two 32-bit reads to avoid BigInt buffer methods (not in all RN polyfills).
 */
function readU64LE(buf: Buffer, offset: number): number {
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readUInt32LE(offset + 4);
  return lo + hi * 2 ** 32;
}

/**
 * Read an i64 (little-endian) from a Buffer at a given offset.
 */
function readI64LE(buf: Buffer, offset: number): number {
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readInt32LE(offset + 4);
  return lo + hi * 2 ** 32;
}

/**
 * Manually parse LoanAccount data from raw Solana account bytes.
 * Bypasses Anchor client entirely — no IDL version mismatch issues.
 *
 * Layout (Anchor Borsh, from lib.rs LoanAccount struct):
 *   [0..8]     8-byte Anchor discriminator
 *   [8..40]    borrower: Pubkey (32)
 *   [40..48]   collateral_amount: u64 (8)
 *   [48..80]   collateral_mint: Pubkey (32)
 *   [80..88]   loan_amount: u64 (8)
 *   [88..120]  loan_mint: Pubkey (32)
 *   [120..128] installment_amount: u64 (8)
 *   [128]      total_installments: u8 (1)
 *   [129]      installments_paid: u8 (1)
 *   [130..138] next_due_timestamp: i64 (8)
 *   [138..146] grace_period: i64 (8)
 *   [146]      status: u8 (1 — enum variant index)
 *   [147..155] created_at: i64 (8)
 *   [155..163] annual_rate_bps: u64 (8)
 *   [163]      vault_bump: u8 (1)
 *   [164..172] nonce: u64 (8)
 *   [172..228] padding (56 bytes)
 */
function parseLoanAccount(data: Buffer, pda: PublicKey): LoanData {
  let o = 8; // skip Anchor discriminator

  const borrower = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const collateralAmount = readU64LE(data, o); o += 8;
  const collateralMint = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const loanAmount = readU64LE(data, o); o += 8;
  const loanMint = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const installmentAmount = readU64LE(data, o); o += 8;
  const totalInstallments = data.readUInt8(o); o += 1;
  const installmentsPaid = data.readUInt8(o); o += 1;
  const nextDueTimestamp = readI64LE(data, o); o += 8;
  const gracePeriod = readI64LE(data, o); o += 8;
  const statusByte = data.readUInt8(o); o += 1;
  const createdAt = readI64LE(data, o); o += 8;
  const annualRateBps = readU64LE(data, o); o += 8;
  /* vault_bump */ o += 1;
  const nonce = readU64LE(data, o); o += 8;

  return {
    publicKey: pda,
    borrower,
    collateralAmount,
    collateralMint,
    loanAmount,
    loanMint,
    installmentAmount,
    totalInstallments,
    installmentsPaid,
    nextDueTimestamp,
    gracePeriod,
    status: STATUS_MAP[statusByte] ?? "unknown",
    createdAt,
    annualRateBps,
    nonce,
  };
}

export function useLoans(walletPublicKey: PublicKey | null) {
  const [loans, setLoans] = useState<LoanData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLoans = useCallback(async () => {
    if (!walletPublicKey) return;
    setLoading(true);
    setError(null);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");

      // Fetch ALL loan accounts for this borrower using getProgramAccounts.
      // Since nonce is part of the PDA seeds, we can't derive a single PDA.
      // Filter by borrower pubkey at offset 8 (after 8-byte Anchor discriminator).
      console.log("[useLoans] Fetching all loans for:", walletPublicKey.toBase58());

      let accounts;
      try {
        accounts = await connection.getProgramAccounts(FLOAT_PROGRAM_ID, {
          filters: [
            { memcmp: { offset: 8, bytes: walletPublicKey.toBase58() } },
          ],
        });
      } catch (netErr: any) {
        console.warn("[useLoans] Network error fetching loans:", netErr.message);
        setLoans([]);
        return;
      }

      if (!accounts || accounts.length === 0) {
        console.log("[useLoans] No loan accounts found for this wallet");
        setLoans([]);
        return;
      }

      console.log("[useLoans] Found", accounts.length, "account(s)");

      const parsed: LoanData[] = [];
      for (const { pubkey, account } of accounts) {
        try {
          const loan = parseLoanAccount(Buffer.from(account.data), pubkey);
          console.log("[useLoans] ✓ Parsed loan:", {
            pda: pubkey.toBase58(),
            status: loan.status,
            loanAmount: loan.loanAmount,
            payments: `${loan.installmentsPaid}/${loan.totalInstallments}`,
          });
          parsed.push(loan);
        } catch (parseErr: any) {
          // Skip accounts that aren't LoanAccount (e.g. other account types from this program)
          console.warn("[useLoans] Skipping account", pubkey.toBase58(), parseErr.message);
        }
      }

      setLoans(parsed);
    } catch (err: any) {
      console.error("[useLoans] Error:", err.message ?? err);
      setError(err.message ?? "Failed to fetch loans");
    } finally {
      setLoading(false);
    }
  }, [walletPublicKey]);

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  return { loans, loading, error, refetch: fetchLoans };
}
