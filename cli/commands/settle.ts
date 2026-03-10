import {
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { Bidx } from "../../target/types/bidx";
import { Connection, Keypair } from "@solana/web3.js";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import {
  validatePublicKey,
  loadWallet,
  getBidPDA,
  getExplorerUrl,
} from "../utils";

export async function settleCommand(
  program: Program<Bidx>,
  connection: Connection,
  cluster: string,
  winnerPath?: string,
  auctionPubkey?: string,
) {
  console.clear();
  console.log(chalk.bold.cyan("\n🏆 Settle Auction\n"));
  console.log(chalk.gray("━".repeat(70)));

  let winner: Keypair;
  let auction: string;

  if (!winnerPath || !auctionPubkey) {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "winnerPath",
        message: "Path to winner wallet keypair:",
        default: "~/.config/solana/id.json",
        when: !winnerPath,
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

    winnerPath = winnerPath || answers.winnerPath;
    auction = auctionPubkey || answers.auction;
  } else {
    auction = auctionPubkey;
  }

  try {
    winner = loadWallet(winnerPath);
    const auctionPDA = validatePublicKey(auction);

    console.log(chalk.cyan("\n⏳ Settling auction...\n"));

    // Fetch auction data
    const auctionData = await program.account.auction.fetch(auctionPDA);
    const [bid] = getBidPDA(winner.publicKey, auctionPDA, program.programId);

    // Derive accounts
    const escrowVault = getAssociatedTokenAddressSync(
      auctionData.acceptedToken,
      bid,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const sellerTokenAccount = getAssociatedTokenAddressSync(
      auctionData.acceptedToken,
      auctionData.seller,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const winnerNftAccount = getAssociatedTokenAddressSync(
      auctionData.nftMint,
      winner.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Create winner NFT account if needed
    try {
      await connection.getAccountInfo(winnerNftAccount);
    } catch {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          winner.publicKey,
          winnerNftAccount,
          winner.publicKey,
          auctionData.nftMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      await sendAndConfirmTransaction(connection, tx, [winner]);
    }

    // Get platform config
    const [platformConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId,
    );

    const config = await program.account.platformConfig.fetch(platformConfig);

    const treasury = getAssociatedTokenAddressSync(
      auctionData.acceptedToken,
      platformConfig,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Settle
    const signature = await program.methods
      .settleAuction(new BN(0))
      .accountsStrict({
        winner: winner.publicKey,
        seller: auctionData.seller,
        authenticator: config.admin,
        auction: auctionPDA,
        bid,
        authentication: null,
        platformConfig,
        escrowVault,
        sellerTokenAccount,
        treasury,
        authenticatorTokenAccount: null,
        nftMint: auctionData.nftMint,
        itemVault: auctionData.itemVault,
        winnerNftAccount,
        tokenMint: auctionData.acceptedToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([winner])
      .rpc();

    console.log(chalk.green("\n✅ Auction settled successfully!\n"));
    console.log(chalk.white("Settlement Details:"));
    console.log(`  ${chalk.gray("›")} Transaction: ${chalk.cyan(signature)}`);
    console.log(
      `  ${chalk.gray("›")} Explorer: ${chalk.blue(
        getExplorerUrl(signature, cluster),
      )}`,
    );
    console.log(
      `  ${chalk.gray("›")} NFT transferred to: ${chalk.yellow(
        winner.publicKey,
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
