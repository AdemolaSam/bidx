import { PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { Bidx } from "../../target/types/bidx";
import { Connection } from "@solana/web3.js";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  validatePublicKey,
  formatAmount,
  formatTimestamp,
  getAuthenticationPDA,
} from "../utils";

export async function viewCommand(
  program: Program<Bidx>,
  connection: Connection,
  cluster: string,
  auctionPubkey?: string,
) {
  console.clear();
  console.log(chalk.bold.cyan("\n🔍 View Auction Details\n"));
  console.log(chalk.gray("━".repeat(70)));

  let auction = auctionPubkey;

  if (!auction) {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "auction",
        message: "Auction public key:",
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
    auction = answer.auction;
  }

  try {
    const auctionPDA = validatePublicKey(auction);
    console.log(chalk.cyan("\n⏳ Fetching auction data...\n"));

    const auctionData = await program.account.auction.fetch(auctionPDA);

    // FIX: Derive authentication PDA
    const [authPDA] = getAuthenticationPDA(auctionPDA, program.programId);
    const authData = await program.account.authentication
      .fetch(authPDA)
      .catch(() => null);

    console.log(chalk.green("✅ Auction Details:\n"));
    console.log(chalk.white("Basic Info:"));
    console.log(`  ${chalk.gray("›")} Auction: ${chalk.cyan(auctionPDA)}`);
    console.log(
      `  ${chalk.gray("›")} Seller: ${chalk.yellow(auctionData.seller)}`,
    );
    console.log(
      `  ${chalk.gray("›")} NFT Mint: ${chalk.yellow(auctionData.nftMint)}`,
    );

    const status = Object.keys(auctionData.auctionStatus)[0];
    const statusColor =
      status === "active"
        ? chalk.green
        : status === "pending"
        ? chalk.yellow
        : status === "ended"
        ? chalk.blue
        : status === "settled"
        ? chalk.gray
        : chalk.red;
    console.log(
      `  ${chalk.gray("›")} Status: ${statusColor(status.toUpperCase())}`,
    );

    console.log("\n" + chalk.white("Bidding:"));
    console.log(
      `  ${chalk.gray("›")} Starting Bid: ${chalk.green(
        formatAmount(auctionData.startingBid),
      )} USDC`,
    );
    console.log(
      `  ${chalk.gray("›")} Reserve Price: ${chalk.magenta(
        formatAmount(auctionData.reservedPrice),
      )} USDC`,
    );
    console.log(
      `  ${chalk.gray("›")} Current Bid: ${chalk.yellow(
        formatAmount(auctionData.highestBid),
      )} USDC`,
    );

    const noBidder =
      auctionData.highestBidder.toString() ===
      "11111111111111111111111111111111";
    console.log(
      `  ${chalk.gray("›")} Highest Bidder: ${
        noBidder ? chalk.gray("None") : chalk.cyan(auctionData.highestBidder)
      }`,
    );

    console.log("\n" + chalk.white("Timeline:"));
    console.log(
      `  ${chalk.gray("›")} Start: ${chalk.cyan(
        formatTimestamp(auctionData.startDate),
      )}`,
    );
    console.log(
      `  ${chalk.gray("›")} End: ${chalk.cyan(
        formatTimestamp(auctionData.endDate),
      )}`,
    );

    const assetType = Object.keys(auctionData.assetType)[0];
    console.log("\n" + chalk.white("Asset:"));
    console.log(
      `  ${chalk.gray("›")} Type: ${chalk.yellow(
        assetType === "digitalNft" ? "Digital NFT" : "Physical RWA",
      )}`,
    );

    if (authData) {
      const authStatus = Object.keys(authData.authStatus)[0];
      console.log(
        `  ${chalk.gray("›")} Auth Status: ${chalk.cyan(
          authStatus.toUpperCase(),
        )}`,
      );
      console.log(
        `  ${chalk.gray("›")} Authenticator: ${chalk.yellow(
          authData.authenticator,
        )}`,
      );

      if (authData.metadataHash) {
        console.log(
          `  ${chalk.gray("›")} Metadata: ${chalk.blue(
            "ipfs://" + authData.metadataHash,
          )}`,
        );
      }
      if (authData.reportHash) {
        console.log(
          `  ${chalk.gray("›")} Report: ${chalk.blue(
            "ipfs://" + authData.reportHash,
          )}`,
        );
      }
    }
  } catch (error: any) {
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
  }

  console.log(chalk.gray("\n━".repeat(70)));
  await inquirer.prompt([
    { type: "input", name: "continue", message: "Press Enter to continue..." },
  ]);
}
