// Auto-generated IDL type for Float program.
// Replace program ID after `anchor deploy` on devnet.

export type Float = {
  address: string;
  metadata: { name: string; version: string; spec: string };
  version: "0.1.0";
  name: "float";
  instructions: [
    {
      name: "initializeLoan";
      accounts: [
        { name: "borrower"; isMut: true; isSigner: true },
        { name: "loan"; isMut: true; isSigner: false },
        { name: "collateralMint"; isMut: false; isSigner: false },
        { name: "loanMint"; isMut: false; isSigner: false },
        { name: "borrowerCollateralAta"; isMut: true; isSigner: false },
        { name: "borrowerLoanAta"; isMut: true; isSigner: false },
        { name: "vaultCollateralAta"; isMut: true; isSigner: false },
        { name: "treasury"; isMut: false; isSigner: false },
        { name: "treasuryLoanAta"; isMut: true; isSigner: false },
        { name: "tokenProgram"; isMut: false; isSigner: false },
        { name: "associatedTokenProgram"; isMut: false; isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false },
        { name: "rent"; isMut: false; isSigner: false }
      ];
      args: [
        { name: "collateralAmount"; type: "u64" },
        { name: "loanAmount"; type: "u64" },
        { name: "installments"; type: "u8" },
        { name: "annualRateBps"; type: "u64" }
      ];
    },
    {
      name: "repayInstallment";
      accounts: [
        { name: "borrower"; isMut: true; isSigner: true },
        { name: "loan"; isMut: true; isSigner: false },
        { name: "borrowerLoanAta"; isMut: true; isSigner: false },
        { name: "treasuryLoanAta"; isMut: true; isSigner: false },
        { name: "loanMint"; isMut: false; isSigner: false },
        { name: "treasury"; isMut: false; isSigner: false },
        { name: "tokenProgram"; isMut: false; isSigner: false },
        { name: "associatedTokenProgram"; isMut: false; isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false }
      ];
      args: [];
    },
    {
      name: "liquidate";
      accounts: [
        { name: "caller"; isMut: true; isSigner: true },
        { name: "loan"; isMut: true; isSigner: false },
        { name: "vaultCollateralAta"; isMut: true; isSigner: false },
        { name: "treasuryCollateralAta"; isMut: true; isSigner: false },
        { name: "collateralMint"; isMut: false; isSigner: false },
        { name: "treasury"; isMut: false; isSigner: false },
        { name: "tokenProgram"; isMut: false; isSigner: false },
        { name: "associatedTokenProgram"; isMut: false; isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false }
      ];
      args: [];
    },
    {
      name: "withdrawCollateral";
      accounts: [
        { name: "borrower"; isMut: true; isSigner: true },
        { name: "loan"; isMut: true; isSigner: false },
        { name: "vaultCollateralAta"; isMut: true; isSigner: false },
        { name: "borrowerCollateralAta"; isMut: true; isSigner: false },
        { name: "collateralMint"; isMut: false; isSigner: false },
        { name: "tokenProgram"; isMut: false; isSigner: false },
        { name: "associatedTokenProgram"; isMut: false; isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false }
      ];
      args: [];
    }
  ];
  accounts: [
    {
      name: "loanAccount";
      type: {
        kind: "struct";
        fields: [
          { name: "borrower"; type: "publicKey" },
          { name: "collateralAmount"; type: "u64" },
          { name: "collateralMint"; type: "publicKey" },
          { name: "loanAmount"; type: "u64" },
          { name: "loanMint"; type: "publicKey" },
          { name: "installmentAmount"; type: "u64" },
          { name: "totalInstallments"; type: "u8" },
          { name: "installmentsPaid"; type: "u8" },
          { name: "nextDueTimestamp"; type: "i64" },
          { name: "gracePeriod"; type: "i64" },
          { name: "status"; type: { defined: "LoanStatus" } },
          { name: "createdAt"; type: "i64" },
          { name: "annualRateBps"; type: "u64" },
          { name: "vaultBump"; type: "u8" }
        ];
      };
    }
  ];
  types: [
    {
      name: "LoanStatus";
      type: {
        kind: "enum";
        variants: [
          { name: "Active" },
          { name: "Repaid" },
          { name: "Liquidated" },
          { name: "CollateralWithdrawn" }
        ];
      };
    }
  ];
  errors: [
    { code: 6000; name: "InvalidInstallmentCount"; msg: "Installment count must be 3, 6, or 12." },
    { code: 6001; name: "InvalidCollateralAmount"; msg: "Collateral amount must be greater than zero." },
    { code: 6002; name: "InvalidLoanAmount"; msg: "Loan amount must be greater than zero." },
    { code: 6003; name: "InterestRateTooHigh"; msg: "Annual interest rate cannot exceed 50% (5000 bps)." },
    { code: 6004; name: "InsufficientCollateral"; msg: "Collateral must be at least 150% of the loan amount (LTV 66%)." },
    { code: 6005; name: "MathOverflow"; msg: "Arithmetic overflow during calculation." },
    { code: 6006; name: "LoanNotActive"; msg: "Loan is not in Active status." },
    { code: 6007; name: "LoanNotRepaid"; msg: "Loan is not in Repaid status — collateral cannot be withdrawn yet." },
    { code: 6008; name: "GracePeriodNotExpired"; msg: "Grace period has not expired — liquidation not yet allowed." },
    { code: 6009; name: "Unauthorized"; msg: "Caller is not authorised for this operation." }
  ];
};

