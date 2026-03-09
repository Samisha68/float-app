/**
 * Float — Agent Match Loan (raw transactions, no Anchor IDL needed)
 * Usage:
 *   AGENT_KEYPAIR=./demo-wallet.json AMOUNT=10000000 TERM_DAYS=3 NONCE=1 node scripts/agent-match.js
 *
 * AMOUNT   — in USDC micro-units (6 decimals): 10000000 = $10
 * TERM_DAYS — 1–7
 * NONCE    — unique per loan (use 1, 2, 3… for multiple loans)
 * SKIP_PREFlight=1 — if simulator fails with "Access violation", use this to send anyway
 */

const fs = require("fs");
const path = require("path");
const {
  Connection, Keypair, PublicKey, SystemProgram,
  TransactionInstruction, Transaction, SYSVAR_RENT_PUBKEY,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAccount,
} = require("@solana/spl-token");

// ── Constants ─────────────────────────────────────────────────────────────────
const PROGRAM_ID       = new PublicKey("AeWSncwhRY2TyRnM7UByjhmmcgE8rrbMs9y8vwJomgmX");
const USDC_MINT        = new PublicKey(
  process.env.LOAN_MINT || "7whbViYZqoGxZ7B32crtGEcyCJEDZNPrqSQxm9LUUtGX"
);
const MICRO_POOL_SEED  = Buffer.from("micro_pool");
const MICRO_LOAN_SEED  = Buffer.from("micro_loan");
const AGENT_CFG_SEED   = Buffer.from("agent_config");

// Anchor discriminator for agent_match_loan
const DISC_MATCH = Buffer.from([71,228,193,190,54,61,184,204]);

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadKeypair(envVar, fallback) {
  const p = process.env[envVar] || fallback;
  if (!fs.existsSync(p)) { console.error(`Keypair not found: ${p}`); process.exit(1); }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function u64LE(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

async function sendAndConfirm(connection, tx, signers) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const skipPreflight = process.env.SKIP_PREFlight === "1";
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight });
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  if (conf.value.err) {
    throw new Error(`Transaction ${sig} failed: ${JSON.stringify(conf.value.err)}`);
  }
  return sig;
}

