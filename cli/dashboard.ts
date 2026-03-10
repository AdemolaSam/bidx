import chalk from "chalk";
import figlet from "figlet";
import inquirer, { Separator } from "inquirer";
import { Connection, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { Bidx } from "../target/types/bidx";

export async function showDashboard() {
  console.clear();

  // ASCII Art Banner
  console.log(
    chalk.cyan(
      figlet.textSync("BidX", {
        font: "ANSI Shadow",
        horizontalLayout: "default",
      }),
    ),
  );

  console.log(chalk.gray("━".repeat(70)));
  console.log(chalk.bold.white("  Decentralized Auction Protocol on Solana"));
  console.log(chalk.gray("━".repeat(70)));
  console.log("");

  // Main Menu - FIX: Use proper type
  const answers = await inquirer.prompt<{ action: string }>([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        {
          name: `${chalk.green("🚀")} Initialize Platform ${chalk.gray(
            "(Admin Only)",
          )}`,
          value: "init",
        },
        {
          name: `${chalk.blue("📋")} List Active Auctions`,
          value: "list",
        },
        {
          name: `${chalk.yellow("🎨")} Create New Auction`,
          value: "create",
        },
        {
          name: `${chalk.magenta("💰")} Place Bid`,
          value: "bid",
        },
        {
          name: `${chalk.cyan("🔍")} View Auction Details`,
          value: "view",
        },
        {
          name: `${chalk.green("🏆")} Settle Auction`,
          value: "settle",
        },
        {
          name: `${chalk.red("💸")} Withdraw Funds`,
          value: "withdraw",
        },
        new Separator(), // ← Now properly imported
        {
          name: `${chalk.white("⚙️ ")} Platform Status`,
          value: "status",
        },
        {
          name: `${chalk.white("👤")} My Account Info`,
          value: "account",
        },
        new Separator(),
        {
          name: `${chalk.gray("❓")} Help & Commands`,
          value: "help",
        },
        {
          name: `${chalk.gray("❌")} Exit`,
          value: "exit",
        },
      ],
      pageSize: 15,
    },
  ]);

  return answers.action; // ← Fix: Use answers.action instead of destructuring
}

export async function showPlatformStatus(
  program: Program<Bidx>,
  connection: Connection,
  platformConfigPDA: PublicKey,
  registryPDA: PublicKey,
) {
  console.clear();
  console.log(chalk.bold.cyan("\n📊 Platform Status\n"));
  console.log(chalk.gray("━".repeat(70)));

  try {
    const config = await program.account.platformConfig.fetch(
      platformConfigPDA,
    );
    const registry = await program.account.authenticatorsRegistry.fetch(
      registryPDA,
    );

    console.log(chalk.white("Platform Configuration:"));
    console.log(
      `  ${chalk.gray("›")} Admin: ${chalk.yellow(config.admin.toString())}`,
    );
    console.log(
      `  ${chalk.gray("›")} Platform Fee: ${chalk.green(
        config.platformFeeBps / 100,
      )}%`,
    );
    console.log(
      `  ${chalk.gray("›")} Auth Fee: ${chalk.green(config.authFeeBps / 100)}%`,
    );
    console.log(
      `  ${chalk.gray("›")} Status: ${
        config.isPaused ? chalk.red("PAUSED") : chalk.green("ACTIVE")
      }`,
    );
    console.log(
      `  ${chalk.gray("›")} Min Duration: ${chalk.cyan(
        config.minAuctionDuration.toString(),
      )}s`,
    );
    console.log(
      `  ${chalk.gray("›")} Max Duration: ${chalk.cyan(
        config.maxAuctionDuration.toString(),
      )}s`,
    );

    console.log("");
    console.log(chalk.white("Authenticators:"));
    console.log(
      `  ${chalk.gray("›")} Total Registered: ${chalk.yellow(
        registry.authenticators.length,
      )}`,
    );
    console.log(
      `  ${chalk.gray("›")} Next Assigned: ${chalk.cyan(
        `#${registry.nextIndex.toString()}`,
      )}`,
    );

    const cluster = connection.rpcEndpoint.includes("devnet")
      ? "devnet"
      : "localnet";
    console.log("");
    console.log(chalk.white("Network:"));
    console.log(`  ${chalk.gray("›")} Cluster: ${chalk.yellow(cluster)}`);
    console.log(
      `  ${chalk.gray("›")} Program ID: ${chalk.cyan(
        program.programId.toString(),
      )}`,
    );
  } catch (error) {
    console.log(
      chalk.red(`\n❌ Error fetching platform status: ${error.message}`),
    );
  }

  console.log(chalk.gray("\n━".repeat(70)));
  await inquirer.prompt([
    { type: "input", name: "continue", message: "Press Enter to continue..." },
  ]);
}

export async function showAuctionList(program: Program<Bidx>) {
  console.clear();
  console.log(chalk.bold.cyan("\n📋 Active Auctions\n"));
  console.log(chalk.gray("━".repeat(70)));

  try {
    const auctions = await program.account.auction.all();

    if (auctions.length === 0) {
      console.log(chalk.yellow("\n  No auctions found.\n"));
    } else {
      auctions.forEach((a, i) => {
        const status = Object.keys(a.account.auctionStatus)[0];
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
          chalk.white(
            `${i + 1}. Auction #${a.publicKey.toString().slice(0, 8)}...`,
          ),
        );
        console.log(
          `   ${chalk.gray("│")} Seller: ${chalk.cyan(
            a.account.seller.toString().slice(0, 12),
          )}...`,
        );
        console.log(
          `   ${chalk.gray("│")} Current Bid: ${chalk.yellow(
            (a.account.highestBid.toNumber() / 1_000_000).toFixed(2),
          )} USDC`,
        );
        console.log(
          `   ${chalk.gray("│")} Reserve: ${chalk.magenta(
            (a.account.reservedPrice.toNumber() / 1_000_000).toFixed(2),
          )} USDC`,
        );
        console.log(
          `   ${chalk.gray("│")} Status: ${statusColor(status.toUpperCase())}`,
        );
        console.log(
          `   ${chalk.gray("└")} Pubkey: ${chalk.gray(a.publicKey.toString())}`,
        );
        console.log("");
      });
    }
  } catch (error) {
    console.log(chalk.red(`\n❌ Error fetching auctions: ${error.message}`));
  }

  console.log(chalk.gray("━".repeat(70)));
  await inquirer.prompt([
    { type: "input", name: "continue", message: "Press Enter to continue..." },
  ]);
}

