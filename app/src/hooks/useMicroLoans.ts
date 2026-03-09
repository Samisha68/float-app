import { useCallback, useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  DEVNET_RPC,
  FLOAT_PROGRAM_ID,
  USDC_MINT,
  MICRO_LOAN_SEED,
} from "../utils/constants";

export interface MicroLoanData {
  publicKey: PublicKey;
  borrower: PublicKey;
  amount: bigint;
  termDays: number;
  collateralAmount: bigint;
  totalRepay: bigint;
  dueAt: number;
  graceUntil: number;
  status: string;
  createdAt: number;
  nonce: bigint;
}

const MICRO_LOAN_DISCRIMINATOR_LEN = 8;
const MICRO_LOAN_LAYOUT = 32 + 8 + 1 + 8 + 8 + 8 + 8 + 1 + 8 + 8 + 32 + 32 + 1 + 32;

function parseMicroLoanAccount(data: Buffer, pubkey: PublicKey): MicroLoanData | null {
  if (data.length < MICRO_LOAN_DISCRIMINATOR_LEN + MICRO_LOAN_LAYOUT) return null;
  const reader = data.subarray(MICRO_LOAN_DISCRIMINATOR_LEN);
  let o = 0;
  const borrower = new PublicKey(reader.subarray(o, o + 32)); o += 32;
  const amount = reader.readBigUInt64LE(o); o += 8;
  const termDays = reader.readUInt8(o); o += 1;
  const collateralAmount = reader.readBigUInt64LE(o); o += 8;
  const totalRepay = reader.readBigUInt64LE(o); o += 8;
  const dueAt = Number(reader.readBigInt64LE(o)); o += 8;
  const graceUntil = Number(reader.readBigInt64LE(o)); o += 8;
  const statusByte = reader.readUInt8(o); o += 1;
  const status = ["Active", "Repaid", "Liquidated", "CollateralWithdrawn"][statusByte] ?? "Unknown";
  const createdAt = Number(reader.readBigInt64LE(o)); o += 8;
  const nonce = reader.readBigUInt64LE(o);
  return {
    publicKey: pubkey,
    borrower,
    amount,
    termDays,
    collateralAmount,
    totalRepay,
    dueAt,
    graceUntil,
    status,
    createdAt,
    nonce,
  };
}

export function useMicroLoans(walletPublicKey: PublicKey | null) {
  const [loans, setLoans] = useState<MicroLoanData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connection = new Connection(DEVNET_RPC, "confirmed");

  const fetchLoans = useCallback(async () => {
    if (!walletPublicKey) {
      setLoans([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const MICRO_LOAN_DATA_LEN = 8 + 32 + 8 + 1 + 8 + 8 + 8 + 8 + 1 + 8 + 8 + 32 + 32 + 1 + 32;
      // Filter by borrower at RPC level (avoids fetching all program accounts)
      const accounts = await connection.getProgramAccounts(FLOAT_PROGRAM_ID, {
        dataSlice: { offset: 0, length: MICRO_LOAN_DATA_LEN },
        filters: [
          { dataSize: MICRO_LOAN_DATA_LEN },
          { memcmp: { offset: 8, bytes: walletPublicKey.toBase58() } },
        ],
      });
      const decoded: MicroLoanData[] = [];
      for (const { pubkey, account } of accounts) {
        if (!account.data || account.data.length < MICRO_LOAN_DATA_LEN) continue;
        const parsed = parseMicroLoanAccount(account.data as Buffer, pubkey);
        if (parsed) decoded.push(parsed);
      }
      decoded.sort((a, b) => b.createdAt - a.createdAt);
      setLoans(decoded);
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch micro loans");
      setLoans([]);
    } finally {
      setLoading(false);
    }
  }, [walletPublicKey]);

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  return { loans, loading, error, refetch: fetchLoans };
}
