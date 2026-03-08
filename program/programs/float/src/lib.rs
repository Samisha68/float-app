use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("AeWSncwhRY2TyRnM7UByjhmmcgE8rrbMs9y8vwJomgmX");

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

/// Loan-to-Value ratio denominator. Collateral must be 150% of loan.
/// e.g. for a 100 USDC loan, user must deposit 150 USDC worth of collateral.
const LTV_DENOMINATOR: u64 = 150;
const LTV_NUMERATOR: u64 = 100;

/// Grace period in seconds after which liquidation is allowed (7 days).
const DEFAULT_GRACE_PERIOD: i64 = 7 * 24 * 60 * 60;

/// Basis points denominator (100.00% = 10_000 bps).
const BPS_DENOMINATOR: u64 = 10_000;

/// Seed prefixes for PDAs.
const LOAN_SEED: &[u8] = b"loan";
const TREASURY_SEED: &[u8] = b"treasury";

// ─────────────────────────────────────────────
// Program entry point
// ─────────────────────────────────────────────

#[program]
pub mod float {
    use super::*;

    /// Initialize a new loan.
    ///
    /// The borrower deposits collateral (SOL-wrapped or SPL token) into a
    /// program-controlled vault PDA.  The program computes the EMI and records
    /// all loan metadata in a `LoanAccount` PDA.
    ///
    /// # Arguments
    /// * `collateral_amount` – lamports (for SOL) or token units to deposit.
    /// * `loan_amount`       – USDC units (6-decimal) to borrow.
    /// * `installments`      – number of monthly repayment periods (3, 6, or 12).
    /// * `annual_rate_bps`   – annual interest rate in basis points (e.g. 1200 = 12%).
    pub fn initialize_loan(
        ctx: Context<InitializeLoan>,
        collateral_amount: u64,
        loan_amount: u64,
        installments: u8,
        annual_rate_bps: u64,
    ) -> Result<()> {
        // ── Validation ────────────────────────────────────────────────────
        require!(installments == 3 || installments == 6 || installments == 12,
            FloatError::InvalidInstallmentCount);
        require!(collateral_amount > 0, FloatError::InvalidCollateralAmount);
        require!(loan_amount > 0, FloatError::InvalidLoanAmount);
        require!(annual_rate_bps <= 5_000, FloatError::InterestRateTooHigh); // max 50% APR

        // ── LTV check (collateral must be ≥ 150% of loan amount) ──────────
        // Both amounts are assumed to be in the same denomination for the
        // hackathon scope (no oracle). In production you'd convert via price feed.
        let min_collateral = loan_amount
            .checked_mul(LTV_DENOMINATOR)
            .ok_or(FloatError::MathOverflow)?
            .checked_div(LTV_NUMERATOR)
            .ok_or(FloatError::MathOverflow)?;
        require!(collateral_amount >= min_collateral, FloatError::InsufficientCollateral);

        // ── EMI calculation ───────────────────────────────────────────────
        // Monthly rate = annual_rate_bps / 12 / 10_000
        // EMI = P * r * (1+r)^n / ((1+r)^n - 1)   [standard amortisation]
        // For hackathon simplicity we use flat interest:
        //   total_interest = loan_amount * annual_rate_bps * (installments/12) / BPS_DENOMINATOR
        //   EMI            = (loan_amount + total_interest) / installments
        let n = installments as u64;
        let total_interest = loan_amount
            .checked_mul(annual_rate_bps)
            .ok_or(FloatError::MathOverflow)?
            .checked_mul(n)
            .ok_or(FloatError::MathOverflow)?
            .checked_div(12)
            .ok_or(FloatError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(FloatError::MathOverflow)?;

        let total_repayable = loan_amount
            .checked_add(total_interest)
            .ok_or(FloatError::MathOverflow)?;

        let installment_amount = total_repayable
            .checked_div(n)
            .ok_or(FloatError::MathOverflow)?;

        require!(installment_amount > 0, FloatError::InvalidLoanAmount);

        // ── Transfer collateral into vault ────────────────────────────────
        // Transfer SPL token collateral from borrower's ATA → vault ATA.
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.borrower_collateral_ata.to_account_info(),
                to: ctx.accounts.vault_collateral_ata.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, collateral_amount)?;

        // ── Disburse loan (USDC) to borrower ─────────────────────────────
        // Treasury ATA → borrower loan ATA, signed by treasury PDA.
        let treasury_bump = ctx.bumps.treasury;
        let treasury_seeds: &[&[u8]] = &[TREASURY_SEED, &[treasury_bump]];
        let signer_seeds = &[treasury_seeds];

        let disburse_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.treasury_loan_ata.to_account_info(),
                to: ctx.accounts.borrower_loan_ata.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(disburse_ctx, loan_amount)?;

        // ── Populate LoanAccount ──────────────────────────────────────────
        let now = Clock::get()?.unix_timestamp;
        // First EMI due one month (~30 days) from now.
        let one_month: i64 = 30 * 24 * 60 * 60;

        let loan = &mut ctx.accounts.loan;
        loan.borrower            = ctx.accounts.borrower.key();
        loan.collateral_amount   = collateral_amount;
        loan.collateral_mint     = ctx.accounts.collateral_mint.key();
        loan.loan_amount         = loan_amount;
        loan.loan_mint           = ctx.accounts.loan_mint.key();
        loan.installment_amount  = installment_amount;
        loan.total_installments  = installments;
        loan.installments_paid   = 0;
        loan.next_due_timestamp  = now + one_month;
        loan.grace_period        = DEFAULT_GRACE_PERIOD;
        loan.status              = LoanStatus::Active;
        loan.created_at          = now;
        loan.annual_rate_bps     = annual_rate_bps;
        loan.vault_bump          = ctx.bumps.loan;

        emit!(LoanInitialized {
            loan: loan.key(),
            borrower: loan.borrower,
            collateral_amount,
            loan_amount,
            installment_amount,
            total_installments: installments,
        });

        Ok(())
    }

