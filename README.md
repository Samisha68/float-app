# Float — Collateral-backed Installment Loans on Solana

> MONOLITH Solana Mobile Hackathon · March 2026

Float lets users lock SOL/USDC as collateral, receive a USDC loan, and repay it in fixed monthly installments (EMIs). Miss the grace period → collateral is liquidated. Repay fully → collateral returned.

---

## Project Structure

```
Float/
├── program/                  # Anchor smart contract
│   ├── Anchor.toml
│   ├── Cargo.toml
│   ├── programs/float/
│   │   ├── Cargo.toml
│   │   └── src/lib.rs        # All instructions, state, errors
│   └── tests/float.ts
│
└── app/                      # React Native + Expo frontend
    ├── App.tsx               # Navigation root
    ├── app.json
    ├── package.json
    └── src/
        ├── idl/float.ts      # Anchor IDL (update after deploy)
        ├── utils/
        │   ├── constants.ts  # RPC, program ID, seeds
        │   └── loanMath.ts   # EMI calculator, formatters
        ├── hooks/
        │   ├── useWallet.ts  # Mobile Wallet Adapter
        │   └── useLoans.ts   # On-chain loan fetching
        ├── components/
        │   └── LoanCard.tsx
        └── screens/
            ├── HomeScreen.tsx
            ├── CreateLoanScreen.tsx
            ├── RepayScreen.tsx
            └── HistoryScreen.tsx
```

---

## How It Works

| Step | Action | On-chain |
|------|--------|----------|
| 1 | User deposits 150 USDC collateral | `initialize_loan` — vault ATA receives collateral, treasury disburses USDC |
| 2 | User receives 100 USDC loan | Treasury ATA → borrower ATA |
| 3 | Monthly repayment | `repay_installment` — borrower ATA → treasury ATA |
| 4 | All paid | Loan status → `Repaid` |
| 5 | Withdraw collateral | `withdraw_collateral` — vault ATA → borrower ATA |
| ⚠ | Missed payment + 7 days | `liquidate` — vault ATA → treasury ATA (anyone can call) |

**LTV:** 150% collateral required (100 USDC loan needs 150 USDC collateral).
**Interest:** Flat 12% APR calculated as: `(principal × rate × months/12) / 10000`.
**No oracle:** Both collateral and loan use USDC on devnet for hackathon scope.

---

## Prerequisites

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup component add rustfmt

# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1
avm use 0.30.1

# Node / Yarn
npm install -g yarn

# Expo CLI
npm install -g eas-cli expo-cli
```

---

## 1 · Smart Contract Setup & Deployment

### 1.1 Generate a devnet keypair

```bash
solana-keygen new --outfile ~/.config/solana/id.json
solana config set --url devnet
solana airdrop 2
```

### 1.2 Install program dependencies

```bash
cd Float/program
yarn install      # installs @coral-xyz/anchor for tests
```

### 1.3 Build the program

```bash
anchor build
```

This produces:
- `target/deploy/float.so` — the compiled program
- `target/idl/float.json` — the IDL
- `target/types/float.ts` — TypeScript types

### 1.4 Get the program ID

```bash
anchor keys list
# float: <PROGRAM_ID>
```

Update **two places** with your actual program ID:

```bash
# program/Anchor.toml
[programs.devnet]
float = "<YOUR_PROGRAM_ID>"

# program/programs/float/src/lib.rs  (top of file)
declare_id!("<YOUR_PROGRAM_ID>");
```

Then rebuild:

```bash
anchor build
```

### 1.5 Deploy to devnet

```bash
anchor deploy --provider.cluster devnet
```

Expected output:
```
Deploying workspace: https://api.devnet.solana.com
Upgrade authority: ~/.config/solana/id.json
Deploying program "float"...
Program Id: <YOUR_PROGRAM_ID>
Deploy success
```

### 1.6 Seed the treasury with devnet USDC

The treasury PDA needs USDC to disburse loans. For hackathon testing:

```bash
# Derive the treasury PDA address
node -e "
const anchor = require('@coral-xyz/anchor');
const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from('treasury')],
  new anchor.web3.PublicKey('<YOUR_PROGRAM_ID>')
);
console.log('Treasury PDA:', pda.toBase58());
"

# Get devnet USDC from Circle's faucet or use spl-token to mint test tokens
# Devnet USDC mint: Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
spl-token create-account Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr \
  --owner <TREASURY_PDA> \
  --fee-payer ~/.config/solana/id.json
```

> **Tip for judging demo:** Create your own test SPL mint so you can freely airdrop tokens to the treasury and test wallets without needing the real devnet USDC faucet.

---

## 2 · Running Tests

```bash
cd Float/program

# Set localnet for fast testing (no rate limits)
solana config set --url localhost
solana-test-validator &   # start local validator

