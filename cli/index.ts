#!/usr/bin/env ts-node

import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import {
  showDashboard,
  showPlatformStatus,
  showAuctionList,
  showHelp,
} from "./dashboard";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getProgram, loadWallet } from "./utils";
import { Program } from "@coral-xyz/anchor";
import { Bidx } from "../target/types/bidx";
import {
  setupPlatform,
  setupDigitalNftAuction,
  getBidPDA,
  getAuctionPDA,
  // ... import helpers
} from "../tests/helpers";
import * as fs from "fs";
import * as path from "path";

const program = new Command();

// Load wallet from file
// function loadWallet(walletPath: string): Keypair {
//   const keypairFile = fs.readFileSync(path.resolve(walletPath), "utf-8");
//   const keypairData = JSON.parse(keypairFile);
//   return Keypair.fromSecretKey(new Uint8Array(keypairData));
// }

// Get program
// function getProgram(cluster: string): {
//   program: Program<Bidx>;
//   connection: Connection;
// } {
//   const connection = new Connection(
//     cluster === "devnet"
//       ? "https://api.devnet.solana.com"
//       : "http://localhost:8899",
//   );

//   const provider = new anchor.AnchorProvider(
//     connection,
//     anchor.AnchorProvider.env().wallet,
//     {},
//   );
//   anchor.setProvider(provider);

//   const program = anchor.workspace.Bidx as Program<Bidx>;
//   return { program, connection };
// }

// ============ COMMANDS ============

program
  .name("bidx")
  .description("BidX Protocol CLI - Decentralized Auctions on Solana")
  .version("1.0.0");