export const IDL: Float = {
  address: "FLoAtXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  metadata: { name: "float", version: "0.1.0", spec: "0.1.0" },
  version: "0.1.0",
  name: "float",
  instructions: [
    {
      name: "initializeLoan",
      accounts: [
        { name: "borrower", isMut: true, isSigner: true },
        { name: "loan", isMut: true, isSigner: false },
        { name: "collateralMint", isMut: false, isSigner: false },
        { name: "loanMint", isMut: false, isSigner: false },
        { name: "borrowerCollateralAta", isMut: true, isSigner: false },
        { name: "borrowerLoanAta", isMut: true, isSigner: false },
        { name: "vaultCollateralAta", isMut: true, isSigner: false },
        { name: "treasury", isMut: false, isSigner: false },
        { name: "treasuryLoanAta", isMut: true, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
        { name: "associatedTokenProgram", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
        { name: "rent", isMut: false, isSigner: false },
      ],
      args: [
        { name: "collateralAmount", type: "u64" },
        { name: "loanAmount", type: "u64" },
        { name: "installments", type: "u8" },
        { name: "annualRateBps", type: "u64" },
      ],
    },
    {
      name: "repayInstallment",
      accounts: [
        { name: "borrower", isMut: true, isSigner: true },
        { name: "loan", isMut: true, isSigner: false },
        { name: "borrowerLoanAta", isMut: true, isSigner: false },
        { name: "treasuryLoanAta", isMut: true, isSigner: false },
        { name: "loanMint", isMut: false, isSigner: false },
        { name: "treasury", isMut: false, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
        { name: "associatedTokenProgram", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "liquidate",
      accounts: [
        { name: "caller", isMut: true, isSigner: true },
        { name: "loan", isMut: true, isSigner: false },
        { name: "vaultCollateralAta", isMut: true, isSigner: false },
        { name: "treasuryCollateralAta", isMut: true, isSigner: false },
        { name: "collateralMint", isMut: false, isSigner: false },
        { name: "treasury", isMut: false, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
        { name: "associatedTokenProgram", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "withdrawCollateral",
      accounts: [
        { name: "borrower", isMut: true, isSigner: true },
        { name: "loan", isMut: true, isSigner: false },
        { name: "vaultCollateralAta", isMut: true, isSigner: false },
        { name: "borrowerCollateralAta", isMut: true, isSigner: false },
        { name: "collateralMint", isMut: false, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
        { name: "associatedTokenProgram", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: "loanAccount",
      type: {
        kind: "struct",
        fields: [
          { name: "borrower", type: "publicKey" },
          { name: "collateralAmount", type: "u64" },
          { name: "collateralMint", type: "publicKey" },
          { name: "loanAmount", type: "u64" },
          { name: "loanMint", type: "publicKey" },
          { name: "installmentAmount", type: "u64" },
          { name: "totalInstallments", type: "u8" },
          { name: "installmentsPaid", type: "u8" },
          { name: "nextDueTimestamp", type: "i64" },
          { name: "gracePeriod", type: "i64" },
          { name: "status", type: { defined: "LoanStatus" } },
          { name: "createdAt", type: "i64" },
          { name: "annualRateBps", type: "u64" },
          { name: "vaultBump", type: "u8" },
        ],
      },
    },
  ],
  types: [
    {
      name: "LoanStatus",
      type: {
        kind: "enum",
        variants: [
          { name: "Active" },
          { name: "Repaid" },
          { name: "Liquidated" },
          { name: "CollateralWithdrawn" },
        ],
      },
    },
  ],
  errors: [
    { code: 6000, name: "InvalidInstallmentCount", msg: "Installment count must be 3, 6, or 12." },
    { code: 6001, name: "InvalidCollateralAmount", msg: "Collateral amount must be greater than zero." },
    { code: 6002, name: "InvalidLoanAmount", msg: "Loan amount must be greater than zero." },
    { code: 6003, name: "InterestRateTooHigh", msg: "Annual interest rate cannot exceed 50% (5000 bps)." },
    { code: 6004, name: "InsufficientCollateral", msg: "Collateral must be at least 150% of the loan amount (LTV 66%)." },
    { code: 6005, name: "MathOverflow", msg: "Arithmetic overflow during calculation." },
    { code: 6006, name: "LoanNotActive", msg: "Loan is not in Active status." },
    { code: 6007, name: "LoanNotRepaid", msg: "Loan is not in Repaid status — collateral cannot be withdrawn yet." },
    { code: 6008, name: "GracePeriodNotExpired", msg: "Grace period has not expired — liquidation not yet allowed." },
    { code: 6009, name: "Unauthorized", msg: "Caller is not authorised for this operation." },
  ],
};