    /// Repay one EMI installment.
    ///
    /// The borrower sends exactly `installment_amount` USDC to the treasury.
    /// After all installments are paid the loan is marked `Repaid`.
    pub fn repay_installment(ctx: Context<RepayInstallment>) -> Result<()> {
        let loan = &mut ctx.accounts.loan;

        // ── Guard checks ──────────────────────────────────────────────────
        require!(loan.status == LoanStatus::Active, FloatError::LoanNotActive);
        require!(
            ctx.accounts.borrower.key() == loan.borrower,
            FloatError::Unauthorized
        );

        // ── Transfer USDC from borrower → treasury ────────────────────────
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.borrower_loan_ata.to_account_info(),
                to: ctx.accounts.treasury_loan_ata.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, loan.installment_amount)?;

        // ── Update state ──────────────────────────────────────────────────
        loan.installments_paid = loan.installments_paid
            .checked_add(1)
            .ok_or(FloatError::MathOverflow)?;

        let now = Clock::get()?.unix_timestamp;
        let one_month: i64 = 30 * 24 * 60 * 60;

        if loan.installments_paid >= loan.total_installments {
            // All installments done — mark repaid.
            loan.status = LoanStatus::Repaid;
            loan.next_due_timestamp = 0; // no more due dates
        } else {
            // Advance due date by one month from the later of (now, previous due).
            // This rewards early repayments: next due is still +30 days from now.
            let base = now.max(loan.next_due_timestamp);
            loan.next_due_timestamp = base + one_month;
        }

        emit!(InstallmentRepaid {
            loan: loan.key(),
            borrower: loan.borrower,
            installments_paid: loan.installments_paid,
            remaining: loan.total_installments - loan.installments_paid,
        });