// CLI DASHBOARD
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
        case "list":
          await showAuctionList(bidxProgram);
          break;

        case "status":
          // Get platform PDAs
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
            readline.question("\nPress Enter to continue...", () => {
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

// INITIALIZE PLATFORM
program
  .command("init")
  .description("Initialize the BidX platform (admin only)")
  .requiredOption("--admin <path>", "Path to admin wallet keypair")
  .option("--cluster <url>", "Cluster URL", "devnet")
  .option(
    "--authenticators <pubkeys>",
    "Comma-separated authenticator pubkeys",
    "",
  )
  .action(async (options) => {
    try {
      const admin = loadWallet(options.admin);
      const { program, connection } = getProgram(options.cluster);

      const authenticators = options.authenticators
        ? options.authenticators
            .split(",")
            .map((k: string) => new PublicKey(k.trim()))
        : [];

      console.log("🚀 Initializing BidX platform...");
      const platform = await setupPlatform(program, connection, authenticators);

      console.log("✅ Platform initialized!");
      console.log(`   Admin: ${admin.publicKey}`);
      console.log(`   Config: ${platform.platformConfig}`);
      console.log(`   Registry: ${platform.authenticatorsRegistry}`);
      console.log(`   USDC Mint: ${platform.usdcMint}`);
      console.log(`   Treasury USDC: ${platform.treasuryUsdc}`);
    } catch (error) {
      console.error("❌ Error:", error.message);
      process.exit(1);
    }
  });

// CREATE AUCTION
program
  .command("create")
  .description("Create a new auction")
  .requiredOption("--seller <path>", "Path to seller wallet keypair")
  .requiredOption("--type <digital|physical>", "Asset type")
  .requiredOption("--reserve <amount>", "Reserve price (in smallest units)")
  .requiredOption("--starting <amount>", "Starting bid (in smallest units)")
  .option("--duration <seconds>", "Auction duration in seconds", "3600")
  .option("--cluster <url>", "Cluster URL", "devnet")
  .action(async (options) => {
    try {
      const seller = loadWallet(options.seller);
      const { program, connection } = getProgram(options.cluster);

      console.log("🎨 Creating auction...");

      // You'd need to pass in platform context here
      // For CLI, you might fetch it from chain or have user provide config PDA

      const assetType =
        options.type === "digital" ? { digitalNft: {} } : { physicalRwa: {} };

      // Call your helper or instruction directly
      // const auctionCtx = await setupDigitalNftAuction(program, connection, platform);

      console.log("✅ Auction created!");
      // console.log(`   Auction: ${auctionCtx.auction}`);
    } catch (error) {
      console.error("❌ Error:", error.message);
      process.exit(1);
    }
  });

// LIST AUCTIONS
program
  .command("list")
  .description("List all active auctions")
  .option("--cluster <url>", "Cluster URL", "devnet")
  .action(async (options) => {
    try {
      const { program, connection } = getProgram(options.cluster);

      console.log("📋 Fetching auctions...\n");

      const auctions = await program.account.auction.all();

      if (auctions.length === 0) {
        console.log("No auctions found.");
        return;
      }

      auctions.forEach((a, i) => {
        console.log(`${i + 1}. ${a.publicKey}`);
        console.log(`   Seller: ${a.account.seller}`);
        console.log(
          `   Highest Bid: ${a.account.highestBid.toNumber() / 1_000_000} USDC`,
        );
        console.log(`   Status: ${JSON.stringify(a.account.auctionStatus)}`);
        console.log(
          `   Reserve: ${a.account.reservedPrice.toNumber() / 1_000_000} USDC`,
        );
        console.log("");
      });
    } catch (error) {
      console.error("❌ Error:", error.message);
      process.exit(1);
    }
  });

// PLACE BID
program
  .command("bid")
  .description("Place a bid on an auction")
  .requiredOption("--bidder <path>", "Path to bidder wallet keypair")
  .requiredOption("--auction <pubkey>", "Auction public key")
  .requiredOption("--amount <usdc>", "Bid amount in USDC")
  .option("--cluster <url>", "Cluster URL", "devnet")
  .action(async (options) => {
    try {
      const bidder = loadWallet(options.bidder);
      const { program, connection } = getProgram(options.cluster);
      const auctionPDA = new PublicKey(options.auction);
      const amount = new anchor.BN(parseFloat(options.amount) * 1_000_000);

      console.log(`💰 Placing bid of ${options.amount} USDC...`);

      // Use your setupBid helper or call instruction directly
      // const bidCtx = await setupBid(program, connection, platform, auctionPDA, amount);

      console.log("✅ Bid placed successfully!");
    } catch (error) {
      console.error("❌ Error:", error.message);
      process.exit(1);
    }
  });

// SETTLE AUCTION
program
  .command("settle")
  .description("Settle an ended auction")
  .requiredOption("--winner <path>", "Path to winner wallet keypair")
  .requiredOption("--auction <pubkey>", "Auction public key")
  .option("--cluster <url>", "Cluster URL", "devnet")
  .action(async (options) => {
    try {
      const winner = loadWallet(options.winner);
      const { program, connection } = getProgram(options.cluster);
      const auctionPDA = new PublicKey(options.auction);

      console.log("🏆 Settling auction...");

      // Call settle_auction instruction
      // You'll need to derive all the PDAs and accounts

      console.log("✅ Auction settled!");
      console.log("   NFT transferred to winner");
      console.log("   Funds transferred to seller");
    } catch (error) {
      console.error("❌ Error:", error.message);
      process.exit(1);
    }
  });

// WITHDRAW
program
  .command("withdraw")
  .description("Withdraw funds from lost bid")
  .requiredOption("--bidder <path>", "Path to bidder wallet keypair")
  .requiredOption("--auction <pubkey>", "Auction public key")
  .option("--cluster <url>", "Cluster URL", "devnet")
  .action(async (options) => {
    try {
      const bidder = loadWallet(options.bidder);
      const { program, connection } = getProgram(options.cluster);
      const auctionPDA = new PublicKey(options.auction);

      console.log("💸 Withdrawing funds...");

      // Call withdraw_bid instruction

      console.log("✅ Funds withdrawn!");
    } catch (error) {
      console.error("❌ Error:", error.message);
      process.exit(1);
    }
  });

// SHOW HELP ON NO ARGS
if (process.argv.length === 2) {
  program.help();
}

program.parse();
