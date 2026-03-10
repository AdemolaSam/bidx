#!/usr/bin/env ts-node

import { Command } from "commander";
import {
  showDashboard,
  showPlatformStatus,
  showAuctionList,
  showHelp,
} from "./dashboard";
import { getProgram } from "./utils";
import { initCommand } from "./commands/init";
import { createCommand } from "./commands/create";
import { bidCommand } from "./commands/bid";
import * as anchor from "@coral-xyz/anchor";

const program = new Command();

program.name("bidx").description("BidX Protocol CLI").version("1.0.0");

// Dashboard (default)
program
  .command("dashboard", { isDefault: true })
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

        case "create":
          // You'd need to fetch platform context first
          console.log("\n⚠️  Feature coming soon! Use: yarn cli create\n");
          await new Promise((resolve) => setTimeout(resolve, 2000));
          break;

        case "bid":
          console.log("\n⚠️  Feature coming soon! Use: yarn cli bid\n");
          await new Promise((resolve) => setTimeout(resolve, 2000));
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

// ... add other direct commands similarly

program.parse();
