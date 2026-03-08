/**
 * Float AI Agent — Solana Agent Kit + OpenAI
 *
 * Uses OpenAI function-calling to analyze borrower wallets on-chain
 * and autonomously decide whether to approve micro-loans.
 *
 * Architecture:
 *   LLM (GPT-4o) ──calls──▶ tools (real on-chain checks via RPC)
 *                                   │
 *                          approve_loan ──▶ agent_match_loan (on-chain)
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... \
 *   AGENT_KEYPAIR=./agent.json \
 *   BORROWER=<pubkey> \
 *   AMOUNT=10000000 TERM_DAYS=3 NONCE=1 \
 *   node scripts/ai-agent.js
 *
 * The AI will:
 *   1. Check borrower's wallet age (first tx timestamp)
 *   2. Check borrower's USDC balance (can they afford 110% collateral?)
 *   3. Decide approve/reject with reasoning
 *   4. If approved: execute agent_match_loan on devnet
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const path = require("path");
const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { getAssociatedTokenAddress, getAccount } = require("@solana/spl-token");
const OpenAI = require("openai").default ?? require("openai");

// ── Constants ──────────────────────────────────────────────────────────────
const PROGRAM_ID        = new PublicKey("AeWSncwhRY2TyRnM7UByjhmmcgE8rrbMs9y8vwJomgmX");
const USDC_MINT         = new PublicKey("7whbViYZqoGxZ7B32crtGEcyCJEDZNPrqSQxm9LUUtGX");
const MICRO_POOL_SEED   = Buffer.from("micro_pool");
const MICRO_LOAN_SEED   = Buffer.from("micro_loan");
const AGENT_CONFIG_SEED = Buffer.from("agent_config");
const RPC               = process.env.RPC || "https://api.devnet.solana.com";

// ── Helpers ────────────────────────────────────────────────────────────────
function loadKeypair(envVar, fallback) {
  const p = process.env[envVar] || fallback;
  if (!p || !fs.existsSync(p)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function log(icon, msg) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}] ${icon}  ${msg}`);
}

// ── On-chain Tools (what the AI can call) ─────────────────────────────────

/**
 * Tool 1: Get wallet age in days (based on first ever transaction).
 * Proxy for creditworthiness — older wallet = lower risk.
 */
async function checkWalletAge(connection, pubkeyStr) {
  log("🔍", `Checking wallet age: ${pubkeyStr.slice(0, 8)}...`);
  try {
    const pubkey = new PublicKey(pubkeyStr);
    // Fetch the oldest signatures for this wallet
    const sigs = await connection.getSignaturesForAddress(pubkey, {
      limit: 1000,
      before: undefined,
    });
    if (!sigs || sigs.length === 0) {
      log("⚠️ ", "No transaction history found");
      return { ageDays: 0, firstTxDate: null, found: false };
    }
    // The last signature in the array is the oldest
    const oldest = sigs[sigs.length - 1];
    const firstTxTimestamp = oldest.blockTime;
    if (!firstTxTimestamp) {
      return { ageDays: 0, firstTxDate: null, found: false };
    }
    const ageDays = Math.floor((Date.now() / 1000 - firstTxTimestamp) / 86400);
    const firstTxDate = new Date(firstTxTimestamp * 1000).toISOString().substring(0, 10);
    log("✓ ", `Wallet age: ${ageDays} days (first tx: ${firstTxDate})`);
    return { ageDays, firstTxDate, found: true };
  } catch (e) {
    log("✗ ", `Wallet age check failed: ${e.message}`);
    return { ageDays: 0, firstTxDate: null, found: false, error: e.message };
  }
}

/**
 * Tool 2: Get borrower's USDC balance.
 * Required to verify they can post the 110% collateral.
 */
async function checkUsdcBalance(connection, pubkeyStr) {
  log("💰", `Checking USDC balance: ${pubkeyStr.slice(0, 8)}...`);
  try {
    const pubkey = new PublicKey(pubkeyStr);
    const ata = await getAssociatedTokenAddress(USDC_MINT, pubkey);
    const acct = await getAccount(connection, ata);
    const balanceUsdc = Number(acct.amount) / 1e6;
    log("✓ ", `USDC balance: $${balanceUsdc.toFixed(2)}`);
    return { balanceUsdc, balanceLamports: Number(acct.amount), hasAta: true };
  } catch (e) {
    // ATA doesn't exist = zero balance
    log("⚠️ ", "No USDC ATA found (balance: $0.00)");
    return { balanceUsdc: 0, balanceLamports: 0, hasAta: false };
  }
}

/**
 * Tool 3: Get pool available liquidity.
 */
