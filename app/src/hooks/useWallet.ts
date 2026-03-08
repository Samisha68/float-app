import { useState, useCallback } from "react";
import { NativeModules } from "react-native";
import { PublicKey, Transaction, Connection } from "@solana/web3.js";
import { DEVNET_RPC } from "../utils/constants";

// MWA returns address as base64-encoded bytes, not base58.
function mwaAddressToPublicKey(base64Address: string): PublicKey {
  const bytes = Uint8Array.from(atob(base64Address), (c) => c.charCodeAt(0));
  return new PublicKey(bytes);
}

// Lazy-loaded — never imported at the top level so Expo Go doesn't crash
type Web3MobileWallet = import("@solana-mobile/mobile-wallet-adapter-protocol-web3js").Web3MobileWallet;
async function getMwaTransact() {
  const mod = require("@solana-mobile/mobile-wallet-adapter-protocol-web3js");
  return mod.transact as typeof import("@solana-mobile/mobile-wallet-adapter-protocol-web3js").transact;
}

const APP_IDENTITY = {
  name: "Float",
  uri: "https://float.loans",
  icon: "favicon.ico",
};

const MOCK_PUBLIC_KEY = new PublicKey("11111111111111111111111111111111");

export function useWallet() {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const hasNativeMwa = Boolean(NativeModules?.SolanaMobileWalletAdapter);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      if (!hasNativeMwa) {
        setPublicKey(MOCK_PUBLIC_KEY);
        return;
      }

      const transact = await getMwaTransact();
      await transact(async (wallet: Web3MobileWallet) => {
        const authResult = await wallet.authorize({
          cluster: "devnet",
          identity: APP_IDENTITY,
        });
        setAuthToken(authResult.auth_token);
        const key = mwaAddressToPublicKey(authResult.accounts[0].address);
        setPublicKey(key);
      });
    } catch (err) {
      console.error("Wallet connect error:", err);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [hasNativeMwa]);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setAuthToken(null);
  }, []);

  /**
   * Build, simulate, sign (via MWA), and send a transaction.
   *
   * 1. Build tx BEFORE the MWA session (network calls happen here).
   * 2. Simulate tx to catch on-chain errors early (logged to console).
   * 3. Open MWA session — reauthorize (silent) or authorize (first time).
   * 4. Use signTransactions (NOT signAndSendTransactions) to get the
   *    signed tx back from Phantom — avoids Phantom-side send timeout.
   * 5. Send the signed tx to the RPC ourselves.
   */
  const signAndSend = useCallback(
    async (buildTx: (pubkey: PublicKey) => Promise<Transaction>) => {
      if (!publicKey) throw new Error("Wallet not connected");

      if (!hasNativeMwa) {
        return { signature: `mock-signature-${Date.now()}` };
      }

      const connection = new Connection(DEVNET_RPC, "confirmed");

      // 1. Build the transaction BEFORE opening the MWA session
      console.log("[MWA] Building transaction (before session)...");
      const tx = await buildTx(publicKey);
      console.log("[MWA] Transaction built, instructions:", tx.instructions.length);
      console.log("[MWA] Fee payer:", tx.feePayer?.toBase58());
      console.log("[MWA] Blockhash:", tx.recentBlockhash);

      // 2. Simulate to catch on-chain errors early
      try {
        console.log("[MWA] Simulating transaction...");
        const sim = await connection.simulateTransaction(tx);
        if (sim.value.err) {
          console.error("[MWA] Simulation FAILED:", JSON.stringify(sim.value.err));
          console.error("[MWA] Logs:", sim.value.logs);
          throw new Error(
            `Transaction will fail on-chain: ${JSON.stringify(sim.value.err)}\nLogs: ${sim.value.logs?.join("\n")}`
          );
        }
        console.log("[MWA] Simulation OK ✓");
      } catch (simErr: any) {
        // If simulation itself throws (not a sim failure), log but continue
        if (simErr.message?.includes("will fail on-chain")) throw simErr;
        console.warn("[MWA] Simulation call failed (non-fatal):", simErr.message);
      }

      // 3. Open MWA session — only auth + sign, no network calls
      const transact = await getMwaTransact();
      const signedTxs: Transaction[] = await transact(async (wallet: Web3MobileWallet) => {
        try {
          let authResult: { auth_token: string; accounts: { address: string }[] };
          if (authToken) {
            console.log("[MWA] Reauthorizing (silent)...");
            authResult = await wallet.reauthorize({
              auth_token: authToken,
              identity: APP_IDENTITY,
            });
          } else {
            console.log("[MWA] Authorizing (first time)...");
            authResult = await wallet.authorize({
              cluster: "devnet",
              identity: APP_IDENTITY,
            });
          }
          setAuthToken(authResult.auth_token);
          console.log("[MWA] Auth OK:", mwaAddressToPublicKey(authResult.accounts[0].address).toBase58());

          // 4. Sign only — let us handle the send
          console.log("[MWA] Requesting signature (signTransactions)...");
          const signed = await wallet.signTransactions({
            transactions: [tx],
          });
          console.log("[MWA] Signature received ✓");
          return signed;
        } catch (err) {
          console.error("[MWA] Error inside transact:", err);
          throw err;
        }
      });

      // 5. Send the signed transaction to the RPC ourselves
      console.log("[MWA] Sending signed transaction to devnet...");
      const rawTx = signedTxs[0].serialize();
      const signature = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      console.log("[MWA] ✓ Submitted! Signature:", signature);

      // Wait for confirmation
      console.log("[MWA] Waiting for confirmation...");
      await connection.confirmTransaction(signature, "confirmed");
      console.log("[MWA] ✓ Confirmed!");

      return { signature };
    },
    [hasNativeMwa, publicKey, authToken]
  );

  return {
    publicKey,
    connecting,
    usingMockWallet: !hasNativeMwa,
    connect,
    disconnect,
    signAndSend,
  };
}
