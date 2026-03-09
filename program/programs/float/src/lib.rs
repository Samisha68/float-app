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
const MICRO_POOL_SEED: &[u8] = b"micro_pool";
const MICRO_LOAN_SEED: &[u8] = b"micro_loan";
const AGENT_CONFIG_SEED: &[u8] = b"agent_config";

/// AI micro-lending caps (MVP).
const MICRO_LOAN_MAX_USDC: u64 = 100_000_000;   // $100 (6 decimals)
const MICRO_POOL_EXPOSURE_BPS: u64 = 1_000;     // 10% of pool per loan
const MICRO_COLLATERAL_NUMERATOR: u64 = 110;    // 110% collateral
const MICRO_COLLATERAL_DENOMINATOR: u64 = 100;
const MICRO_GRACE_PERIOD_SECS: i64 = 24 * 60 * 60; // 1 day

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
        nonce: u64,
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
        loan.nonce               = nonce;

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
        let nonce_bytes = loan.nonce.to_le_bytes();
        let loan_seeds: &[&[u8]] = &[
            LOAN_SEED,
            loan.borrower.as_ref(),
            loan.loan_mint.as_ref(),
            &nonce_bytes,
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
        let nonce_bytes = loan.nonce.to_le_bytes();
        let loan_seeds: &[&[u8]] = &[
            LOAN_SEED,
            loan.borrower.as_ref(),
            loan.loan_mint.as_ref(),
            &nonce_bytes,
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

    // ─────────────── AI Micro-Lending (MONOLITH Hackathon) ───────────────

    /// Initialize the micro-pool (liquidity pool for AI agents). Call once.
    pub fn initialize_micro_pool(ctx: Context<InitializeMicroPool>) -> Result<()> {
        ctx.accounts.pool_state.bump = ctx.bumps.pool_state;
        ctx.accounts.pool_state.total_deposited = 0;
        Ok(())
    }

    /// Set the authorized agent key (admin). Call once.
    pub fn initialize_agent_config(ctx: Context<InitializeAgentConfig>, agent_pubkey: Pubkey) -> Result<()> {
        ctx.accounts.agent_config.authorized_agent = agent_pubkey;
        Ok(())
    }

    /// Update the authorized agent to a new wallet.
    pub fn update_agent_config(ctx: Context<UpdateAgentConfig>, new_agent: Pubkey) -> Result<()> {
        ctx.accounts.agent_config.authorized_agent = new_agent;
        Ok(())
    }

    /// Lender deposits USDC into the micro-pool.
    pub fn deposit_to_pool(ctx: Context<DepositToPool>, amount: u64) -> Result<()> {
        require!(amount > 0, FloatError::InvalidLoanAmount);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.depositor_ata.to_account_info(),
                to: ctx.accounts.pool_loan_ata.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        let pool = &mut ctx.accounts.pool_state;
        pool.total_deposited = pool.total_deposited
            .checked_add(amount)
            .ok_or(FloatError::MathOverflow)?;

        emit!(MicroPoolDeposit {
            depositor: ctx.accounts.depositor.key(),
            amount,
            new_total: pool.total_deposited,
        });
        Ok(())
    }

    /// Agent-only: match a micro-loan (disburse from pool, lock mini-collateral).
    pub fn agent_match_loan(
        ctx: Context<AgentMatchLoan>,
        amount: u64,
        term_days: u8,
        nonce: u64,
    ) -> Result<()> {
        require!(term_days >= 1 && term_days <= 7, FloatError::InvalidInstallmentCount);
        require!(amount > 0 && amount <= MICRO_LOAN_MAX_USDC, FloatError::InvalidLoanAmount);

        let agent_config = &ctx.accounts.agent_config;
        require!(
            ctx.accounts.agent.key() == agent_config.authorized_agent,
            FloatError::Unauthorized
        );

        let pool_balance = ctx.accounts.pool_loan_ata.amount;
        let max_per_loan = pool_balance
            .checked_mul(MICRO_POOL_EXPOSURE_BPS)
            .ok_or(FloatError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(FloatError::MathOverflow)?;
        require!(amount <= max_per_loan, FloatError::InsufficientCollateral);

        let collateral_min = amount
            .checked_mul(MICRO_COLLATERAL_NUMERATOR)
            .ok_or(FloatError::MathOverflow)?
            .checked_div(MICRO_COLLATERAL_DENOMINATOR)
            .ok_or(FloatError::MathOverflow)?;
        let collateral_amount = ctx.accounts.borrower_collateral_ata.amount;
        require!(collateral_amount >= collateral_min, FloatError::InsufficientCollateral);

        let now = Clock::get()?.unix_timestamp;
        let term_secs: i64 = (term_days as i64) * 24 * 60 * 60;
        let due_at = now
            .checked_add(term_secs)
            .ok_or(FloatError::MathOverflow)?;

        let loan = &mut ctx.accounts.micro_loan;
        loan.borrower = ctx.accounts.borrower.key();
        loan.amount = amount;
        loan.term_days = term_days;
        loan.collateral_amount = collateral_min;
        loan.total_repay = amount;
        loan.due_at = due_at;
        loan.grace_until = due_at
            .checked_add(MICRO_GRACE_PERIOD_SECS)
            .ok_or(FloatError::MathOverflow)?;
        loan.status = MicroLoanStatus::Active;
        loan.created_at = now;
        loan.nonce = nonce;
        loan.loan_mint = ctx.accounts.loan_mint.key();
        loan.collateral_mint = ctx.accounts.collateral_mint.key();
        loan.vault_bump = ctx.bumps.micro_loan;
        loan.pool = ctx.accounts.pool_state.key();

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.borrower_collateral_ata.to_account_info(),
                    to: ctx.accounts.vault_collateral_ata.to_account_info(),
                    authority: ctx.accounts.borrower.to_account_info(),
                },
            ),
            collateral_min,
        )?;

        let pool_bump = ctx.accounts.pool_state.bump;
        let pool_seeds: &[&[u8]] = &[MICRO_POOL_SEED, &[pool_bump]];
        let signer_seeds = &[pool_seeds];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_loan_ata.to_account_info(),
                    to: ctx.accounts.borrower_loan_ata.to_account_info(),
                    authority: ctx.accounts.pool_state.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        emit!(MicroLoanMatched {
            loan: loan.key(),
            borrower: loan.borrower,
            amount,
            term_days,
            due_at,
        });
        Ok(())
    }

    /// Borrower repays micro-loan in full; collateral remains locked until withdraw.
    pub fn repay_micro_loan(ctx: Context<RepayMicroLoan>) -> Result<()> {
        let loan = &mut ctx.accounts.micro_loan;
        require!(loan.status == MicroLoanStatus::Active, FloatError::LoanNotActive);
        require!(
            ctx.accounts.borrower.key() == loan.borrower,
            FloatError::Unauthorized
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.borrower_loan_ata.to_account_info(),
                    to: ctx.accounts.pool_loan_ata.to_account_info(),
                    authority: ctx.accounts.borrower.to_account_info(),
                },
            ),
            loan.total_repay,
        )?;

        loan.status = MicroLoanStatus::Repaid;
        emit!(MicroLoanRepaid {
            loan: loan.key(),
            borrower: loan.borrower,
            amount: loan.total_repay,
        });
        Ok(())
    }

    /// Liquidate overdue micro-loan; collateral goes to pool.
    pub fn liquidate_micro_loan(ctx: Context<LiquidateMicroLoan>) -> Result<()> {
        let loan = &ctx.accounts.micro_loan;
        require!(loan.status == MicroLoanStatus::Active, FloatError::LoanNotActive);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= loan.grace_until, FloatError::GracePeriodNotExpired);

        let loan_bump = loan.vault_bump;
        let loan_seeds: &[&[u8]] = &[
            MICRO_LOAN_SEED,
            loan.borrower.as_ref(),
            loan.loan_mint.as_ref(),
            &loan.nonce.to_le_bytes(),
            &[loan_bump],
        ];
        let signer_seeds = &[loan_seeds];
        let collateral_amount = loan.collateral_amount;

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_collateral_ata.to_account_info(),
                    to: ctx.accounts.pool_collateral_ata.to_account_info(),
                    authority: ctx.accounts.micro_loan.to_account_info(),
                },
                signer_seeds,
            ),
            collateral_amount,
        )?;

        let loan = &mut ctx.accounts.micro_loan;
        loan.status = MicroLoanStatus::Liquidated;

        emit!(MicroLoanLiquidated {
            loan: loan.key(),
            borrower: loan.borrower,
            collateral_seized: collateral_amount,
        });
        Ok(())
    }

    /// Borrower withdraws collateral after repaying micro-loan.
    pub fn withdraw_collateral_micro(ctx: Context<WithdrawCollateralMicro>) -> Result<()> {
        let loan = &ctx.accounts.micro_loan;
        require!(loan.status == MicroLoanStatus::Repaid, FloatError::LoanNotRepaid);
        require!(
            ctx.accounts.borrower.key() == loan.borrower,
            FloatError::Unauthorized
        );

        let loan_bump = loan.vault_bump;
        let loan_seeds: &[&[u8]] = &[
            MICRO_LOAN_SEED,
            loan.borrower.as_ref(),
            loan.loan_mint.as_ref(),
            &loan.nonce.to_le_bytes(),
            &[loan_bump],
        ];
        let signer_seeds = &[loan_seeds];
        let collateral_amount = loan.collateral_amount;

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_collateral_ata.to_account_info(),
                    to: ctx.accounts.borrower_collateral_ata.to_account_info(),
                    authority: ctx.accounts.micro_loan.to_account_info(),
                },
                signer_seeds,
            ),
            collateral_amount,
        )?;

        let loan = &mut ctx.accounts.micro_loan;
        loan.status = MicroLoanStatus::CollateralWithdrawn;
        Ok(())
    }
}

