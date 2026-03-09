# Float — Final Shipping Checklist (MONOLITH Hackathon)

**Deadline: March 9, 2026** | Execute in order. No new features.

---

## Completion Snapshot

| Component | Status | Notes |
|-----------|--------|-------|
| Anchor program (build) | ✅ Done | `anchor build` succeeds |
| Anchor program (deploy) | ❌ Blocked | **Do first** |
| Core loans (init/repay/liquidate/withdraw) | ✅ Done | |
| Micro-pool (init/deposit) | ✅ Done | |
| Agent config + agent_match_loan | ✅ Done | |
| Repay/liquidate/withdraw micro | ✅ Done | |
| App: Home, AI Pool, Deposit, Prefs, Status, RepayMicro | ✅ Done | |
| Setup script (setup-agent.js) | ✅ Done | Raw tx, no IDL |
| Agent-match script (agent-match.js) | ✅ Done | Raw tx, no IDL |
| USDC mint | ✅ Fixed | Now Circle devnet 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU |
| Test USDC | ❌ Needed | Faucet |
| Demo keypair → Phantom | ❌ Needed | |
| Demo video | ❌ Needed | |
| Submission | ❌ Needed | |

**~85% built. Remaining: deploy, config, test, record, submit.**

---

# 1. Deployment & Setup Checklist

## 1.1 Deploy Program to Devnet

**If `anchor deploy` fails with "missing field discriminator"** (Anchor 0.30 vs 0.29 IDL mismatch), use raw Solana deploy:

```bash
cd /Users/samisha/Projects/Float/program

solana config set --url devnet
solana address

# Airdrop (rate-limited; try https://faucet.solana.com if CLI fails)
solana airdrop 2
# or: solana airdrop 2 --url https://api.devnet.solana.com

# Deploy using program keypair (bypasses Anchor IDL)
solana program deploy target/deploy/float.so --program-id target/deploy/float-keypair.json
```

**Or fix Anchor deploy:** `anchor clean && rm -rf target .anchor && anchor build && anchor deploy --provider.cluster devnet`

**Verify:** https://explorer.solana.com/address/AeWSncwhRY2TyRnM7UByjhmmcgE8rrbMs9y8vwJomgmX?cluster=devnet

---

## 1.2 USDC Mint (Already Updated)

Constants + scripts now use Circle devnet USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

---

## 1.3 Get Test USDC

1. https://faucet.circle.com
2. Select **Solana Devnet** + **USDC**
3. Paste wallet address
4. Request (10–20 USDC). Wait 2h between requests.

---

## 1.4 Demo Keypair → Phantom

```bash
cd /Users/samisha/Projects/Float/program
solana-keygen new -o demo-wallet.json --force
solana airdrop 2 $(solana-keygen pubkey demo-wallet.json)
```

**Import to Phantom:** Settings → Add/Connect Wallet → Import Private Key. Use a base58 converter for the JSON secret if needed, or use `~/.config/solana/id.json` if already in Phantom.

---

# 2. Demo Preparation Commands

## 2.1 Setup (init pool + agent + deposit)

```bash
cd /Users/samisha/Projects/Float/program

ADMIN_KEYPAIR=./demo-wallet.json AGENT_KEYPAIR=./demo-wallet.json DEPOSIT_USDC=50 node scripts/setup-agent.js
```

**Borrower needs 110% collateral.** Get 60+ USDC from faucet, deposit 50 → 10+ left for one $10 loan.

---

## 2.2 Create Micro-Loans

```bash
AGENT_KEYPAIR=./demo-wallet.json BORROWER_KEYPAIR=./demo-wallet.json AMOUNT=10000000 TERM_DAYS=3 NONCE=1 node scripts/agent-match.js
```

AMOUNT = 6 decimals (10000000 = $10).

---

## 2.3 Confirm

- Explorer: program tx history
- App: AI tab → pull to refresh

---

# 3. 2-Minute Demo Script

| Time | Action | Say |
|------|--------|-----|
| 0:00 | Open app | "Float — AI-powered micro-pawnshop on Solana." |
| 0:05 | Connect Phantom | "Connect Phantom." |
| 0:15 | AI tab | "Toggle AI Mode." |
| 0:20 | Pool balance | "AI Pool — current balance." |
| 0:30 | Deposit 50 USDC | "Deposit 50 USDC — live transaction." |
| 0:50 | Set prefs: $50, 5%, low | "Preferences: max 50, 5% APR, low risk." |
| 1:05 | Show micro-loan | "Pre-created micro-loan from our agent." |
| 1:15 | Repay | "Repay micro-loan — live." |
| 1:30 | Withdraw collateral | "Withdraw collateral." |
| 1:40 | Agent Status | "Agent status — AI matched one safe loan today." |
| 1:50 | End | "Set once, earn passively, borrow instantly — all on your Solana phone." |

---

# 4. Submission

**README:** Short intro, demo video embed, tech stack, quick start.

**One-liner:** Float lets anyone become a mini-bank on their phone: deposit to a shared pool, set lending rules, let an AI agent match safe micro-loans, earn yield — borrowers get fast cash without selling crypto. Non-custodial, on Solana mobile.

**Form fields:** Name, one-liner, description, video link, APK link, repo link.

---

# 5. Top 3 Risks + 30s Fixes

1. **Deploy fails (no SOL)** → `solana airdrop 2` (retry after cooldown)
2. **agent_match fails (no collateral)** → Borrower needs ≥ 11 USDC for $10 loan; get more from faucet
3. **App doesn’t show loans** → Same USDC mint everywhere; refresh AI tab
