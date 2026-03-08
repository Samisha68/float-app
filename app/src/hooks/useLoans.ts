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
 *   [164..228] padding (64 bytes)
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

      // Derive the expected loan PDA for this borrower + USDC.
      const [loanPda] = PublicKey.findProgramAddressSync(
        [LOAN_SEED, walletPublicKey.toBuffer(), USDC_MINT.toBuffer()],
        FLOAT_PROGRAM_ID
      );

      console.log("[useLoans] Fetching loan PDA:", loanPda.toBase58());

      const accountInfo = await connection.getAccountInfo(loanPda);

      if (!accountInfo || !accountInfo.data) {
        console.log("[useLoans] No loan account found for this wallet");
        setLoans([]);
        return;
      }

      console.log(
        "[useLoans] Account found — size:",
        accountInfo.data.length,
        "owner:",
        accountInfo.owner.toBase58()
      );

      const loan = parseLoanAccount(Buffer.from(accountInfo.data), loanPda);

      console.log("[useLoans] ✓ Parsed loan:", {
        borrower: loan.borrower.toBase58(),
        status: loan.status,
        loanAmount: loan.loanAmount,
        collateralAmount: loan.collateralAmount,
        payments: `${loan.installmentsPaid}/${loan.totalInstallments}`,
      });

      setLoans([loan]);
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