// ─────────────────────────────────────────────
// Account structs (instruction contexts)
// ─────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(collateral_amount: u64, loan_amount: u64, installments: u8, annual_rate_bps: u64, nonce: u64)]
pub struct InitializeLoan<'info> {
    /// The borrower who initiates the loan and pays for account creation.
    #[account(mut)]
    pub borrower: Signer<'info>,

    /// The LoanAccount PDA. Seeded by [LOAN_SEED, borrower, loan_mint, nonce].
    /// Each nonce creates a unique PDA so borrowers can have multiple loans.
    #[account(
        init,
        payer = borrower,
        space = LoanAccount::LEN,
        seeds = [LOAN_SEED, borrower.key().as_ref(), loan_mint.key().as_ref(), &nonce.to_le_bytes()],
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
        seeds = [LOAN_SEED, borrower.key().as_ref(), loan.loan_mint.as_ref(), &loan.nonce.to_le_bytes()],
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
        seeds = [LOAN_SEED, loan.borrower.as_ref(), loan.loan_mint.as_ref(), &loan.nonce.to_le_bytes()],
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
        seeds = [LOAN_SEED, borrower.key().as_ref(), loan.loan_mint.as_ref(), &loan.nonce.to_le_bytes()],
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

// ─── AI Micro-Lending contexts ────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeMicroPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = PoolState::LEN,
        seeds = [MICRO_POOL_SEED],
        bump,
    )]
    pub pool_state: Account<'info, PoolState>,

    pub loan_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = loan_mint,
        associated_token::authority = pool_state,
    )]
    pub pool_loan_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeAgentConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = AgentConfig::LEN,
        seeds = [AGENT_CONFIG_SEED],
        bump,
    )]
    pub agent_config: Account<'info, AgentConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAgentConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [AGENT_CONFIG_SEED],
        bump,
    )]
    pub agent_config: Account<'info, AgentConfig>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct DepositToPool<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [MICRO_POOL_SEED],
        bump = pool_state.bump,
    )]
    pub pool_state: Account<'info, PoolState>,

    #[account(
        mut,
        associated_token::mint = loan_mint,
        associated_token::authority = depositor,
    )]
    pub depositor_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = loan_mint,
        associated_token::authority = pool_state,
    )]
    pub pool_loan_ata: Account<'info, TokenAccount>,

    pub loan_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, term_days: u8, nonce: u64)]
