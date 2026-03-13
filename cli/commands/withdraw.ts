import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { Bidx } from "../../target/types/bidx";
import { Connection, Keypair } from "@solana/web3.js";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  validatePublicKey,
  loadWallet,
  getBidPDA,
  getExplorerUrl,
} from "../utils";

export async function withdrawCommand(
  program: Program<Bidx>,
  connection: Connection,
  cluster: string,
  bidderPath?: string,
  auctionPubkey?: string,
) {
  console.clear();
  console.log(chalk.bold.cyan("\n💸 Withdraw Bid Funds\n"));
  console.log(chalk.gray("━".repeat(5)));

  let bidder: Keypair;
  let auction: string;

  if (!bidderPath || !auctionPubkey) {
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
    ]);

    bidderPath = bidderPath || answers.bidderPath;
    auction = auctionPubkey || answers.auction;
  } else {
    auction = auctionPubkey;
  }

  try {
    bidder = loadWallet(bidderPath);
    const auctionPDA = validatePublicKey(auction);

    console.log(chalk.cyan("\n⏳ Withdrawing funds...\n"));

    // Fetch auction data
    const auctionData = await program.account.auction.fetch(auctionPDA);
    const [bid] = getBidPDA(bidder.publicKey, auctionPDA, program.programId);

    const escrowVault = getAssociatedTokenAddressSync(
      auctionData.acceptedToken,
      bid,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const bidderTokenAccount = getAssociatedTokenAddressSync(
      auctionData.acceptedToken,
      bidder.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const signature = await program.methods
      .withdrawBid(new BN(0))
      .accountsStrict({
        bidder: bidder.publicKey,
        seller: auctionData.seller,
        auction: auctionPDA,
        bid,
        escrowVault,
        bidderTokenAccount,
        tokenMint: auctionData.acceptedToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder])
      .rpc();

    console.log(chalk.green("\n✅ Funds withdrawn successfully!\n"));
    console.log(chalk.white("Withdrawal Details:"));
    console.log(`  ${chalk.gray("›")} Transaction: ${chalk.cyan(signature)}`);
    console.log(
      `  ${chalk.gray("›")} Explorer: ${chalk.blue(
        getExplorerUrl(signature, cluster),
      )}`,
    );
    console.log(
      `  ${chalk.gray("›")} Funds returned to: ${chalk.yellow(
        bidder.publicKey,
      )}`,
    );
  } catch (error: any) {
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
  }

  console.log(chalk.gray("\n━".repeat(5)));
  await inquirer.prompt([
    { type: "input", name: "continue", message: "Press Enter to continue..." },
  ]);
}