async function checkPoolLiquidity(connection) {
  log("🏦", "Checking pool liquidity...");
  try {
    const [poolStatePda] = PublicKey.findProgramAddressSync([MICRO_POOL_SEED], PROGRAM_ID);
    const poolLoanAta = await getAssociatedTokenAddress(USDC_MINT, poolStatePda, true);
    const acct = await getAccount(connection, poolLoanAta);
    const balanceUsdc = Number(acct.amount) / 1e6;
    log("✓ ", `Pool liquidity: $${balanceUsdc.toFixed(2)} USDC`);
    return { balanceUsdc, balanceLamports: Number(acct.amount) };
  } catch (e) {
    log("⚠️ ", `Pool check failed: ${e.message}`);
    return { balanceUsdc: 0, balanceLamports: 0, error: e.message };
  }
}

/**
 * Tool 4: Approve and execute the loan on-chain.
 */
async function approveLoan(connection, agentKp, borrowerKp, amount, termDays, nonce) {
  log("⛓ ", `Executing agent_match_loan: $${amount/1e6} USDC, ${termDays}d, nonce=${nonce}`);

  const [poolStatePda]  = PublicKey.findProgramAddressSync([MICRO_POOL_SEED], PROGRAM_ID);
  const [agentConfigPda] = PublicKey.findProgramAddressSync([AGENT_CONFIG_SEED], PROGRAM_ID);
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  const [microLoanPda] = PublicKey.findProgramAddressSync(
    [MICRO_LOAN_SEED, borrowerKp.publicKey.toBuffer(), USDC_MINT.toBuffer(), nonceBuf],
    PROGRAM_ID
  );

  const poolLoanAta           = await getAssociatedTokenAddress(USDC_MINT, poolStatePda, true);
  const borrowerCollateralAta = await getAssociatedTokenAddress(USDC_MINT, borrowerKp.publicKey);
  const borrowerLoanAta       = await getAssociatedTokenAddress(USDC_MINT, borrowerKp.publicKey);
  const vaultCollateralAta    = await getAssociatedTokenAddress(USDC_MINT, microLoanPda, true);

  const idlPath = path.join(__dirname, "../target/idl/float.json");
  if (!fs.existsSync(idlPath)) throw new Error("IDL not found. Run `anchor build` first.");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: agentKp.publicKey,
      signTransaction: async (tx) => {
        tx.partialSign(agentKp);
        if (borrowerKp.publicKey.toString() !== agentKp.publicKey.toString()) {
          tx.partialSign(borrowerKp);
        }
        return tx;
      },
      signAllTransactions: async (txs) => txs.map(tx => {
        tx.partialSign(agentKp);
        if (borrowerKp.publicKey.toString() !== agentKp.publicKey.toString()) {
          tx.partialSign(borrowerKp);
        }
        return tx;
      }),
    },
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  const tx = await program.methods
    .agentMatchLoan(new anchor.BN(amount), termDays, new anchor.BN(nonce))
    .accounts({
      agent: agentKp.publicKey,
      agentConfig: agentConfigPda,
      borrower: borrowerKp.publicKey,
      microLoan: microLoanPda,
      poolState: poolStatePda,
      poolLoanAta,
      borrowerCollateralAta,
      borrowerLoanAta,
      vaultCollateralAta,
      collateralMint: USDC_MINT,
      loanMint: USDC_MINT,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .transaction();

  const signers = borrowerKp.publicKey.toString() !== agentKp.publicKey.toString()
    ? [agentKp, borrowerKp] : [agentKp];

  const sig = await connection.sendTransaction(tx, signers, { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return { success: true, signature: sig, microLoanPda: microLoanPda.toBase58() };
}

// ── OpenAI tool definitions ────────────────────────────────────────────────
const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "check_wallet_age",
      description: "Check how old a Solana wallet is by looking at its first transaction. Older wallets are lower risk.",
      parameters: {
        type: "object",
        properties: {
          wallet_address: { type: "string", description: "The borrower's Solana wallet public key (base58)" },
        },
        required: ["wallet_address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_usdc_balance",
      description: "Check how much USDC a borrower holds. Used to verify they can post the required 110% collateral.",
      parameters: {
        type: "object",
        properties: {
          wallet_address: { type: "string", description: "The borrower's Solana wallet public key (base58)" },
        },
        required: ["wallet_address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_pool_liquidity",
      description: "Check how much USDC is available in the Float lending pool.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_loan",
      description: "Approve and execute the micro-loan on-chain. Only call this after completing all risk checks.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Brief reason for approval" },
          risk_score: { type: "number", description: "Risk score 0.0 (lowest) to 1.0 (highest)" },
        },
        required: ["reason", "risk_score"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_loan",
      description: "Reject the loan request due to insufficient creditworthiness.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Brief reason for rejection" },
          risk_score: { type: "number", description: "Risk score 0.0 (lowest) to 1.0 (highest)" },
        },
        required: ["reason", "risk_score"],
      },
    },
  },
];

