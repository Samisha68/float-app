# Float — AI-Native Micro-Lending on Solana

> MONOLITH Solana Mobile Hackathon · March 2026

Float is a Solana mobile lending app with two lending modes:

1. **Classic collateralized installment loans** (borrow, repay EMI, withdraw collateral)
2. **AI-agent managed micro-loans** (pool-based liquidity, small short-term loans, autonomous matching)

The app is non-custodial, runs on Solana Devnet, and is built as a mobile-first Expo app with an Anchor program.

---

## What We Built

### 1) Classic loan engine (on-chain)
- Borrower locks collateral (currently USDC in hackathon scope)
- Protocol disburses USDC loan
- Borrower repays monthly installments
- Loan can be liquidated after grace period
- Full repayment unlocks collateral withdrawal

Core instructions:
- `initialize_loan`
- `repay_installment`
- `liquidate`
- `withdraw_collateral`

### 2) AI micro-lending engine (on-chain + agent)
- Lenders deposit USDC to a shared micro-pool
- Authorized agent matches micro-loans
- Borrower posts **110% mini-collateral**
- Loan caps:
  - max `$100`
  - max `10%` pool exposure per loan
  - term `1-7` days
- Borrower repays in full, then withdraws collateral
- Overdue micro-loans can be liquidated to pool

Core instructions:
- `initialize_micro_pool`
- `initialize_agent_config`
- `update_agent_config`
- `deposit_to_pool`
- `agent_match_loan`
- `repay_micro_loan`
- `withdraw_collateral_micro`
- `liquidate_micro_loan`

---

## How We Utilized Solana App Kit (Mobile Stack)

In Float, the “Solana App Kit” layer is implemented through Solana Mobile wallet integration and mobile-ready Solana runtime wiring.

### Wallet and signing flow (Mobile Wallet Adapter)
Using:
- `@solana-mobile/mobile-wallet-adapter-protocol`
- `@solana-mobile/mobile-wallet-adapter-protocol-web3js`

Implemented in [app/src/hooks/useWallet.ts](/Users/samisha/Projects/Float/app/src/hooks/useWallet.ts):
- Authorize + silent reauthorize with app identity
- Base64 MWA address conversion to `PublicKey`
- Build transaction **before** wallet session
- Simulate transaction before sign/send
- Use `signTransactions` (not `signAndSendTransactions`) to avoid wallet-side timeout issues
- Send signed raw transaction directly with `@solana/web3.js`

### Solana/Anchor compatibility in React Native
Implemented in:
- [app/App.tsx](/Users/samisha/Projects/Float/app/App.tsx)
- [app/metro.config.js](/Users/samisha/Projects/Float/app/metro.config.js)

What we added:
- Required polyfills (`Buffer`, URL, random values)
- Metro aliases for Node built-ins needed by web3/Anchor
- Safe stubs for non-mobile modules (`fs`, `net`, `tls`, etc.)

### App-wide wallet actions
- Central wallet context for connect/disconnect/sign in [app/src/context/WalletContext.tsx](/Users/samisha/Projects/Float/app/src/context/WalletContext.tsx)
- Shared transaction signer used across all loan flows:
  - create loan
  - repay installment
  - withdraw collateral
  - initialize/deposit micro-pool
  - execute agent-matched micro-loans

### Solana mobile UX behavior
- Detects native MWA availability
- Provides mock-wallet fallback for Expo Go UI preview
- Uses dev client / APK for real wallet signing on Android

---

## How We Utilized Solana Agent Kit

Implemented in [program/scripts/ai-agent.js](/Users/samisha/Projects/Float/program/scripts/ai-agent.js).

Using:
- `solana-agent-kit`
- `@solana-agent-kit/plugin-token`
- `@solana-agent-kit/plugin-misc`

