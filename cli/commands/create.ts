import { Keypair, PublicKey } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { Bidx } from "../../target/types/bidx";
import { Connection } from "@solana/web3.js";
import chalk from "chalk";
import inquirer from "inquirer";
import { setupDigitalNftAuction } from "../../tests/helpers";
import { parseUsdcAmount, getExplorerUrl } from "../utils";

export async function createCommand(
  program: Program<Bidx>,
  connection: Connection,
  cluster: string,
  platformContext: any, // You'd need to fetch or pass this
) {
  console.clear();
  console.log(chalk.bold.cyan("\n🎨 Create New Auction\n"));
  console.log(chalk.gray("━".repeat(70)));

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "assetType",
      message: "Asset type:",
      choices: [
        { name: "Digital NFT", value: "digital" },
        { name: "Physical RWA", value: "physical" },
      ],
    },
    {
      type: "input",
      name: "startingBid",
      message: "Starting bid (USDC):",
      validate: (input) => !isNaN(parseFloat(input)) || "Must be a number",
    },
    {
      type: "input",
      name: "reservePrice",
      message: "Reserve price (USDC):",
      validate: (input) => !isNaN(parseFloat(input)) || "Must be a number",
    },
    {
      type: "input",
      name: "duration",
      message: "Auction duration (seconds):",
      default: "3600",
      validate: (input) => !isNaN(parseInt(input)) || "Must be a number",
    },
  ]);

  try {
    console.log(chalk.cyan("\n⏳ Creating auction...\n"));

    const auctionCtx = await setupDigitalNftAuction(
      program,
      connection,
      platformContext,
    );

    console.log(chalk.green("\n✅ Auction created successfully!\n"));
    console.log(chalk.white("Auction Details:"));
    console.log(
      `  ${chalk.gray("›")} Auction: ${chalk.cyan(auctionCtx.auction)}`,
    );
    console.log(
      `  ${chalk.gray("›")} NFT Mint: ${chalk.yellow(auctionCtx.nftMint)}`,
    );
    console.log(
      `  ${chalk.gray("›")} Starting Bid: ${chalk.green(
        answers.startingBid,
      )} USDC`,
    );
    console.log(
      `  ${chalk.gray("›")} Reserve: ${chalk.magenta(
        answers.reservePrice,
      )} USDC`,
    );
    console.log(
      `  ${chalk.gray("›")} Explorer: ${chalk.blue(
        getExplorerUrl(auctionCtx.auction.toString(), cluster, "address"),
      )}`,
    );
  } catch (error: any) {
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
  }

  console.log(chalk.gray("\n━".repeat(70)));
  await inquirer.prompt([
    { type: "input", name: "continue", message: "Press Enter to continue..." },
  ]);
}
