import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Bidx } from "../target/types/bidx";
import * as fs from "fs";
import * as path from "path";
import idl from "../target/idl/bidx.json";

/**
 * Load a Solana keypair from a JSON file
 */
export function loadWallet(walletPath: string): Keypair {
  const resolvedPath = path.resolve(walletPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Wallet file not found: ${resolvedPath}`);
  }

  const keypairFile = fs.readFileSync(resolvedPath, "utf-8");
  const keypairData = JSON.parse(keypairFile);

  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

/**
 * Get program instance for a given cluster
 */
export function getProgram(cluster: string): {
  program: Program<Bidx>;
  connection: Connection;
  provider: AnchorProvider;
} {
  // Determine RPC endpoint
  let rpcUrl: string;
  if (cluster === "devnet") {
    rpcUrl = "https://api.devnet.solana.com";
  } else if (cluster === "mainnet" || cluster === "mainnet-beta") {
    rpcUrl = "https://api.mainnet-beta.solana.com";
  } else if (cluster.startsWith("http")) {
    rpcUrl = cluster; // Custom RPC URL
  } else {
    rpcUrl = "http://localhost:8899"; // localnet
  }

  const connection = new Connection(rpcUrl, "confirmed");

  // Try to load wallet from environment
  let wallet: Wallet;
  try {
    const keypairPath =
      process.env.ANCHOR_WALLET ||
      path.join(process.env.HOME || "", ".config/solana/id.json");
    const keypair = loadWallet(keypairPath);
    wallet = new Wallet(keypair);
  } catch {
    // If no wallet found, create a dummy one (read-only operations only)
    wallet = new Wallet(Keypair.generate());
  }

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  anchor.setProvider(provider);

  // Load program
  const programId = new PublicKey(idl.address);
  const program = new Program(idl as any, provider) as Program<Bidx>;

  return { program, connection, provider };
}

/**
 * Get or create default wallet
 */
export function getDefaultWallet(): Keypair {
  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "", ".config/solana/id.json");

  try {
    return loadWallet(walletPath);
  } catch {
    throw new Error(
      `No wallet found. Set ANCHOR_WALLET environment variable or create wallet at ${walletPath}`,
    );
  }
}

/**
 * Format SOL/USDC amounts for display
 */
export function formatAmount(
  lamports: number | anchor.BN,
  decimals: number = 6,
): string {
  const amount = typeof lamports === "number" ? lamports : lamports.toNumber();
  return (amount / Math.pow(10, decimals)).toFixed(decimals);
}

/**
 * Format public key for display (truncated)
 */
export function formatPubkey(pubkey: PublicKey, length: number = 8): string {
  const str = pubkey.toString();
  return `${str.slice(0, length)}...${str.slice(-length)}`;
}

/**
 * Get platform config PDA
 */
export function getPlatformConfigPDA(
  programId: PublicKey,
  admin: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config"), admin.toBuffer()],
    programId,
  );
}

/**
 * Get authenticators registry PDA
 */
export function getAuthenticatorsRegistryPDA(
  programId: PublicKey,
  admin: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("authenticators_registry"), admin.toBuffer()],
    programId,
  );
}

/**
 * Get seller state PDA
 */
export function getSellerStatePDA(
  seller: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("seller_state"), seller.toBuffer()],
    programId,
  );
}

/**
 * Get auction PDA
 */
export function getAuctionPDA(
  seller: PublicKey,
  nonce: number,
  programId: PublicKey,
): [PublicKey, number] {
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(BigInt(nonce));

  return PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), seller.toBuffer(), nonceBuffer],
    programId,
  );
}

/**
 * Get authentication PDA
 */
export function getAuthenticationPDA(
  auction: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("authentication"), auction.toBuffer()],
    programId,
  );
}

/**
 * Get bid PDA
 */
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

/**
 * Wait for transaction confirmation with timeout
 */
export async function confirmTransaction(
  connection: Connection,
  signature: string,
  timeoutMs: number = 60000,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await connection.getSignatureStatus(signature);

    if (
      status?.value?.confirmationStatus === "confirmed" ||
      status?.value?.confirmationStatus === "finalized"
    ) {
      return;
    }

    if (status?.value?.err) {
      throw new Error(
        `Transaction failed: ${JSON.stringify(status.value.err)}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Transaction confirmation timeout after ${timeoutMs}ms`);
}

/**
 * Get explorer URL for transaction or account
 */
export function getExplorerUrl(
  addressOrSignature: string,
  cluster: string,
  type: "tx" | "address" = "tx",
): string {
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  const path = type === "tx" ? "tx" : "address";

  return `https://explorer.solana.com/${path}/${addressOrSignature}${clusterParam}`;
}

/**
 * Airdrop SOL to a wallet (devnet/localnet only)
 */
export async function airdrop(
  connection: Connection,
  publicKey: PublicKey,
  amount: number = 1,
): Promise<string> {
  const signature = await connection.requestAirdrop(
    publicKey,
    amount * anchor.web3.LAMPORTS_PER_SOL,
  );

  await confirmTransaction(connection, signature);

  return signature;
}

/**
 * Check if wallet has sufficient balance
 */
export async function checkBalance(
  connection: Connection,
  publicKey: PublicKey,
  requiredLamports: number,
): Promise<boolean> {
  const balance = await connection.getBalance(publicKey);
  return balance >= requiredLamports;
}

/**
 * Get current Unix timestamp
 */
export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Format Unix timestamp to readable date
 */
export function formatTimestamp(timestamp: number | anchor.BN): string {
  const ts = typeof timestamp === "number" ? timestamp : timestamp.toNumber();
  return new Date(ts * 1000).toLocaleString();
}

/**
 * Parse USDC amount from user input (handles decimals)
 */
export function parseUsdcAmount(amount: string): anchor.BN {
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed < 0) {
    throw new Error("Invalid amount");
  }
  return new anchor.BN(Math.floor(parsed * 1_000_000));
}

/**
 * Validate Solana public key string
 */
export function validatePublicKey(pubkeyString: string): PublicKey {
  try {
    return new PublicKey(pubkeyString);
  } catch {
    throw new Error(`Invalid public key: ${pubkeyString}`);
  }
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
