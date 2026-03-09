# AI-Agent Managed Micro-Lending — Setup & Demo (MONOLITH Hackathon)

## Overview

Float adds **AI-Agent Managed Micro-Lending**: a liquidity pool where lenders deposit USDC and an (MVP) rule-based agent matches micro-loans ($1–$100, 1–7 days) with 110% mini-collateral. Caps: $100/loan, 10% of pool per loan.

## 1. Program build & deploy (Anchor)

```bash
cd program
anchor build
# If IDL generation fails at test step, the .so is still in target/deploy/
anchor deploy --provider.cluster devnet
# Note the program id; update Anchor.toml and app/src/utils/constants.ts FLOAT_PROGRAM_ID if you deployed a new program.
```

## 2. One-time program setup (Devnet)

Run these once per deployment:

### 2.1 Initialize micro-pool

Creates the pool PDA and pool USDC ATA. Payer must have SOL for rent.

```bash
cd program
# Use ts-node or a small script that calls initializeMicroPool
# Or use the app: we can add a "Bootstrap pool" button that calls initialize_micro_pool (requires one-time payer).
```

Example (Node script or use Solana Explorer + Anchor IDL):

- **initialize_micro_pool**: accounts: payer, pool_state (PDA), loan_mint (USDC), pool_loan_ata (ATA pool_state + USDC), token_program, associated_token_program, system_program.

### 2.2 Initialize agent config

Set the pubkey that is allowed to call `agent_match_loan` (your “agent” keypair).

```bash
# Generate agent keypair: solana-keygen new -o agent.json
# Then call initialize_agent_config(agent_pubkey) with admin signer.
```

## 3. Bootstrap liquidity (demo)

- **Option A**: Use the app: connect wallet with test USDC, open **AI Pool** tab → **Deposit to pool** (e.g. $50–200 USDC).
- **Option B**: Run a script that deposits from a funded wallet to the pool via `deposit_to_pool`.

## 4. Agent match (rule-based MVP)

The “agent” is a keypair that signs `agent_match_loan`. For MVP we use a **local script** (no backend).

1. Borrower has USDC for 110% collateral and requests a micro-loan (e.g. $10, 3 days).
2. Run the agent script with the agent keypair and borrower pubkey; script can check wallet age via RPC (e.g. first tx time) and then call `agent_match_loan(amount, term_days, nonce)`.

```bash
cd program
AGENT_KEYPAIR=./agent.json BORROWER=<borrower_pubkey> AMOUNT=10000000 TERM_DAYS=3 NONCE=1 node scripts/agent-match.js
```

(Implement `scripts/agent-match.js` to build and send the tx; see below.)

## 4.1 AI agent with Solana Agent Kit

Float now includes `program/scripts/ai-agent.js` wired to **Solana Agent Kit** (`solana-agent-kit` + token/misc plugins) for on-chain signal checks before executing `agent_match_loan`.

Install dependencies:

```bash
cd program
npm install
```

Run AI decision + execution:

```bash
cd program
OPENAI_API_KEY=sk-... \
AGENT_KEYPAIR=./demo-wallet.json \
BORROWER=<borrower_pubkey> \
AMOUNT=10000000 TERM_DAYS=3 NONCE=1 \
node scripts/ai-agent.js
```

What uses Solana Agent Kit:
- Borrower USDC balance check (`get_balance_other`)
- Pool liquidity check (`get_balance_other`)
- Plugin-ready architecture for adding extra risk signals later

## 5. App (Expo / React Native)

```bash
cd app
npm install
npx expo start
# For real wallet (MWA): eas build --profile development
```

- **Home**: Classic Float loans (collateral → loan → repay → withdraw).
- **AI** tab: Pool balance, **Deposit to pool**, **Set agent preferences**, **Agent status**, and **My micro-loans** (Repay / Withdraw collateral after repay).
- **Agent status** now supports real execution: enter amount/term/nonce and run `agent_match_loan` directly from the connected authorized agent wallet (self-agent mode).

## 6. Testing checklist (Devnet)

1. **Pool**
   - Initialize micro-pool (once).
   - Initialize agent config with agent pubkey (once).
   - Deposit to pool from app or script → confirm pool balance in app.

2. **Agent**
   - Run agent-match script for a borrower (with 110% USDC collateral) → micro-loan appears in **My micro-loans**.

3. **Borrower**
   - Repay micro-loan from app (**Repay** on the loan card).
   - After repay, **Withdraw collateral** (add a small flow or reuse repay screen with mode “withdraw” for micro).

4. **Liquidate**
   - Wait until `due_at + grace` (1 day) and call `liquidate_micro_loan` (anyone) to send collateral to pool.

## 7. Demo script (2‑min video)

1. Connect wallet (Phantom / MWA).
2. **AI Pool** → show pool balance.
3. **Deposit to pool** → e.g. $50 USDC → confirm.
4. **Set agent preferences** → e.g. $50 max, 5% APR, Low risk → Save.
5. **Agent status** → show “Scanning…” / “Matched loan” and **Pause agent** (human override).
6. (If a micro-loan exists) **My micro-loans** → **Repay** → confirm.
7. Optional: **Home** → show classic Float loan flow.

## 8. Pitch one-liner & AI innovation

- **One-liner**: “Float: Collateral-backed installment loans on Solana — now with AI-agent managed micro-lending and a liquidity pool for autonomous yield.”
- **AI innovation**: “We delegate matching and monitoring of micro-loans ($1–$100, 1–7 days) to an on-chain–authorized agent. Lenders set preferences (amount, APR, risk); the agent scans on-chain data (MVP: rule-based; later: wallet history / default prediction), caps exposure (10% of pool per loan, $100 max), and supports human override (pause agent). Verifiable compute and Certik audit planned post-hackathon.”
