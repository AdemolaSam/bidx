import { Keypair, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { Bidx } from "../../target/types/bidx";
import { Connection } from "@solana/web3.js";
import chalk from "chalk";
import inquirer from "inquirer";
import { setupPlatform } from "../../tests/helpers";
import { getExplorerUrl } from "../utils";

export async function initCommand(
  program: Program<Bidx>,
  connection: Connection,
  cluster: string,
) {
  console.clear();
  console.log(chalk.bold.cyan("\n🚀 Initialize BidX Platform\n"));
  console.log(chalk.gray("━".repeat(5)));

  const answers = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "This will initialize the platform. Continue?",
      default: false,
    },
    {
      type: "input",
      name: "authenticators",
      message:
        "Enter authenticator public keys (comma-separated, or leave empty):",
      default: "",
      when: (answers) => answers.confirm,
    },
  ]);

  if (!answers.confirm) {
    console.log(chalk.yellow("\n⚠️  Cancelled.\n"));
    return;
  }

  try {
    console.log(chalk.cyan("\n⏳ Initializing platform...\n"));

    // FIX: Parse as PublicKey, not Keypair
    const authenticators = answers.authenticators
      ? answers.authenticators
          .split(",")
          .map((k: string) => new PublicKey(k.trim()))
      : [];

    const platform = await setupPlatform(program, connection, authenticators);

    console.log(chalk.green("\n✅ Platform initialized successfully!\n"));
    console.log(chalk.white("Platform Details:"));
    console.log(
      `  ${chalk.gray("›")} Admin: ${chalk.yellow(platform.admin.publicKey)}`,
    );
    console.log(
      `  ${chalk.gray("›")} Config PDA: ${chalk.cyan(platform.platformConfig)}`,
    );
    console.log(
      `  ${chalk.gray("›")} Registry PDA: ${chalk.cyan(
        platform.authenticatorsRegistry,
      )}`,
    );
    console.log(
      `  ${chalk.gray("›")} USDC Mint: ${chalk.cyan(platform.usdcMint)}`,
    );
    console.log(
      `  ${chalk.gray("›")} Treasury USDC: ${chalk.cyan(
        platform.treasuryUsdc,
      )}`,
    );
    console.log(
      `  ${chalk.gray("›")} Authenticators: ${chalk.yellow(
        authenticators.length,
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
