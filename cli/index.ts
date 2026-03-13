#!/usr/bin/env tsx

import { Command } from "commander";
import {
  showDashboard,
  showPlatformStatus,
  showAuctionList,
  showHelp,
} from "./dashboard";
import { getProgram } from "./utils";
import { initCommand } from "./commands/init";
import { viewCommand } from "./commands/view";
import { settleCommand } from "./commands/settle";
import { withdrawCommand } from "./commands/withdraw";
import { createCommand } from "./commands/create";
import * as anchor from "@coral-xyz/anchor";

const program = new Command();

program.name("bidx").description("BidX Protocol CLI").version("1.0.0");

// ❌ REMOVE isDefault from dashboard
program
  .command("dashboard") // ← Remove { isDefault: true }
  .description("Launch interactive dashboard")
  .option("--cluster <url>", "Cluster URL", "devnet")
  .action(async (options) => {
    const { program: bidxProgram, connection } = getProgram(options.cluster);

    let running = true;
    while (running) {
      const action = await showDashboard();

      switch (action) {
        case "init":
          await initCommand(bidxProgram, connection, options.cluster);
          break;

        case "view":
          await viewCommand(bidxProgram, connection, options.cluster);
          break;

        case "settle":
          await settleCommand(bidxProgram, connection, options.cluster);
          break;

        case "withdraw":
          await withdrawCommand(bidxProgram, connection, options.cluster);
          break;

        case "list":
          await showAuctionList(bidxProgram);
          break;

        case "status":
          const [platformConfig] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("config")],
            bidxProgram.programId,
          );
          const [registry] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("authenticators_registry")],
            bidxProgram.programId,
          );
          await showPlatformStatus(
            bidxProgram,
            connection,
            platformConfig,
            registry,
          );
          break;

        case "help":
          showHelp();
          await new Promise((resolve) => {
            const readline = require("readline").createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            readline.question("", () => {
              readline.close();
              resolve(null);
            });
          });
          break;

        case "exit":
          console.log("\n👋 Goodbye!\n");
          running = false;
          break;

        default:
          console.log(`\n⚠️  Feature "${action}" coming soon!\n`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  });

// Direct commands
program
  .command("init")
  .description("Initialize platform")
  .option("--cluster <url>", "Cluster", "devnet")
  .action(async (options) => {
    const { program: bidxProgram, connection } = getProgram(options.cluster);
    await initCommand(bidxProgram, connection, options.cluster);
  });

program
  .command("list")
  .description("List all auctions")
  .option("--cluster <url>", "Cluster", "devnet")
  .action(async (options) => {
    const { program: bidxProgram } = getProgram(options.cluster);
    await showAuctionList(bidxProgram);
  });

program
  .command("view")
  .description("View auction details")
  .requiredOption("--auction <pubkey>", "Auction public key") // ← Add requiredOption
  .option("--cluster <url>", "Cluster", "devnet")
  .action(async (options) => {
    const { program: bidxProgram, connection } = getProgram(options.cluster);
    await viewCommand(
      bidxProgram,
      connection,
      options.cluster,
      options.auction,
    );
  });

program
  .command("settle")
  .description("Settle an ended auction")
  .requiredOption("--winner <path>", "Path to winner wallet keypair")
  .requiredOption("--auction <pubkey>", "Auction public key")
  .option("--cluster <url>", "Cluster", "devnet")
  .action(async (options) => {
    const { program: bidxProgram, connection } = getProgram(options.cluster);
    await settleCommand(
      bidxProgram,
      connection,
      options.cluster,
      options.winner,
      options.auction,
    );
  });

program
  .command("create")
  .description("Create a new auction")
  .option("--seller <path>", "Path to seller wallet keypair")
  .option("--type <digital|physical>", "Asset type")
  .option("--starting <amount>", "Starting bid in USDC")
  .option("--reserve <amount>", "Reserve price in USDC")
  .option("--duration <seconds>", "Auction duration in seconds")
  .option("--cluster <url>", "Cluster", "devnet")
  .action(async (options) => {
    const { program: bidxProgram, connection } = getProgram(options.cluster);
    await createCommand(
      bidxProgram,
      connection,
      options.cluster,
      options.seller,
      options.type,
      options.starting,
      options.reserve,
      options.duration,
    );
  });

program
  .command("withdraw")
  .description("Withdraw funds from lost bid")
  .requiredOption("--bidder <path>", "Path to bidder wallet keypair")
  .requiredOption("--auction <pubkey>", "Auction public key")
  .option("--cluster <url>", "Cluster", "devnet")
  .action(async (options) => {
    const { program: bidxProgram, connection } = getProgram(options.cluster);
    await withdrawCommand(
      bidxProgram,
      connection,
      options.cluster,
      options.bidder,
      options.auction,
    );
  });

// ✅ ADD: Default action when no command provided
program.action(async () => {
  const { program: bidxProgram, connection } = getProgram("devnet");

  let running = true;
  while (running) {
    const action = await showDashboard();

    switch (action) {
      case "init":
        await initCommand(bidxProgram, connection, "devnet");
        break;

      case "view":
        await viewCommand(bidxProgram, connection, "devnet");
        break;

      case "settle":
        await settleCommand(bidxProgram, connection, "devnet");
        break;

      case "withdraw":
        await withdrawCommand(bidxProgram, connection, "devnet");
        break;

      case "list":
        await showAuctionList(bidxProgram);
        break;

      case "status":
        const [platformConfig] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("config")],
          bidxProgram.programId,
        );
        const [registry] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("authenticators_registry")],
          bidxProgram.programId,
        );
        await showPlatformStatus(
          bidxProgram,
          connection,
          platformConfig,
          registry,
        );
        break;

      case "help":
        showHelp();
        await new Promise((resolve) => {
          const readline = require("readline").createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          readline.question("", () => {
            readline.close();
            resolve(null);
          });
        });
        break;

      case "exit":
        console.log("\n👋 Goodbye!\n");
        running = false;
        break;

      default:
        console.log(`\n⚠️  Feature "${action}" coming soon!\n`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
});

program.parse();