pub struct AgentMatchLoan<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    #[account(
        seeds = [AGENT_CONFIG_SEED],
        bump,
    )]
    pub agent_config: Box<Account<'info, AgentConfig>>,

    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        init,
        payer = agent,
        space = MicroLoan::LEN,
        seeds = [MICRO_LOAN_SEED, borrower.key().as_ref(), loan_mint.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub micro_loan: Box<Account<'info, MicroLoan>>,

    #[account(
        mut,
        seeds = [MICRO_POOL_SEED],
        bump = pool_state.bump,
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    #[account(
        mut,
        associated_token::mint = loan_mint,
        associated_token::authority = pool_state,
    )]
    pub pool_loan_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = loan_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_loan_ata: Box<Account<'info, TokenAccount>>,

    /// Vault ATA (authority = micro_loan PDA). Client must create before first use; or create via CPI in handler.
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = micro_loan,
    )]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, Mint>>,
    pub loan_mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RepayMicroLoan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [MICRO_LOAN_SEED, micro_loan.borrower.as_ref(), micro_loan.loan_mint.as_ref(), &micro_loan.nonce.to_le_bytes()],
        bump,
        has_one = borrower,
    )]
    pub micro_loan: Account<'info, MicroLoan>,

    #[account(
        mut,
        associated_token::mint = loan_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_loan_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = loan_mint,
        associated_token::authority = pool_state,
    )]
    pub pool_loan_ata: Account<'info, TokenAccount>,

    #[account(seeds = [MICRO_POOL_SEED], bump = pool_state.bump)]
    pub pool_state: Account<'info, PoolState>,

    pub loan_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LiquidateMicroLoan<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [MICRO_LOAN_SEED, micro_loan.borrower.as_ref(), micro_loan.loan_mint.as_ref(), &micro_loan.nonce.to_le_bytes()],
        bump,
    )]
    pub micro_loan: Account<'info, MicroLoan>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = micro_loan,
    )]
    pub vault_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = pool_state,
    )]
    pub pool_collateral_ata: Account<'info, TokenAccount>,

    #[account(seeds = [MICRO_POOL_SEED], bump = pool_state.bump)]
    pub pool_state: Account<'info, PoolState>,

    pub collateral_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawCollateralMicro<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [MICRO_LOAN_SEED, micro_loan.borrower.as_ref(), micro_loan.loan_mint.as_ref(), &micro_loan.nonce.to_le_bytes()],
        bump,
        has_one = borrower,
    )]
    pub micro_loan: Account<'info, MicroLoan>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = micro_loan,
    )]
    pub vault_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_collateral_ata: Account<'info, TokenAccount>,

    #[account(seeds = [MICRO_POOL_SEED], bump = pool_state.bump)]
    pub pool_state: Account<'info, PoolState>,

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

    /// Nonce used in PDA derivation (allows multiple loans per borrower per mint).
    pub nonce: u64,                 // 8
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
        + 8   // nonce
        + 56; // padding for future fields
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

