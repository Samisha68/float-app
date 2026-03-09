/**
 * Float AI Agent — Solana Agent Kit + OpenAI
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... \
 *   AGENT_KEYPAIR=./agent.json \
 *   BORROWER=<pubkey> \
 *   AMOUNT=10000000 TERM_DAYS=3 NONCE=1 \
 *   node scripts/ai-agent.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const path = require("path");
const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { getAssociatedTokenAddress } = require("@solana/spl-token");
const OpenAI = require("openai").default ?? require("openai");
const { SolanaAgentKit, KeypairWallet } = require("solana-agent-kit");
const TokenPlugin = require("@solana-agent-kit/plugin-token").default ?? require("@solana-agent-kit/plugin-token");
const MiscPlugin = require("@solana-agent-kit/plugin-misc").default ?? require("@solana-agent-kit/plugin-misc");

const PROGRAM_ID = new PublicKey("AeWSncwhRY2TyRnM7UByjhmmcgE8rrbMs9y8vwJomgmX");
const USDC_MINT = new PublicKey(
  process.env.LOAN_MINT || "7whbViYZqoGxZ7B32crtGEcyCJEDZNPrqSQxm9LUUtGX"
);
const MICRO_POOL_SEED = Buffer.from("micro_pool");
const MICRO_LOAN_SEED = Buffer.from("micro_loan");
const AGENT_CONFIG_SEED = Buffer.from("agent_config");
const RPC = process.env.RPC || "https://api.devnet.solana.com";

function loadKeypair(envVar, fallback) {
  const p = process.env[envVar] || fallback;
  if (!p || !fs.existsSync(p)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function log(icon, msg) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}] ${icon}  ${msg}`);
}

function createToolDefinitions(collateralRequired) {
  return [
    {
      type: "function",
      function: {
        name: "check_wallet_age",
        description: "Check wallet age from first tx date.",
        parameters: {
          type: "object",
          properties: {
            wallet_address: { type: "string" },
          },
          required: ["wallet_address"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_usdc_balance",
        description: "Check borrower's USDC balance via Solana Agent Kit.",
        parameters: {
          type: "object",
          properties: {
            wallet_address: { type: "string" },
          },
          required: ["wallet_address"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_pool_liquidity",
        description: "Check Float pool USDC liquidity via Solana Agent Kit.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "approve_loan",
        description: "Approve and execute agent_match_loan on-chain.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string" },
            risk_score: { type: "number" },
          },
          required: ["reason", "risk_score"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "reject_loan",
        description: `Reject if risk is high or balance < ${collateralRequired.toFixed(2)} USDC.`,
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string" },
            risk_score: { type: "number" },
          },
          required: ["reason", "risk_score"],
        },
      },
    },
  ];
}

async function checkWalletAge(connection, pubkeyStr) {
  log("🔍", `Checking wallet age: ${pubkeyStr.slice(0, 8)}...`);
  try {
    const pubkey = new PublicKey(pubkeyStr);
    const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 1000 });
    if (!sigs || sigs.length === 0) return { ageDays: 0, firstTxDate: null, found: false };
    const oldest = sigs[sigs.length - 1];
    if (!oldest.blockTime) return { ageDays: 0, firstTxDate: null, found: false };
    const ageDays = Math.floor((Date.now() / 1000 - oldest.blockTime) / 86400);
    const firstTxDate = new Date(oldest.blockTime * 1000).toISOString().substring(0, 10);
    log("✓ ", `Wallet age: ${ageDays} days (first tx: ${firstTxDate})`);
    return { ageDays, firstTxDate, found: true };
  } catch (e) {
    return { ageDays: 0, firstTxDate: null, found: false, error: e.message };
  }
}

async function checkUsdcBalance(agentKit, pubkeyStr) {
  log("💰", `Checking USDC via Solana Agent Kit: ${pubkeyStr.slice(0, 8)}...`);
  try {
    const wallet = new PublicKey(pubkeyStr);
    const balanceUsdc = await agentKit.methods.get_balance_other(agentKit, wallet, USDC_MINT);
    log("✓ ", `USDC balance: $${Number(balanceUsdc).toFixed(2)}`);
    return { balanceUsdc: Number(balanceUsdc), source: "solana-agent-kit" };
  } catch (e) {
    return { balanceUsdc: 0, source: "solana-agent-kit", error: e.message };
  }
}

async function checkPoolLiquidity(agentKit) {
  log("🏦", "Checking pool liquidity via Solana Agent Kit...");
  try {
    const [poolStatePda] = PublicKey.findProgramAddressSync([MICRO_POOL_SEED], PROGRAM_ID);
    const balanceUsdc = await agentKit.methods.get_balance_other(agentKit, poolStatePda, USDC_MINT);
    log("✓ ", `Pool liquidity: $${Number(balanceUsdc).toFixed(2)} USDC`);
    return { balanceUsdc: Number(balanceUsdc), source: "solana-agent-kit" };
  } catch (e) {
    return { balanceUsdc: 0, source: "solana-agent-kit", error: e.message };
  }
}

async function approveLoan(connection, agentKp, borrowerKp, amount, termDays, nonce) {
  log("⛓ ", `Executing agent_match_loan: $${amount / 1e6} USDC, ${termDays}d, nonce=${nonce}`);
  const [poolStatePda] = PublicKey.findProgramAddressSync([MICRO_POOL_SEED], PROGRAM_ID);
  const [agentConfigPda] = PublicKey.findProgramAddressSync([AGENT_CONFIG_SEED], PROGRAM_ID);
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  const [microLoanPda] = PublicKey.findProgramAddressSync(
    [MICRO_LOAN_SEED, borrowerKp.publicKey.toBuffer(), USDC_MINT.toBuffer(), nonceBuf],
    PROGRAM_ID
  );

  const poolLoanAta = await getAssociatedTokenAddress(USDC_MINT, poolStatePda, true);
  const borrowerCollateralAta = await getAssociatedTokenAddress(USDC_MINT, borrowerKp.publicKey);
  const borrowerLoanAta = await getAssociatedTokenAddress(USDC_MINT, borrowerKp.publicKey);
  const vaultCollateralAta = await getAssociatedTokenAddress(USDC_MINT, microLoanPda, true);

  const idlPath = path.join(__dirname, "../target/idl/float.json");
  if (!fs.existsSync(idlPath)) throw new Error("IDL not found. Run `anchor build` first.");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: agentKp.publicKey,
      signTransaction: async (tx) => {
        tx.partialSign(agentKp);
        if (!borrowerKp.publicKey.equals(agentKp.publicKey)) tx.partialSign(borrowerKp);
        return tx;
      },
      signAllTransactions: async (txs) =>
        txs.map((tx) => {
          tx.partialSign(agentKp);
          if (!borrowerKp.publicKey.equals(agentKp.publicKey)) tx.partialSign(borrowerKp);
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

  const signers = borrowerKp.publicKey.equals(agentKp.publicKey) ? [agentKp] : [agentKp, borrowerKp];
  const sig = await connection.sendTransaction(tx, signers, { skipPreflight: false });
  const conf = await connection.confirmTransaction(sig, "confirmed");
  if (conf.value.err) {
    throw new Error(`Transaction ${sig} failed: ${JSON.stringify(conf.value.err)}`);
  }
  return { success: true, signature: sig, microLoanPda: microLoanPda.toBase58() };
}

async function main() {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.error("OPENAI_API_KEY not set. Copy .env.example -> .env and add your key.");
    process.exit(1);
  }

  const agentKp = loadKeypair("AGENT_KEYPAIR", path.join(__dirname, "../agent.json"));
  if (!agentKp) {
    console.error("AGENT_KEYPAIR not found. Run setup-agent.js first.");
    process.exit(1);
  }

  const borrowerKp = loadKeypair("BORROWER_KEYPAIR", null) || agentKp;
  const borrowerPubkey = process.env.BORROWER || borrowerKp.publicKey.toBase58();
  const amount = parseInt(process.env.AMOUNT || "10000000", 10);
  const termDays = parseInt(process.env.TERM_DAYS || "3", 10);
  const nonce = parseInt(process.env.NONCE || "1", 10);
  const collateralRequired = (amount * 1.1) / 1e6;

  const connection = new Connection(RPC, "confirmed");
  const wallet = new KeypairWallet(agentKp, RPC);
  const agentKit = new SolanaAgentKit(wallet, RPC, { OPENAI_API_KEY: openaiKey })
    .use(TokenPlugin)
    .use(MiscPlugin);
  const openai = new OpenAI({ apiKey: openaiKey });
  const toolDefinitions = createToolDefinitions(collateralRequired);

  log("🤖", `Agent  : ${agentKp.publicKey.toBase58().slice(0, 16)}...`);
  log("👤", `Borrower: ${borrowerPubkey.slice(0, 16)}...`);
  log("💵", `Request : $${amount / 1e6} USDC, ${termDays} days`);
  log("🧰", "Solana Agent Kit initialized with token + misc plugins");

  const messages = [
    {
      role: "system",
      content: `You are Float's autonomous lending agent on Solana devnet.
Rules:
- Wallet age >= 30 days: low risk
- Wallet age 7-29 days: medium risk
- Wallet age < 7 days: reject
- Borrower must hold at least ${collateralRequired.toFixed(2)} USDC for collateral
- Pool must have sufficient liquidity
Always call check_wallet_age, check_usdc_balance, check_pool_liquidity before deciding.
Return approve_loan or reject_loan with a risk_score from 0 to 1.`,
    },
    {
      role: "user",
      content: `Evaluate:
Borrower: ${borrowerPubkey}
Amount: $${amount / 1e6}
Term: ${termDays} days
Collateral required: $${collateralRequired.toFixed(2)} USDC`,
    },
  ];

  let finalDecision = null;
  let iterations = 0;
  const maxIterations = 10;

  while (!finalDecision && iterations < maxIterations) {
    iterations += 1;
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: toolDefinitions,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls || msg.tool_calls.length === 0) break;

    for (const toolCall of msg.tool_calls) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || "{}");
      let result = { ok: false };

      if (name === "check_wallet_age") {
        result = await checkWalletAge(connection, args.wallet_address);
      } else if (name === "check_usdc_balance") {
        result = await checkUsdcBalance(agentKit, args.wallet_address);
      } else if (name === "check_pool_liquidity") {
        result = await checkPoolLiquidity(agentKit);
      } else if (name === "approve_loan") {
        try {
          const execResult = await approveLoan(connection, agentKp, borrowerKp, amount, termDays, nonce);
          finalDecision = { approved: true, ...args, ...execResult };
          result = execResult;
        } catch (e) {
          finalDecision = { approved: false, reason: e.message };
          result = { success: false, error: e.message };
        }
      } else if (name === "reject_loan") {
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

  if (finalDecision?.approved) {
    console.log(`\nRESULT: APPROVED\nTx: ${finalDecision.signature}\n`);
  } else {
    console.log(`\nRESULT: REJECTED\nReason: ${finalDecision?.reason || "Unknown"}\n`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e.message || e);
  process.exit(1);
});
