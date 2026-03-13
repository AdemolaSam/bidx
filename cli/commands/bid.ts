import { PublicKey } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { Bidx } from "../../target/types/bidx";
import { Connection } from "@solana/web3.js";
import chalk from "chalk";
import inquirer from "inquirer";
import { setupBid } from "../../tests/helpers";
import { parseUsdcAmount, validatePublicKey } from "../utils";

export async function bidCommand(
  program: Program<Bidx>,
  connection: Connection,
  cluster: string,
  platformContext: any,
) {
  console.clear();
  console.log(chalk.bold.cyan("\n💰 Place Bid\n"));
  console.log(chalk.gray("━".repeat(5)));

  const answers = await inquirer.prompt([
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
    {
      type: "input",
      name: "amount",
      message: "Bid amount (USDC):",
      validate: (input) =>
        (!isNaN(parseFloat(input)) && parseFloat(input) > 0) ||
        "Must be positive number",
    },
  ]);

  try {
    const auctionPDA = validatePublicKey(answers.auction);
    const amount = parseUsdcAmount(answers.amount);

    console.log(chalk.cyan("\n⏳ Placing bid...\n"));

    const bidCtx = await setupBid(
      program,
      connection,
      platformContext,
      auctionPDA,
      amount,
    );

    console.log(chalk.green("\n✅ Bid placed successfully!\n"));
    console.log(chalk.white("Bid Details:"));
    console.log(`  ${chalk.gray("›")} Auction: ${chalk.cyan(answers.auction)}`);
    console.log(
      `  ${chalk.gray("›")} Amount: ${chalk.yellow(answers.amount)} USDC`,
    );
    console.log(`  ${chalk.gray("›")} Bid PDA: ${chalk.cyan(bidCtx.bid)}`);
  } catch (error: any) {
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
  }

  console.log(chalk.gray("\n━".repeat(5)));
  await inquirer.prompt([
    { type: "input", name: "continue", message: "Press Enter to continue..." },
  ]);
}