// ─── AI Micro-Lending state ───────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct PoolState {
    pub bump: u8,
    pub total_deposited: u64,
}

impl PoolState {
    pub const LEN: usize = 8 + 1 + 8;
}

#[account]
#[derive(Default)]
pub struct AgentConfig {
    pub authorized_agent: Pubkey,
}

impl AgentConfig {
    pub const LEN: usize = 8 + 32;
}

#[account]
#[derive(Default)]
pub struct MicroLoan {
    pub borrower: Pubkey,
    pub amount: u64,
    pub term_days: u8,
    pub collateral_amount: u64,
    pub total_repay: u64,
    pub due_at: i64,
    pub grace_until: i64,
    pub status: MicroLoanStatus,
    pub created_at: i64,
    pub nonce: u64,
    pub loan_mint: Pubkey,
    pub collateral_mint: Pubkey,
    pub vault_bump: u8,
    pub pool: Pubkey,
}

impl MicroLoan {
    pub const LEN: usize = 8
        + 32 + 8 + 1 + 8 + 8 + 8 + 8 + 1 + 8 + 8 + 32 + 32 + 1 + 32
        + 32; // padding
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default)]
pub enum MicroLoanStatus {
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

#[event]
pub struct MicroPoolDeposit {
    pub depositor: Pubkey,
    pub amount: u64,
    pub new_total: u64,
}

#[event]
pub struct MicroLoanMatched {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub amount: u64,
    pub term_days: u8,
    pub due_at: i64,
}

#[event]
pub struct MicroLoanRepaid {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub amount: u64,
}

#[event]
pub struct MicroLoanLiquidated {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub collateral_seized: u64,
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
