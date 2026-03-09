/**
 * Float — One-time devnet setup (raw transactions, no Anchor IDL needed)
 * Usage:
 *   ADMIN_KEYPAIR=./demo-wallet.json AGENT_KEYPAIR=./demo-wallet.json DEPOSIT_USDC=100 node scripts/setup-agent.js
 */

const fs = require("fs");
const path = require("path");
const {
  Connection, Keypair, PublicKey, SystemProgram,
  TransactionInstruction, Transaction, SYSVAR_RENT_PUBKEY,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddress, getAccount,
  createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");

// ── Constants ─────────────────────────────────────────────────────────────────
const PROGRAM_ID       = new PublicKey("AeWSncwhRY2TyRnM7UByjhmmcgE8rrbMs9y8vwJomgmX");
const USDC_MINT        = new PublicKey(
  process.env.LOAN_MINT || "7whbViYZqoGxZ7B32crtGEcyCJEDZNPrqSQxm9LUUtGX"
);
const MICRO_POOL_SEED  = Buffer.from("micro_pool");
const AGENT_CFG_SEED   = Buffer.from("agent_config");

// Anchor discriminators (sha256("global:<name>")[0..8])
const DISC_INIT_POOL   = Buffer.from([228,183,162,169,214,166,22,95]);
const DISC_INIT_AGENT  = Buffer.from([196,140,148,118,209,82,61,18]);
const DISC_DEPOSIT     = Buffer.from([99,136,15,66,85,146,24,89]);

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
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  if (conf.value.err) {
    throw new Error(`Transaction ${sig} failed: ${JSON.stringify(conf.value.err)}`);
  }
  return sig;
}

async function ensureAta(connection, payer, owner, mint, signers) {
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
  const rpc = process.env.RPC || "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");

  const adminKp = loadKeypair("ADMIN_KEYPAIR", path.join(__dirname, "../demo-wallet.json"));
  const agentKp = loadKeypair("AGENT_KEYPAIR", path.join(__dirname, "../demo-wallet.json"));
  const depositUsdc = parseFloat(process.env.DEPOSIT_USDC || "0");

  console.log("\n=== Float Setup ===");
  console.log("Admin :", adminKp.publicKey.toBase58());
  console.log("Agent :", agentKp.publicKey.toBase58());
  console.log("USDC  :", USDC_MINT.toBase58());
  console.log("RPC   :", rpc);

  const [poolStatePda] = PublicKey.findProgramAddressSync([MICRO_POOL_SEED], PROGRAM_ID);
  const [agentConfigPda] = PublicKey.findProgramAddressSync([AGENT_CFG_SEED], PROGRAM_ID);
  let poolLoanAta = await getAssociatedTokenAddress(USDC_MINT, poolStatePda, true);

  // ── 0. Ensure pool ATA exists (in case pool was init'd but ATA missing) ─────
  const poolAtaInfo = await connection.getAccountInfo(poolLoanAta);
  if (!poolAtaInfo && (await connection.getAccountInfo(poolStatePda))) {
    console.log("\nStep 0: Creating pool USDC ATA (pool exists but ATA missing)...");
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(adminKp.publicKey, poolLoanAta, poolStatePda, USDC_MINT)
    );
    await sendAndConfirm(connection, tx, [adminKp]);
    console.log("✓ Pool ATA created:", poolLoanAta.toBase58());
  }

  // ── 1. Initialize micro pool ───────────────────────────────────────────────
  const poolInfo = await connection.getAccountInfo(poolStatePda);
  if (poolInfo) {
    console.log("\n✓ Pool already initialized:", poolStatePda.toBase58());
  } else {
    console.log("\nStep 1: Initializing micro pool...");
    const data = DISC_INIT_POOL; // no args
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: adminKp.publicKey, isSigner: true,  isWritable: true  }, // payer
        { pubkey: poolStatePda,      isSigner: false, isWritable: true  }, // pool_state
        { pubkey: USDC_MINT,         isSigner: false, isWritable: false }, // loan_mint
        { pubkey: poolLoanAta,       isSigner: false, isWritable: true  }, // pool_loan_ata
        { pubkey: TOKEN_PROGRAM_ID,  isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const sig = await sendAndConfirm(connection, new Transaction().add(ix), [adminKp]);
    console.log("✓ Pool initialized! Tx:", sig);
  }

  // ── 2. Initialize agent config ─────────────────────────────────────────────
  const cfgInfo = await connection.getAccountInfo(agentConfigPda);
  if (cfgInfo) {
    console.log("✓ Agent config already set:", agentConfigPda.toBase58());
  } else {
    console.log("\nStep 2: Setting agent config...");
    // args: authorized_agent (32 bytes pubkey)
    const data = Buffer.concat([DISC_INIT_AGENT, agentKp.publicKey.toBuffer()]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: adminKp.publicKey,  isSigner: true,  isWritable: true  }, // admin
        { pubkey: agentConfigPda,     isSigner: false, isWritable: true  }, // agent_config
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const sig = await sendAndConfirm(connection, new Transaction().add(ix), [adminKp]);
    console.log("✓ Agent config set! Tx:", sig);
  }

  // ── 3. Bootstrap deposit ───────────────────────────────────────────────────
  if (depositUsdc > 0) {
    const amount = Math.floor(depositUsdc * 1e6);
    console.log(`\nStep 3: Depositing ${depositUsdc} USDC to pool...`);

    // Ensure depositor ATA exists
    const depositorAta = await ensureAta(connection, adminKp, adminKp.publicKey, USDC_MINT, [adminKp]);

    // Check balance
    const ataInfo = await getAccount(connection, depositorAta);
    if (Number(ataInfo.amount) < amount) {
      console.warn(`⚠ Admin USDC balance (${Number(ataInfo.amount)/1e6}) < ${depositUsdc}. Skipping.`);
    } else {
      // args: amount (u64 LE)
      const data = Buffer.concat([DISC_DEPOSIT, u64LE(amount)]);
      const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: adminKp.publicKey, isSigner: true,  isWritable: true  }, // depositor
          { pubkey: poolStatePda,      isSigner: false, isWritable: true  }, // pool_state
          { pubkey: depositorAta,      isSigner: false, isWritable: true  }, // depositor_ata
          { pubkey: poolLoanAta,       isSigner: false, isWritable: true  }, // pool_loan_ata
          { pubkey: USDC_MINT,         isSigner: false, isWritable: false }, // loan_mint
          { pubkey: TOKEN_PROGRAM_ID,  isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });
      const sig = await sendAndConfirm(connection, new Transaction().add(ix), [adminKp]);
      console.log(`✓ Deposited ${depositUsdc} USDC! Tx:`, sig);
    }
  }

  console.log("\n=== Setup Complete ===");
  console.log("Pool PDA      :", poolStatePda.toBase58());
  console.log("Agent Config  :", agentConfigPda.toBase58());
  console.log("Pool USDC ATA :", poolLoanAta.toBase58());
  console.log("\nNext: run agent-match.js to create demo loans");
}

main().catch(e => { console.error("\n❌ Error:", e.message); process.exit(1); });