// ── Main AI agent loop ─────────────────────────────────────────────────────
async function main() {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.error("OPENAI_API_KEY not set. Copy .env.example → .env and add your key.");
    process.exit(1);
  }

  const agentKp = loadKeypair("AGENT_KEYPAIR", path.join(__dirname, "../agent.json"));
  if (!agentKp) { console.error("AGENT_KEYPAIR not found. Run setup-agent.js first."); process.exit(1); }

  const borrowerKp = loadKeypair("BORROWER_KEYPAIR", null) || agentKp;
  const borrowerPubkey = (process.env.BORROWER) || borrowerKp.publicKey.toBase58();

  const amount   = parseInt(process.env.AMOUNT   || "10000000", 10);
  const termDays = parseInt(process.env.TERM_DAYS || "3", 10);
  const nonce    = parseInt(process.env.NONCE     || "1", 10);

  const connection = new Connection(RPC, "confirmed");
  const openai = new OpenAI({ apiKey: openaiKey });

  const collateralRequired = (amount * 1.1) / 1e6;

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║       Float AI Agent — Solana Agent Kit  ║");
  console.log("╚══════════════════════════════════════════╝\n");
  log("🤖", `Agent  : ${agentKp.publicKey.toBase58().slice(0, 16)}...`);
  log("👤", `Borrower: ${borrowerPubkey.slice(0, 16)}...`);
  log("💵", `Request : $${amount/1e6} USDC, ${termDays} days`);
  log("🔒", `Collateral required: $${collateralRequired.toFixed(2)} USDC (110%)`);
  console.log();

  // ── Agentic loop: LLM calls tools until it decides approve/reject ──────────
  const messages = [
    {
      role: "system",
      content: `You are Float's autonomous lending agent running on Solana devnet.
You evaluate micro-loan requests ($1-$100 USDC, 1-7 days) using on-chain data.

Risk policy:
- Wallet age >= 30 days: LOW risk
- Wallet age 7-29 days: MEDIUM risk  
- Wallet age < 7 days: HIGH risk (reject)
- USDC balance must cover ${collateralRequired.toFixed(2)} USDC collateral (110% of loan)
- Pool must have sufficient liquidity

Always: (1) check wallet age, (2) check USDC balance, (3) check pool liquidity, 
then either approve_loan or reject_loan with a risk_score between 0.0 and 1.0.
Be concise and decisive.`,
    },
    {
      role: "user",
      content: `Evaluate loan request:
- Borrower: ${borrowerPubkey}
- Amount: $${amount/1e6} USDC
- Term: ${termDays} days
- Collateral needed: $${collateralRequired.toFixed(2)} USDC (110%)

Check their on-chain data and make a lending decision.`,
    },
  ];

  log("🤖", "Starting AI reasoning loop (GPT-4o)...\n");

  let finalDecision = null;
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (!finalDecision && iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    // No tool calls = LLM is done reasoning (shouldn't happen before approve/reject)
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      log("🤖", `AI reasoning: ${msg.content}`);
      break;
    }

    // Process each tool call
    for (const toolCall of msg.tool_calls) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || "{}");
      let result;

      if (name === "check_wallet_age") {
        result = await checkWalletAge(connection, args.wallet_address);
      } else if (name === "check_usdc_balance") {
        result = await checkUsdcBalance(connection, args.wallet_address);
      } else if (name === "check_pool_liquidity") {
        result = await checkPoolLiquidity(connection);
      } else if (name === "approve_loan") {
        log("✅", `AI APPROVED — risk score: ${args.risk_score.toFixed(2)}`);
        log("🤖", `Reason: ${args.reason}`);
        console.log();
        try {
          const execResult = await approveLoan(
            connection, agentKp, borrowerKp, amount, termDays, nonce
          );
          log("🎉", `Loan matched on-chain!`);
          log("📝", `Tx: ${execResult.signature}`);
          log("📍", `MicroLoan PDA: ${execResult.microLoanPda}`);
          finalDecision = { approved: true, ...args, ...execResult };
          result = execResult;
        } catch (e) {
          log("✗ ", `On-chain execution failed: ${e.message}`);
          result = { success: false, error: e.message };
          finalDecision = { approved: false, error: e.message };
        }
      } else if (name === "reject_loan") {
        log("❌", `AI REJECTED — risk score: ${args.risk_score.toFixed(2)}`);
        log("🤖", `Reason: ${args.reason}`);
        finalDecision = { approved: false, ...args };
        result = { rejected: true };
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  console.log("\n══════════════════════════════════════════");
  if (finalDecision?.approved) {
    console.log("  RESULT: ✅ LOAN APPROVED & EXECUTED");
    console.log(`  Tx: ${finalDecision.signature}`);
  } else {
    console.log("  RESULT: ❌ LOAN REJECTED");
    console.log(`  Reason: ${finalDecision?.reason || "Unknown"}`);
  }
  console.log("══════════════════════════════════════════\n");
}

main().catch(e => {
  console.error("Fatal error:", e.message || e);
  process.exit(1);
});