### Agent architecture
1. Initialize `SolanaAgentKit` with agent keypair wallet
2. Register token + misc plugins
3. Use AI tool-calling loop (OpenAI) with explicit loan-decision tools
4. Gather on-chain signals before a decision:
   - wallet age (RPC signatures history)
   - borrower USDC balance (`get_balance_other`)
   - pool liquidity (`get_balance_other`)
5. Approve or reject
6. If approved, execute on-chain `agent_match_loan`

### Why Agent Kit is important here
- Gives direct on-chain token signal access for decision-making
- Keeps approval logic + execution tied to real Solana state
- Enables a plugin-ready path for richer risk signals in future versions

---

## System Architecture

- **Smart contract:** Anchor program in [program/programs/float/src/lib.rs](/Users/samisha/Projects/Float/program/programs/float/src/lib.rs)
- **Mobile app:** React Native + Expo in [app](/Users/samisha/Projects/Float/app)
- **Wallet integration:** Solana Mobile Wallet Adapter protocol
- **AI executor:** Node script + Solana Agent Kit
- **Network:** Solana Devnet
- **Loan mint (demo):** Devnet USDC (`7whbViYZqoGxZ7B32crtGEcyCJEDZNPrqSQxm9LUUtGX`)

---

## Quick Start

### Prerequisites
- Solana CLI
- Anchor CLI
- Node.js 18+
- Yarn or npm
- Expo / EAS (for Android build)

### 1) Build and deploy program
```bash
cd program
yarn install
anchor build
anchor deploy --provider.cluster devnet
```

### 2) Run mobile app
```bash
cd app
yarn install
yarn start
```

For real MWA signing, build Android dev client / APK (Expo Go is UI-only fallback).

### 3) Run AI agent flow
```bash
cd program
OPENAI_API_KEY=sk-... \
AGENT_KEYPAIR=./demo-wallet.json \
BORROWER=<borrower_pubkey> \
AMOUNT=10000000 TERM_DAYS=3 NONCE=1 \
node scripts/ai-agent.js
```

Detailed setup and demo steps:
- [docs/AI_MICRO_LENDING_SETUP.md](/Users/samisha/Projects/Float/docs/AI_MICRO_LENDING_SETUP.md)

---

## Repo Structure

```text
Float/
├── program/
│   ├── programs/float/src/lib.rs         # Anchor program
│   ├── scripts/ai-agent.js               # Solana Agent Kit powered agent
│   └── tests/                            # Program tests/scripts
├── app/
│   ├── src/hooks/useWallet.ts            # Mobile wallet adapter integration
│   ├── src/screens/AIPoolDashboardScreen.tsx
│   ├── src/screens/AgentStatusScreen.tsx
│   └── src/screens/RepayMicroScreen.tsx
└── docs/
    └── AI_MICRO_LENDING_SETUP.md
```

---

## Current Hackathon Constraints

- Devnet deployment only
- Demo uses USDC for both collateral and loan in many flows
- Agent preferences are currently local UI settings (not yet fully enforced on-chain)
- Risk model is MVP rule-based + AI tool orchestration

---

## Future Goals

### Protocol roadmap
- Integrate oracle-based collateral pricing (Pyth) for multi-asset collateral
- Dynamic risk-based APR and borrower-specific limits
- Partial repayments and refinance flows
- Liquidator incentives and keeper network
- Move from single-pool MVP to segmented risk tranches

### Agent roadmap
- Production policy engine with deterministic guardrails
- Expanded Solana Agent Kit plugin signals (activity, reputation, volatility)
- On-chain verifiable decision proofs / audit logs
- Multi-agent strategy marketplace (lender-selectable agents)

### Mobile + product roadmap
- Mainnet launch with dApp Store distribution
- Better lender analytics (APY, defaults, utilization)
- Notification + automation loops for due dates and pool health
- Safer key-management and role-separated agent ops

---

## Pitch

Float turns a Solana mobile wallet into a mini-bank:
- borrowers get fast collateral-backed liquidity,
- lenders earn from pooled micro-credit,
- and AI agents automate matching with on-chain risk checks.

