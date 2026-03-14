import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  transfer,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { Bidx } from "../target/types/bidx";

// CONSTANTS
export const PLATFORM_FEE_BPS = 250; // 2.5%
export const AUTH_FEE_BPS = 100; // 1%
export const MIN_AUCTION_DURATION = new BN(60); // 1 min (seconds)
export const MAX_AUCTION_DURATION = new BN(60 * 60 * 24 * 7); // 1 week
export const TEST_AUCTION_START_DELAY_SECS = 1;
export const TEST_AUCTION_DURATION_SECS = 2;
export const DEVNET_AUCTION_START_DELAY_SECS = 20;
export const DEVNET_AUCTION_DURATION_SECS = 60;

// PDA DERIVATIONS
export function getPlatformConfigPDA(
  programId: PublicKey,
  admin: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config"), admin.toBuffer()],
    programId,
  );
}

export function getAuthenticatorsRegistryPDA(
  programId: PublicKey,
  admin: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("authenticators_registry"), admin.toBuffer()],
    programId,
  );
}

export function getSellerStatePDA(
  seller: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("seller_state"), seller.toBuffer()],
    programId,
  );
}

export function getAuctionPDA(
  seller: PublicKey,
  auctionCount: number,
  programId: PublicKey,
): [PublicKey, number] {
  const countBuffer = Buffer.alloc(8);
  countBuffer.writeBigUInt64LE(BigInt(auctionCount));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), seller.toBuffer(), countBuffer],
    programId,
  );
}

export function getAuthenticationPDA(
  auction: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("authentication"), auction.toBuffer()],
    programId,
  );
}

export function getBidPDA(
  bidder: PublicKey,
  auction: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bid"), bidder.toBuffer(), auction.toBuffer()],
    programId,
  );
}

// AIRDROP HELPER
export async function airdrop(
  connection: anchor.web3.Connection,
  wallet: PublicKey,
  sol: number = 0.05,
) {
  const endpoint = connection.rpcEndpoint ?? "";
  const isLocalnet =
    endpoint.includes("localhost") || endpoint.includes("127.0.0.1");
  if (isLocalnet) {
    const sig = await connection.requestAirdrop(wallet, sol * LAMPORTS_PER_SOL);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
    return;
  }

  const provider = anchor.AnchorProvider.env();
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;
  const lamports = sol * LAMPORTS_PER_SOL;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wallet,
      lamports,
    }),
  );
  await sendAndConfirmTransaction(connection, tx, [payer]);
}

export function isDevnet(connection: anchor.web3.Connection): boolean {
  const endpoint = connection.rpcEndpoint ?? "";
  return endpoint.includes("devnet");
}

export async function fund(
  connection: anchor.web3.Connection,
  wallet: PublicKey,
  sol: number = 0.1,
) {
  await airdrop(connection, wallet, sol);
}

// TOKEN HELPERS
//create token mint
export async function createTokenMint(
  connection: anchor.web3.Connection,
  payer: Keypair,
  decimals: number = 6,
): Promise<PublicKey> {
  return await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    decimals,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
  );
}

/**
 * Creates an ATA and mints tokens into it
 */
export async function createFundedTokenAccount(
  connection: anchor.web3.Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  amount: number,
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner,
    false,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  await mintTo(
    connection,
    payer,
    mint,
    ata.address,
    payer,
    amount,
    [],
    undefined,
    TOKEN_PROGRAM_ID,
  );

  return ata.address;
}

/**
 * Creates an NFT mint (decimals=0, supply=1)
 */
export async function createNftMint(
  connection: anchor.web3.Connection,
  payer: Keypair,
): Promise<PublicKey> {
  return await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    0,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
  );
}

/**
 * Creates an ATA for an NFT, mints 1 token into it (seller holds NFT pre-auction)
 */
export async function mintNftToSeller(
  connection: anchor.web3.Connection,
  payer: Keypair,
  nftMint: PublicKey,
  seller: PublicKey,
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    nftMint,
    seller,
    false,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  await mintTo(
    connection,
    payer,
    nftMint,
    ata.address,
    payer,
    1,
    [],
    undefined,
    TOKEN_PROGRAM_ID,
  );

  return ata.address;
}

// PROGRAM SETUP HELPERS
export interface PlatformContext {
  admin: Keypair;
  usdcMint: PublicKey;
  wsolMint: PublicKey;
  platformConfig: PublicKey;
  authenticatorsRegistry: PublicKey;
  treasuryUsdc: PublicKey;
  treasurySol: PublicKey;
}