        Ok(())
    }

    /// Liquidate a delinquent loan.
    ///
    /// Anyone can call this after `next_due_timestamp + grace_period` has passed
    /// and the loan is still `Active`.  Collateral is transferred to the treasury.
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        let loan = &ctx.accounts.loan;

        require!(loan.status == LoanStatus::Active, FloatError::LoanNotActive);

        let now = Clock::get()?.unix_timestamp;
        let liquidation_threshold = loan.next_due_timestamp
            .checked_add(loan.grace_period)
            .ok_or(FloatError::MathOverflow)?;

        require!(now >= liquidation_threshold, FloatError::GracePeriodNotExpired);

        // ── Transfer collateral from vault → treasury collateral ATA ──────
        // Vault ATA authority is the loan PDA; sign with loan seeds.
        let loan_bump = loan.vault_bump;
        let loan_seeds: &[&[u8]] = &[
            LOAN_SEED,
            loan.borrower.as_ref(),
            loan.loan_mint.as_ref(),
            &[loan_bump],
        ];
        let signer_seeds = &[loan_seeds];
        let collateral_amount = loan.collateral_amount;
        let borrower = loan.borrower;
        let loan_key = loan.key();

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_collateral_ata.to_account_info(),
                to: ctx.accounts.treasury_collateral_ata.to_account_info(),
                authority: ctx.accounts.loan.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, collateral_amount)?;

        let loan = &mut ctx.accounts.loan;
        loan.status = LoanStatus::Liquidated;

        emit!(LoanLiquidated {
            loan: loan_key,
            borrower,
            collateral_seized: collateral_amount,
        });

        Ok(())
    }

    /// Withdraw collateral after full repayment.
    ///
    /// Only the original borrower may call this, and only when `status == Repaid`.
    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>) -> Result<()> {
        let loan = &ctx.accounts.loan;

        require!(loan.status == LoanStatus::Repaid, FloatError::LoanNotRepaid);
        require!(
            ctx.accounts.borrower.key() == loan.borrower,
            FloatError::Unauthorized
        );

        // ── Transfer collateral from vault → borrower ─────────────────────
        let loan_bump = loan.vault_bump;
        let loan_seeds: &[&[u8]] = &[
            LOAN_SEED,
            loan.borrower.as_ref(),
            loan.loan_mint.as_ref(),
            &[loan_bump],
        ];
        let signer_seeds = &[loan_seeds];
        let collateral_amount = loan.collateral_amount;
        let borrower = loan.borrower;
        let loan_key = loan.key();

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_collateral_ata.to_account_info(),
                to: ctx.accounts.borrower_collateral_ata.to_account_info(),
                authority: ctx.accounts.loan.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, collateral_amount)?;

        let loan = &mut ctx.accounts.loan;
        loan.status = LoanStatus::CollateralWithdrawn;

        emit!(CollateralWithdrawn {
            loan: loan_key,
            borrower,
            collateral_returned: collateral_amount,
        });

        Ok(())
    }
}

// ─────────────────────────────────────────────
// Account structs (instruction contexts)
// ─────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(collateral_amount: u64, loan_amount: u64, installments: u8, annual_rate_bps: u64)]
pub struct InitializeLoan<'info> {
    /// The borrower who initiates the loan and pays for account creation.
    #[account(mut)]
    pub borrower: Signer<'info>,

    /// The LoanAccount PDA. Seeded by [LOAN_SEED, borrower, loan_mint, created_at_nonce].
    /// Using `init` here means each call creates a fresh PDA — borrowers can have
    /// multiple loans by using different nonces (encoded as a u64 timestamp).
    #[account(
        init,
        payer = borrower,
        space = LoanAccount::LEN,
        seeds = [LOAN_SEED, borrower.key().as_ref(), loan_mint.key().as_ref()],
        bump,
    )]
    pub loan: Box<Account<'info, LoanAccount>>,

    /// SPL mint of the collateral token (e.g. wSOL or USDC for over-collateralisation).
    pub collateral_mint: Box<Account<'info, Mint>>,

    /// SPL mint of the loan token (USDC on devnet: EPjFWdd...).
    pub loan_mint: Box<Account<'info, Mint>>,

    /// Borrower's ATA for the collateral token — tokens are pulled from here.
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_collateral_ata: Box<Account<'info, TokenAccount>>,

    /// Borrower's ATA for the loan token (USDC) — must already exist.
    #[account(
        mut,
        associated_token::mint = loan_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_loan_ata: Box<Account<'info, TokenAccount>>,

    /// Vault ATA — program-owned collateral ATA (authority = loan PDA). Must already exist.
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = loan,
    )]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,

    /// Treasury PDA — signs USDC disbursements.
    /// CHECK: validated by seeds constraint below.
    #[account(
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: UncheckedAccount<'info>,

    /// Treasury's USDC ATA — loan funds are held here.
    #[account(
        mut,
        associated_token::mint = loan_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_loan_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RepayInstallment<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [LOAN_SEED, borrower.key().as_ref(), loan.loan_mint.as_ref()],
        bump,
        has_one = borrower,
    )]
    pub loan: Account<'info, LoanAccount>,

    /// Borrower's USDC ATA — EMI pulled from here.
    #[account(
        mut,
        associated_token::mint = loan_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_loan_ata: Account<'info, TokenAccount>,

    /// Treasury USDC ATA — receives the EMI.
    #[account(
        mut,
        associated_token::mint = loan_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_loan_ata: Account<'info, TokenAccount>,

    /// The USDC mint — used for ATA derivation checks.
    pub loan_mint: Account<'info, Mint>,

    /// CHECK: validated by seeds.
    #[account(seeds = [TREASURY_SEED], bump)]
    pub treasury: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    /// Anyone can be the caller — they pay tx fees.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [LOAN_SEED, loan.borrower.as_ref(), loan.loan_mint.as_ref()],
        bump,
    )]
    pub loan: Account<'info, LoanAccount>,

    /// Vault ATA holding the collateral for this loan (authority = loan PDA).
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = loan,
    )]
    pub vault_collateral_ata: Account<'info, TokenAccount>,

    /// Treasury ATA that receives seized collateral.
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_collateral_ata: Account<'info, TokenAccount>,

    pub collateral_mint: Account<'info, Mint>,

    /// CHECK: validated by seeds.
    #[account(seeds = [TREASURY_SEED], bump)]
    pub treasury: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [LOAN_SEED, borrower.key().as_ref(), loan.loan_mint.as_ref()],
        bump,
        has_one = borrower,
    )]
    pub loan: Account<'info, LoanAccount>,

    /// Vault ATA — collateral is released from here (authority = loan PDA).
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = loan,
    )]
    pub vault_collateral_ata: Account<'info, TokenAccount>,

    /// Borrower receives collateral here.
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_collateral_ata: Account<'info, TokenAccount>,

    pub collateral_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct LoanAccount {
    /// Original borrower's public key.
    pub borrower: Pubkey,           // 32

    /// Amount of collateral locked (token units).
    pub collateral_amount: u64,     // 8

    /// Mint of the collateral token.
    pub collateral_mint: Pubkey,    // 32

    /// Disbursed loan amount (USDC units, 6 decimals).
    pub loan_amount: u64,           // 8

    /// Mint of the loan token (USDC).
    pub loan_mint: Pubkey,          // 32

    /// Amount due per installment (USDC units).
    pub installment_amount: u64,    // 8

    /// Total number of installments agreed at origination.
    pub total_installments: u8,     // 1

    /// Number of installments already paid.
    pub installments_paid: u8,      // 1

    /// Unix timestamp of the next payment due date.
    pub next_due_timestamp: i64,    // 8

    /// Seconds of grace beyond `next_due_timestamp` before liquidation.
    pub grace_period: i64,          // 8

    /// Current status of the loan.
    pub status: LoanStatus,         // 1 (enum)

    /// Unix timestamp when the loan was created.
    pub created_at: i64,            // 8

    /// Annual interest rate in basis points.
    pub annual_rate_bps: u64,       // 8

    /// Bump seed for the vault ATA PDA (needed for signing CPI).
    pub vault_bump: u8,             // 1
}

