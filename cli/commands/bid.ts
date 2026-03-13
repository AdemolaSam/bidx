import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { Bidx } from "../../target/types/bidx";
import { Connection, Keypair } from "@solana/web3.js";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  validatePublicKey,
  loadWallet,
  parseUsdcAmount,
  getBidPDA,
  getExplorerUrl,
} from "../utils";

export async function bidCommand(
  program: Program<Bidx>,
  connection: Connection,
  cluster: string,
  bidderPath?: string,
  auctionPubkey?: string,
  amountUsdc?: string,
) {
  console.clear();
  console.log(chalk.bold.cyan("\n💰 Place Bid\n"));
  console.log(chalk.gray("━".repeat(70)));

  let bidder: Keypair;
  let auction: string;
  let amount: string;

  // Interactive prompts if args not provided
  if (!bidderPath || !auctionPubkey || !amountUsdc) {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "bidderPath",
        message: "Path to bidder wallet keypair:",
        default: "~/.config/solana/id.json",
        when: !bidderPath,
      },
      {
        type: "input",
        name: "auction",
        message: "Auction public key:",
        when: !auctionPubkey,
        validate: (input) => {
          try {
            validatePublicKey(input);
            return true;
          } catch {
            return "Invalid public key";
          }
        },
      },
      {
        type: "input",
        name: "amount",
        message: "Bid amount (USDC):",
        when: !amountUsdc,
        validate: (input) =>
          (!isNaN(parseFloat(input)) && parseFloat(input) > 0) ||
          "Must be positive number",
      },
    ]);

    bidderPath = bidderPath || answers.bidderPath;
    auction = auctionPubkey || answers.auction;
    amount = amountUsdc || answers.amount;
  } else {
    auction = auctionPubkey;
    amount = amountUsdc;
  }

  try {
    bidder = loadWallet(bidderPath);
    const auctionPDA = validatePublicKey(auction);
    const bidAmount = parseUsdcAmount(amount);

    console.log(chalk.cyan("\n⏳ Placing bid...\n"));

    // Fetch auction data to get accepted token
    const auctionData = await program.account.auction.fetch(auctionPDA);
    const tokenMint = auctionData.acceptedToken;

    console.log(chalk.yellow(`  › Payment token: ${tokenMint}`));

    // Get or create bidder's token account
    console.log(chalk.yellow("  › Setting up bidder token account..."));
    const bidderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      bidder,
      tokenMint,
      bidder.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Check if bidder has enough tokens, if not mint some (for testing)
    const balance = Number(bidderTokenAccount.amount);
    if (balance < bidAmount.toNumber()) {
      console.log(chalk.yellow(`  › Minting ${amount} USDC for testing...`));

      // Get platform config to find who can mint (usually admin/test mint)
      // For testing, we'll just mint to the bidder
      try {
        await mintTo(
          connection,
          bidder,
          tokenMint,
          bidderTokenAccount.address,
          bidder.publicKey,
          bidAmount.toNumber(),
          [],
          undefined,
          TOKEN_PROGRAM_ID,
        );
      } catch (error: any) {
        console.log(
          chalk.red(
            `  ✗ Could not mint tokens (you may not be mint authority)`,
          ),
        );
        console.log(
          chalk.yellow(`  › Current balance: ${balance / 1_000_000} USDC`),
        );
        console.log(chalk.yellow(`  › Required: ${amount} USDC`));
        throw new Error("Insufficient token balance");
      }
    }

    console.log(chalk.green("  ✓ Token account ready"));

    // Derive bid PDA
    const [bid] = getBidPDA(bidder.publicKey, auctionPDA, program.programId);

    const escrowVault = getAssociatedTokenAddressSync(
      tokenMint,
      bid,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Place bid
    console.log(chalk.yellow("  › Submitting bid on-chain..."));

    const signature = await program.methods
      .placeBid(bidAmount)
      .accountsPartial({
        bidder: bidder.publicKey,
        bid,
        auction: auctionPDA,
        bidderTokenAccount: bidderTokenAccount.address,
        escrowVault,
        tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder])
      .rpc();

    console.log(chalk.green("\n✅ Bid placed successfully!\n"));
    console.log(chalk.white("Bid Details:"));
    console.log(`  ${chalk.gray("›")} Auction: ${chalk.cyan(auctionPDA)}`);
    console.log(`  ${chalk.gray("›")} Amount: ${chalk.yellow(amount)} USDC`);
    console.log(
      `  ${chalk.gray("›")} Bidder: ${chalk.yellow(bidder.publicKey)}`,
    );
    console.log(`  ${chalk.gray("›")} Bid PDA: ${chalk.cyan(bid)}`);
    console.log(
      `  ${chalk.gray("›")} Transaction: ${chalk.blue(
        getExplorerUrl(signature, cluster),
      )}`,
    );
  } catch (error: any) {
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
    if (error.logs) {
      console.log(chalk.gray("Program logs:"));
      error.logs.forEach((log: string) => console.log(chalk.gray(`  ${log}`)));
    }
  }

  await inquirer.prompt([
    {
      type: "input",
      name: "continue",
      message: "\nPress Enter to continue...",
    },
  ]);
}