anchor test --skip-deploy   # runs tests/float.ts
```

For devnet tests:

```bash
solana config set --url devnet
anchor test
```

---

## 3 · Frontend Setup

### 3.1 Update the program ID in the app

After deploying, update `app/src/utils/constants.ts`:

```typescript
export const FLOAT_PROGRAM_ID = new PublicKey("<YOUR_PROGRAM_ID>");
```

Also regenerate the IDL types if you made any contract changes:

```bash
# Copy generated types
cp program/target/types/float.ts app/src/idl/float.ts
```

### 3.2 Install app dependencies

```bash
cd Float/app
yarn install
```

### 3.3 Run in Expo Go (quick preview)

```bash
yarn start
# Scan QR code with Expo Go app
```

> Note: Mobile Wallet Adapter (MWA) only works on Android with a Solana wallet installed (e.g. Phantom, Solflare). Use a physical Android device or Android emulator with a wallet app installed.

### 3.4 Build for Android (Solana dApp Store submission)

```bash
# Configure EAS
eas build:configure

# Build a development APK
eas build --platform android --profile development

# Build production APK for dApp Store
eas build --platform android --profile production
```

`eas.json` example:
```json
{
  "build": {
    "development": {
      "android": { "buildType": "apk", "gradleCommand": ":app:assembleDebug" }
    },
    "production": {
      "android": { "buildType": "apk" }
    }
  }
}
```

---

## 4 · Testing the Full Flow

### 4.1 Manual walkthrough (devnet)

1. **Fund test wallets** — airdrop SOL + USDC to your mobile wallet on devnet
2. **Fund treasury** — mint/transfer USDC to the treasury PDA's ATA
3. **Open Float app** → tap **Connect Wallet** → approve in Phantom/Solflare
4. **Create Loan**:
   - Enter loan amount (e.g. 100 USDC)
   - Select term (3/6/12 months)
   - Confirm the 150 USDC collateral requirement and $34.33/mo EMI
   - Tap **Confirm Loan** → sign in wallet
5. **Verify on-chain**:
   ```bash
   solana account <LOAN_PDA> --output json
   ```
6. **Repay EMI** → tap **Pay EMI** on home screen → sign
7. **After all EMIs** → tap **Withdraw Collateral** → collateral returned

### 4.2 Test liquidation path

```bash
# Simulate a missed payment by temporarily setting a past due date
# (requires modifying the grace period in contract or using a test script)

# Anyone can call liquidate once past due + 7 days:
anchor run liquidate-test   # custom script in tests/
```

### 4.3 Verify accounts

```bash
# Check loan PDA state
solana account <LOAN_PDA>

# Check borrower USDC balance
spl-token balance Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr

# Check vault ATA (should be empty after collateral returned)
spl-token accounts --owner <VAULT_PDA>
```

---

## 5 · Key Design Decisions

### LTV (Loan-to-Value)
Fixed at **150%** — no oracle required. For demo, collateral and loan use the same USDC mint. In production, collateral would be SOL/wBTC/etc. priced via Pyth.

### EMI Formula (flat interest, mirrors on-chain)
```
total_interest = principal × annual_rate_bps × installments / 12 / 10_000
EMI            = (principal + total_interest) / installments
```

Example: $100 loan, 6 months, 12% APR
→ interest = $6.00 → EMI = $17.67/mo

### PDA Architecture
| PDA | Seeds | Purpose |
|-----|-------|---------|
| `loan` | `["loan", borrower, loan_mint]` | Stores all loan state |
| `treasury` | `["treasury"]` | Signs USDC disbursements |
| `vault` | `["vault", loan_pubkey]` | Holds collateral per loan |

### Grace Period
7 days after `next_due_timestamp`. Anyone can call `liquidate` — this is intentional (keeper-style liquidation).

---

## 6 · Known Hackathon Limitations

| Limitation | Production fix |
|------------|---------------|
| Single loan per borrower per mint | Add nonce to PDA seed |
| No oracle for collateral pricing | Integrate Pyth Network |
| Fixed 12% APR | Dynamic rates via governance |
| Treasury needs manual seeding | Protocol fee accumulation |
| No partial repayment | Add flexible repayment logic |
| No liquidation incentive | Add liquidator bonus (e.g. 5% of collateral) |

---

## 7 · Solana dApp Store Submission Checklist

- [ ] Build production APK via `eas build --platform android --profile production`
- [ ] Test on physical Android device with Phantom installed
- [ ] Deploy program to **mainnet-beta** (update `Anchor.toml` + `constants.ts`)
- [ ] Create dApp Store publisher account at `publish.solanamobile.com`
- [ ] Upload APK, screenshots, and description
- [ ] Set category: **DeFi**

---

## 8 · Useful Commands Cheatsheet

```bash
# Build program
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Run tests
anchor test

# Start Expo
cd app && yarn start

# Check program logs (devnet)
solana logs <PROGRAM_ID> --url devnet

# Airdrop SOL (devnet)
solana airdrop 2 <ADDRESS> --url devnet

# Get program ID
anchor keys list
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contract | Rust + Anchor 0.30.1 |
| Token Program | SPL Token + Associated Token Account |
| Frontend | React Native + Expo ~51 |
| Wallet | Solana Mobile SDK — Mobile Wallet Adapter |
| Navigation | React Navigation v6 (Stack + Bottom Tabs) |
| Network | Solana Devnet (→ Mainnet for production) |
| Loan Token | USDC (6 decimals) |

---

Built for the **MONOLITH Solana Mobile Hackathon** · Deadline March 9, 2026