/**
 * Initializes the platform and returns all relevant accounts.
 */
export async function setupPlatform(
  program: Program<Bidx>,
  connection: anchor.web3.Connection,
  authenticators: PublicKey[] = [],
): Promise<PlatformContext> {
  const admin = Keypair.generate();
  await airdrop(connection, admin.publicKey, 0.5);

  const [platformConfig] = getPlatformConfigPDA(
    program.programId,
    admin.publicKey,
  );
  const [authenticatorsRegistry] = getAuthenticatorsRegistryPDA(
    program.programId,
    admin.publicKey,
  );

  // Create USDC nd wSOL mints
  const usdcMint = await createTokenMint(connection, admin, 6);
  const wsolMint = await createTokenMint(connection, admin, 9);

  const treasuryUsdc = getAssociatedTokenAddressSync(
    usdcMint,
    platformConfig,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const treasurySol = getAssociatedTokenAddressSync(
    wsolMint,
    wsolMint,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const platformInitTx = await program.methods
    .initialize(
      PLATFORM_FEE_BPS,
      MIN_AUCTION_DURATION,
      MAX_AUCTION_DURATION,
      authenticators,
      AUTH_FEE_BPS,
    )
    .accountsPartial({
      admin: admin.publicKey,
      platformConfig,
      authenticatorsRegistry,
      treasuryUsdc,
      treasurySol,
      usdcMint,
      wsolMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();

  console.log("Platform Init:", platformInitTx);

  return {
    admin,
    usdcMint,
    wsolMint,
    platformConfig,
    authenticatorsRegistry,
    treasuryUsdc,
    treasurySol,
  };
}

export interface AuctionContext {
  seller: Keypair;
  nftMint: PublicKey;
  sellerNftAccount: PublicKey;
  itemVault: PublicKey;
  sellerState: PublicKey;
  auction: PublicKey;
  authentication: PublicKey;
  startDate: BN;
  endDate: BN;
  startingBid: BN;
  reservedPrice: BN;
}

/**
 * Creates a DigitalNFT auction and returns all relevant accounts.
 * auctionCount is the seller's current auction_count before this creation (starts at 0).
 */
export async function setupDigitalNftAuction(
  program: Program<Bidx>,
  connection: anchor.web3.Connection,
  platform: PlatformContext,
  auctionCount: number = 0,
): Promise<AuctionContext> {
  const seller = Keypair.generate();
  await airdrop(connection, seller.publicKey);

  const nftMint = await createNftMint(connection, platform.admin);

  // Mint NFT to seller
  const sellerNftAccount = await mintNftToSeller(
    connection,
    platform.admin,
    nftMint,
    seller.publicKey,
  );

  // item_vault = ATA of nftMint owned by auction PDA
  const [sellerState] = getSellerStatePDA(seller.publicKey, program.programId);
  const [auction] = getAuctionPDA(
    seller.publicKey,
    auctionCount,
    program.programId,
  );
  const [authentication] = getAuthenticationPDA(auction, program.programId);

  const itemVault = getAssociatedTokenAddressSync(
    nftMint,
    auction,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // ── Transfer NFT from seller → item_vault (auction PDA's ATA) ──
  // The seller must do this before calling create_auction.
  // We create the item_vault ATA first (owned by auction PDA), then transfer.
  const createVaultIx = createAssociatedTokenAccountInstruction(
    seller.publicKey, // payer
    itemVault, // ATA address
    auction, // owner (the auction PDA)
    nftMint, // mint
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const transferNftIx = await import("@solana/spl-token").then((spl) =>
    spl.createTransferCheckedInstruction(
      sellerNftAccount,
      nftMint,
      itemVault, // to
      seller.publicKey,
      1,
      0,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  const tx = new Transaction().add(createVaultIx, transferNftIx);
  await sendAndConfirmTransaction(connection, tx, [seller]);

  const now = Math.floor(Date.now() / 1000);
  const isDev = isDevnet(connection);
  const startDelay = isDev
    ? DEVNET_AUCTION_START_DELAY_SECS
    : TEST_AUCTION_START_DELAY_SECS;
  const duration = isDev
    ? DEVNET_AUCTION_DURATION_SECS
    : TEST_AUCTION_DURATION_SECS;
  const startDate = new BN(now + startDelay);
  const endDate = new BN(now + duration);
  const startingBid = new BN(1_000_000);
  const reservedPrice = new BN(5_000_000);

  await program.methods
    .createAuction(
      platform.usdcMint,
      startingBid,
      reservedPrice,
      startDate,
      endDate,
      null,
      { digitalNft: {} },
    )
    .accountsPartial({
      seller: seller.publicKey,
      sellerState,
      auction,
      nftMint,
      itemVault,
      authentication,
      registry: platform.authenticatorsRegistry,
      systemProgram: SystemProgram.programId,
    })
    .signers([seller])
    .rpc();

  return {
    seller,
    nftMint,
    sellerNftAccount,
    itemVault,
    sellerState,
    auction,
    authentication,
    startDate,
    endDate,
    startingBid,
    reservedPrice,
  };
}

export interface BidContext {
  bidder: Keypair;
  bidderTokenAccount: PublicKey;
  escrowVault: PublicKey;
  bid: PublicKey;
  bidAmount: BN;
}

/**
 * Places a bid on an auction and returns bid-related accounts.
 */
export async function setupBid(
  program: Program<Bidx>,
  connection: anchor.web3.Connection,
  platform: PlatformContext,
  auctionPDA: PublicKey,
  bidAmount: BN,
): Promise<BidContext> {
  const bidder = Keypair.generate();
  await airdrop(connection, bidder.publicKey);

  // Fund bidder with USDC
  const bidderTokenAccount = await createFundedTokenAccount(
    connection,
    platform.admin,
    platform.usdcMint,
    bidder.publicKey,
    bidAmount.toNumber() * 10,
  );

  const [bid] = getBidPDA(bidder.publicKey, auctionPDA, program.programId);

  const escrowVault = getAssociatedTokenAddressSync(
    platform.usdcMint,
    bid,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  await program.methods
    .placeBid(bidAmount)
    .accountsPartial({
      bidder: bidder.publicKey,
      bid,
      auction: auctionPDA,
      bidderTokenAccount,
      escrowVault,
      tokenMint: platform.usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([bidder])
    .rpc();

  return {
    bidder,
    bidderTokenAccount,
    escrowVault,
    bid,
    bidAmount,
  };
}

// AUCTION STATE HELPERS
export async function waitForUnixTimestamp(unixSeconds: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const delayMs = Math.max(0, (unixSeconds - now + 1) * 1000);
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function endAuction(
  program: Program<Bidx>,
  auctionPDA: PublicKey,
  seller: PublicKey,
  nonce: number = 0,
): Promise<void> {
  const data = await program.account.auction.fetch(auctionPDA);
  await waitForUnixTimestamp(data.endDate.toNumber());
  await program.methods
    .endAuction(new BN(nonce))
    .accounts({
      seller,
      auction: auctionPDA,
    })
    .rpc();
}

// ASSERTION HELPERS
/**
 * Asserts a transaction fails with a specific Anchor error code.
 * Usage: await assertAnchorError(tx, "StartDateIsBehind")
 */
export async function assertAnchorError(
  txPromise: Promise<any>,
  errorName: string,
): Promise<void> {
  try {
    await txPromise;
    throw new Error(`Expected error "${errorName}" but transaction succeeded`);
  } catch (err: any) {
    const msg: string = err?.message ?? err?.toString() ?? "";
    if (msg.includes(errorName)) return;

    const customCode =
      err?.InstructionError?.[1]?.Custom ??
      err?.error?.errorCode?.number ??
      err?.error?.errorCode;
    const expectedCode = getErrorCodeMap().get(errorName);
    if (expectedCode !== undefined && customCode === expectedCode) return;

    throw new Error(`Expected error "${errorName}" but got: ${msg}`);
  }
}

let cachedErrorCodeMap: Map<string, number> | null = null;
function getErrorCodeMap(): Map<string, number> {
  if (cachedErrorCodeMap) return cachedErrorCodeMap;
  const idlPath = path.join(process.cwd(), "target", "idl", "bidx.json");
  try {
    const raw = fs.readFileSync(idlPath, "utf8");
    const idl = JSON.parse(raw);
    const map = new Map<string, number>();
    for (const e of idl?.errors ?? []) {
      if (typeof e?.name === "string" && typeof e?.code === "number") {
        map.set(e.name, e.code);
      }
    }
    cachedErrorCodeMap = map;
  } catch {
    cachedErrorCodeMap = new Map();
  }
  return cachedErrorCodeMap;
}