async function ensureAta(connection, payer, owner, mint) {
  const ata = await getAssociatedTokenAddress(mint, owner, true);
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint)
    );
    await sendAndConfirm(connection, tx, [payer]);
    console.log("  Created ATA:", ata.toBase58());
  }
  return ata;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const rpc      = process.env.RPC || "https://api.devnet.solana.com";
  const amount   = parseInt(process.env.AMOUNT   || "10000000"); // default $10
  const termDays = parseInt(process.env.TERM_DAYS || "3");
  const nonce    = parseInt(process.env.NONCE    || "1");

  const connection = new Connection(rpc, "confirmed");
  const agentKp    = loadKeypair("AGENT_KEYPAIR",   path.join(__dirname, "../demo-wallet.json"));
  const borrowerKp = loadKeypair("BORROWER_KEYPAIR", path.join(__dirname, "../demo-wallet.json"));

  const isSelfDemo = agentKp.publicKey.equals(borrowerKp.publicKey);
  if (isSelfDemo) console.log("[demo mode] agent = borrower");

  console.log("\n=== Agent Match Loan ===");
  console.log("Agent   :", agentKp.publicKey.toBase58());
  console.log("Borrower:", borrowerKp.publicKey.toBase58());
  console.log(`Loan    : $${amount/1e6} USDC / ${termDays} days / nonce=${nonce}`);

  // ── Derive PDAs ───────────────────────────────────────────────────────────
  const [poolStatePda]  = PublicKey.findProgramAddressSync([MICRO_POOL_SEED], PROGRAM_ID);
  const [agentConfigPda] = PublicKey.findProgramAddressSync([AGENT_CFG_SEED], PROGRAM_ID);

  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  const [microLoanPda] = PublicKey.findProgramAddressSync(
    [MICRO_LOAN_SEED, borrowerKp.publicKey.toBuffer(), USDC_MINT.toBuffer(), nonceBuf],
    PROGRAM_ID
  );

  console.log("\nPDAs:");
  console.log("  Pool     :", poolStatePda.toBase58());
  console.log("  MicroLoan:", microLoanPda.toBase58());

  // Check pool has enough liquidity
  const poolLoanAta = await getAssociatedTokenAddress(USDC_MINT, poolStatePda, true);
  try {
    const poolAtaInfo = await getAccount(connection, poolLoanAta);
    const poolBal = Number(poolAtaInfo.amount) / 1e6;
    console.log(`\nPool balance: ${poolBal} USDC`);
    if (Number(poolAtaInfo.amount) < amount) {
      console.error(`❌ Pool has insufficient funds (${poolBal} USDC < $${amount/1e6}). Run setup-agent.js first.`);
      process.exit(1);
    }
  } catch {
    console.error("❌ Pool ATA not found. Run setup-agent.js first.");
    process.exit(1);
  }

  // ── Ensure borrower ATAs exist ─────────────────────────────────────────────
  console.log("\nEnsuring borrower ATAs...");
  const borrowerCollateralAta = await ensureAta(connection, agentKp, borrowerKp.publicKey, USDC_MINT);
  const borrowerLoanAta       = borrowerCollateralAta; // same mint = same ATA in demo
  const vaultCollateralAta    = await ensureAta(connection, agentKp, microLoanPda, USDC_MINT);

  // Borrower must have enough USDC for 110% collateral
  const requiredCollateral = Math.ceil(amount * 1.1);
  try {
    const borrowerAtaInfo = await getAccount(connection, borrowerCollateralAta);
    if (Number(borrowerAtaInfo.amount) < requiredCollateral) {
      console.error(
        `❌ Borrower balance too low (${Number(borrowerAtaInfo.amount) / 1e6} USDC < ${requiredCollateral / 1e6} USDC required).`
      );
      process.exit(1);
    }
  } catch {
    console.error("❌ Could not read borrower collateral ATA balance.");
    process.exit(1);
  }

  // ── Build agent_match_loan instruction ────────────────────────────────────
  // args: amount (u64), term_days (u8), nonce (u64)
  const data = Buffer.concat([
    DISC_MATCH,
    u64LE(amount),
    Buffer.from([termDays]),   // u8
    nonceBuf,                  // u64 LE nonce (already built above)
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: agentKp.publicKey,        isSigner: true,  isWritable: true  }, // agent
      { pubkey: agentConfigPda,           isSigner: false, isWritable: false }, // agent_config
      { pubkey: borrowerKp.publicKey,     isSigner: true,  isWritable: true  }, // borrower
      { pubkey: microLoanPda,             isSigner: false, isWritable: true  }, // micro_loan
      { pubkey: poolStatePda,             isSigner: false, isWritable: true  }, // pool_state
      { pubkey: poolLoanAta,              isSigner: false, isWritable: true  }, // pool_loan_ata
      { pubkey: borrowerCollateralAta,    isSigner: false, isWritable: true  }, // borrower_collateral_ata
      { pubkey: borrowerLoanAta,          isSigner: false, isWritable: true  }, // borrower_loan_ata
      { pubkey: vaultCollateralAta,       isSigner: false, isWritable: true  }, // vault_collateral_ata
      { pubkey: USDC_MINT,                isSigner: false, isWritable: false }, // collateral_mint
      { pubkey: USDC_MINT,                isSigner: false, isWritable: false }, // loan_mint
      { pubkey: TOKEN_PROGRAM_ID,         isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,  isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,       isSigner: false, isWritable: false },
    ],
    data,
  });

  const signers = isSelfDemo ? [agentKp] : [agentKp, borrowerKp];

  console.log("\nSubmitting agent_match_loan...");
  const sig = await sendAndConfirm(connection, new Transaction().add(ix), signers);

  console.log("\n✓ Loan matched!");
  console.log("  Tx        :", sig);
  console.log("  Loan PDA  :", microLoanPda.toBase58());
  console.log(`  Amount    : $${amount/1e6} USDC`);
  console.log(`  Term      : ${termDays} days`);
  console.log(`  Collateral: $${(amount * 1.1 / 1e6).toFixed(2)} USDC (110%)`);
  console.log("\nExplorer:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch(e => { console.error("\n❌ Error:", e.message, "\n", e); process.exit(1); });
