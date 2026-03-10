import { PublicKey, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

export interface PlatformContext {
  admin: Keypair;
  usdcMint: PublicKey;
  wsolMint: PublicKey;
  platformConfig: PublicKey;
  authenticatorsRegistry: PublicKey;
  treasuryUsdc: PublicKey;
  treasurySol: PublicKey;
}

export interface AuctionData {
  publicKey: PublicKey;
  seller: PublicKey;
  nftMint: PublicKey;
  itemVault: PublicKey;
  acceptedToken: PublicKey;
  startingBid: anchor.BN;
  reservedPrice: anchor.BN;
  highestBid: anchor.BN;
  highestBidder: PublicKey;
  startDate: anchor.BN;
  endDate: anchor.BN;
  auctionStatus: any;
  authStatus: any;
  assetType: any;
}

export interface BidData {
  publicKey: PublicKey;
  bidder: PublicKey;
  auction: PublicKey;
  amount: anchor.BN;
  timestamp: anchor.BN;
  isActive: boolean;
  isWinner: boolean;
}
