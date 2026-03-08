import { useCallback, useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  DEVNET_RPC,
  FLOAT_PROGRAM_ID,
  USDC_MINT,
  MICRO_POOL_SEED,
} from "../utils/constants";

export interface PoolStateData {
  poolStatePda: PublicKey;
  poolLoanAta: PublicKey;
  totalDeposited: bigint;
  ataBalance: bigint;
  exists: boolean;
}

export function useMicroPool() {
  const [data, setData] = useState<PoolStateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connection = new Connection(DEVNET_RPC, "confirmed");

  const fetchPool = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [poolStatePda] = PublicKey.findProgramAddressSync(
        [MICRO_POOL_SEED],
        FLOAT_PROGRAM_ID
      );
      const poolLoanAta = await getAssociatedTokenAddress(
        USDC_MINT,
        poolStatePda,
        true
      );

      let totalDeposited = BigInt(0);
      let exists = false;

      try {
        const acc = await connection.getAccountInfo(poolStatePda);
        if (acc?.data) {
          exists = true;
          // PoolState: discriminator 8 + bump 1 + total_deposited 8
          totalDeposited = acc.data.readBigUInt64LE(8 + 1);
        }
      } catch {
        // pool not initialized
      }

      let ataBalance = BigInt(0);
      try {
        const tokenAcc = await connection.getTokenAccountBalance(poolLoanAta);
        ataBalance = BigInt(tokenAcc.value.amount);
      } catch {
        // ATA may not exist
      }

      setData({
        poolStatePda,
        poolLoanAta,
        totalDeposited,
        ataBalance,
        exists,
      });
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch pool");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPool();
  }, [fetchPool]);

  return { pool: data, loading, error, refetch: fetchPool };
}