export function showHelp() {
  console.clear();
  console.log(chalk.bold.cyan("\n❓ BidX CLI Help\n"));
  console.log(chalk.gray("━".repeat(70)));

  console.log(chalk.white("\nAvailable Commands:\n"));

  const commands = [
    { cmd: "yarn cli", desc: "Launch interactive dashboard" },
    { cmd: "yarn cli init", desc: "Initialize platform (admin only)" },
    { cmd: "yarn cli list", desc: "List all auctions" },
    { cmd: "yarn cli create", desc: "Create a new auction" },
    { cmd: "yarn cli bid", desc: "Place a bid on an auction" },
    { cmd: "yarn cli settle", desc: "Settle an ended auction" },
    { cmd: "yarn cli withdraw", desc: "Withdraw funds from lost bid" },
    { cmd: "yarn cli status", desc: "View platform status" },
  ];

  commands.forEach(({ cmd, desc }) => {
    console.log(`  ${chalk.cyan(cmd.padEnd(25))} ${chalk.gray("→")} ${desc}`);
  });

  console.log(chalk.white("\n\nExample Usage:\n"));
  console.log(chalk.gray("  # Initialize platform"));
  console.log(chalk.cyan("  yarn cli init --admin ~/.config/solana/id.json\n"));

  console.log(chalk.gray("  # Create digital NFT auction"));
  console.log(
    chalk.cyan("  yarn cli create --seller ./keypair.json --type digital \\"),
  );
  console.log(chalk.cyan("    --reserve 100 --starting 50\n"));

  console.log(chalk.gray("  # Place bid"));
  console.log(chalk.cyan("  yarn cli bid --bidder ./keypair.json \\"));
  console.log(chalk.cyan("    --auction AxBz8... --amount 150\n"));

  console.log(chalk.white("\nDocumentation:\n"));
  console.log(
    `  ${chalk.gray("›")} GitHub: ${chalk.blue(
      "https://github.com/AdemolaSam/BidX-Protocol",
    )}`,
  );
  console.log(
    `  ${chalk.gray("›")} Devnet Explorer: ${chalk.blue(
      "https://explorer.solana.com/?cluster=devnet",
    )}`,
  );

  console.log(chalk.gray("\n━".repeat(70)));
}