impl LoanAccount {
    /// Discriminator (8) + fields.
    pub const LEN: usize = 8
        + 32  // borrower
        + 8   // collateral_amount
        + 32  // collateral_mint
        + 8   // loan_amount
        + 32  // loan_mint
        + 8   // installment_amount
        + 1   // total_installments
        + 1   // installments_paid
        + 8   // next_due_timestamp
        + 8   // grace_period
        + 1   // status
        + 8   // created_at
        + 8   // annual_rate_bps
        + 1   // vault_bump
        + 64; // padding for future fields
}

/// Lifecycle status of a loan.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default)]
pub enum LoanStatus {
    #[default]
    Active,
    Repaid,
    Liquidated,
    CollateralWithdrawn,
}

// ─────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────

#[event]
pub struct LoanInitialized {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub collateral_amount: u64,
    pub loan_amount: u64,
    pub installment_amount: u64,
    pub total_installments: u8,
}

#[event]
pub struct InstallmentRepaid {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub installments_paid: u8,
    pub remaining: u8,
}

#[event]
pub struct LoanLiquidated {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub collateral_seized: u64,
}

#[event]
pub struct CollateralWithdrawn {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub collateral_returned: u64,
}

// ─────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────

#[error_code]
pub enum FloatError {
    #[msg("Installment count must be 3, 6, or 12.")]
    InvalidInstallmentCount,

    #[msg("Collateral amount must be greater than zero.")]
    InvalidCollateralAmount,

    #[msg("Loan amount must be greater than zero.")]
    InvalidLoanAmount,

    #[msg("Annual interest rate cannot exceed 50% (5000 bps).")]
    InterestRateTooHigh,

    #[msg("Collateral must be at least 150% of the loan amount (LTV 66%).")]
    InsufficientCollateral,

    #[msg("Arithmetic overflow during calculation.")]
    MathOverflow,

    #[msg("Loan is not in Active status.")]
    LoanNotActive,

    #[msg("Loan is not in Repaid status — collateral cannot be withdrawn yet.")]
    LoanNotRepaid,

    #[msg("Grace period has not expired — liquidation not yet allowed.")]
    GracePeriodNotExpired,

    #[msg("Caller is not authorised for this operation.")]
    Unauthorized,
}
