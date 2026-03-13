import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { Bidx } from "../../target/types/bidx";
import { Connection } from "@solana/web3.js";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import {
  loadWallet,
  getSellerStatePDA,
  getAuctionPDA,
  getAuthenticationPDA,
  parseUsdcAmount,
  getCurrentTimestamp,
  getExplorerUrl,
} from "../utils";
import { IdlTypes } from "@coral-xyz/anchor";
type AssetType = IdlTypes<Bidx>["assetType"];

export async function createCommand(
  program: Program<Bidx>,
  connection: Connection,
  cluster: string,
  sellerPath?: string,
  assetType?: string,
  startingBidUsdc?: string,
  reservePriceUsdc?: string,
  durationSeconds?: string,
) {
  console.clear();
  console.log(chalk.bold.cyan("\n🎨 Create New Auction\n"));
  console.log(chalk.gray("━".repeat(70)));

  let seller: Keypair;
  let answers: any = {};

  // Interactive prompts if args not provided
  if (!sellerPath || !assetType || !startingBidUsdc || !reservePriceUsdc) {
    const promptAnswers = await inquirer.prompt([
      {
        type: "input",
        name: "sellerPath",
        message: "Path to seller wallet keypair:",
        default: "~/.config/solana/id.json",
        when: !sellerPath,
      },
      {
        type: "list",
        name: "assetType",
        message: "Asset type:",
        choices: [
          { name: "🖼️  Digital NFT", value: "digital" },
          { name: "⌚ Physical RWA", value: "physical" },
        ],
        when: !assetType,
      },
      {
        type: "input",
        name: "startingBid",
        message: "Starting bid (USDC):",
        default: "1",
        validate: (input) =>
          (!isNaN(parseFloat(input)) && parseFloat(input) > 0) ||
          "Must be positive number",
        when: !startingBidUsdc,
      },
      {
        type: "input",
        name: "reservePrice",
        message: "Reserve price (USDC):",
        default: "5",
        validate: (input) =>
          (!isNaN(parseFloat(input)) && parseFloat(input) > 0) ||
          "Must be positive number",
        when: !reservePriceUsdc,
      },
      {
        type: "input",
        name: "duration",
        message: "Auction duration (seconds):",
        default: "3600",
        validate: (input) =>
          (!isNaN(parseInt(input)) && parseInt(input) > 0) ||
          "Must be positive number",
        when: !durationSeconds,
      },
    ]);

    answers = promptAnswers;
    sellerPath = sellerPath || answers.sellerPath;
    assetType = assetType || answers.assetType;
    startingBidUsdc = startingBidUsdc || answers.startingBid;
    reservePriceUsdc = reservePriceUsdc || answers.reservePrice;
    durationSeconds = durationSeconds || answers.duration;
  }

  try {
    seller = loadWallet(sellerPath);

    console.log(chalk.cyan("\n⏳ Creating auction...\n"));

    // Get platform config to find accepted token (USDC)
    const [platformConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId,
    );

    const configData = await program.account.platformConfig.fetch(
      platformConfig,
    );
    const usdcMint = configData.treasuryUsdc; // We'll derive mint from treasury

    // Actually, we need to get USDC mint properly - let's use a helper
    // For now, create a test mint or use known devnet USDC
    console.log(chalk.yellow("  › Creating NFT mint..."));

    const nftMint = await createMint(
      connection,
      seller,
      seller.publicKey,
      null,
      0, // NFT decimals = 0
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
    );

    console.log(chalk.green(`  ✓ NFT Mint: ${nftMint}`));

    // Mint NFT to seller
    console.log(chalk.yellow("  › Minting NFT to seller..."));
    const sellerNftAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      seller,
      nftMint,
      seller.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    await mintTo(
      connection,
      seller,
      nftMint,
      sellerNftAccount.address,
      seller,
      1,
      [],
      undefined,
      TOKEN_PROGRAM_ID,
    );

    console.log(chalk.green(`  ✓ NFT minted to seller`));

    // Get seller state (for nonce)
    const [sellerState] = getSellerStatePDA(
      seller.publicKey,
      program.programId,
    );

    let auctionCount = 0;
    try {
      const sellerStateData = await program.account.sellerState.fetch(
        sellerState,
      );
      auctionCount = sellerStateData.auctionCount.toNumber();
    } catch {
      // Seller state doesn't exist yet, will be created
    }

    // Derive auction PDA
    const [auction] = getAuctionPDA(
      seller.publicKey,
      auctionCount,
      program.programId,
    );
    const [authentication] = getAuthenticationPDA(auction, program.programId);

    // Item vault (owned by auction PDA)
    const itemVault = getAssociatedTokenAddressSync(
      nftMint,
      auction,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Transfer NFT to item vault
    console.log(chalk.yellow("  › Transferring NFT to auction vault..."));
    const transferTx = new Transaction()
      .add(
        createAssociatedTokenAccountInstruction(
          seller.publicKey,
          itemVault,
          auction,
          nftMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      )
      .add(
        createTransferCheckedInstruction(
          sellerNftAccount.address,
          nftMint,
          itemVault,
          seller.publicKey,
          1,
          0,
          [],
          TOKEN_PROGRAM_ID,
        ),
      );

    await sendAndConfirmTransaction(connection, transferTx, [seller]);
    console.log(chalk.green(`  ✓ NFT locked in vault`));

    // Get authenticators registry
    const [registry] = PublicKey.findProgramAddressSync(
      [Buffer.from("authenticators_registry")],
      program.programId,
    );

    // Parse amounts
    const startingBid = parseUsdcAmount(startingBidUsdc!);
    const reservePrice = parseUsdcAmount(reservePriceUsdc!);
    const duration = parseInt(durationSeconds!);

    // Calculate timestamps
    const now = getCurrentTimestamp();
    const startDate = new BN(now + 20); // Start in 20 seconds
    const endDate = new BN(now + duration);

    // For accepted token, we need actual USDC mint
    // Let's create a mock USDC for testing
    console.log(chalk.yellow("  › Setting up payment token..."));
    const paymentMint = await createMint(
      connection,
      seller,
      seller.publicKey,
      null,
      6, // USDC decimals
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
    );
    console.log(chalk.green(`  ✓ Payment token: ${paymentMint}`));

    // Create auction
    console.log(chalk.yellow("  › Creating auction on-chain..."));

    const assetTypeEnum: AssetType =
      assetType === "digital" ? { digitalNft: {} } : { physicalRwa: {} };

    const signature = await program.methods
      .createAuction(
        paymentMint,
        startingBid,
        reservePrice,
        startDate,
        endDate,
        "",
        assetTypeEnum,
      )
      .accountsPartial({
        seller: seller.publicKey,
        sellerState,
        auction,
        nftMint,
        itemVault,
        authentication,
        registry,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

    console.log(chalk.green("\n✅ Auction created successfully!\n"));
    console.log(chalk.white("Auction Details:"));
    console.log(`  ${chalk.gray("›")} Auction: ${chalk.cyan(auction)}`);
    console.log(`  ${chalk.gray("›")} NFT Mint: ${chalk.yellow(nftMint)}`);
    console.log(
      `  ${chalk.gray("›")} Payment Token: ${chalk.yellow(paymentMint)}`,
    );
    console.log(
      `  ${chalk.gray("›")} Starting Bid: ${chalk.green(startingBidUsdc)} USDC`,
    );
    console.log(
      `  ${chalk.gray("›")} Reserve Price: ${chalk.magenta(
        reservePriceUsdc,
      )} USDC`,
    );
    console.log(
      `  ${chalk.gray("›")} Duration: ${chalk.cyan(durationSeconds)}s`,
    );
    console.log(
      `  ${chalk.gray("›")} Asset Type: ${chalk.yellow(
        assetType === "digital" ? "Digital NFT" : "Physical RWA",
      )}`,
    );
    console.log(
      `  ${chalk.gray("›")} Transaction: ${chalk.blue(
        getExplorerUrl(signature, cluster),
      )}`,
    );
  } catch (error: any) {
    console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
    if (error.logs) {
      console.log(chalk.gray("Program logs:"));
      error.logs.forEach((log: string) => console.log(chalk.gray(`  ${log}`)));
    }
  }

  await inquirer.prompt([
    {
      type: "input",
      name: "continue",
      message: "\nPress Enter to continue...",
    },
  ]);
}
