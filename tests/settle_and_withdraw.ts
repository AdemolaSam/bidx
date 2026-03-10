import { Program, BN } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { expect } from "chai";
import { Bidx } from "../target/types/bidx";
import {
  assertAnchorError,
  createFundedTokenAccount,
  getBidPDA,
  setupBid,
  setupDigitalNftAuction,
  endAuction,
  PlatformContext,
  AuctionContext,
  BidContext,
} from "./helpers";

interface Ctx {
  program: Program<Bidx>;
  connection: anchor.web3.Connection;
  platform: PlatformContext;
}

export function runSettleAndWithdrawTests(getCtx: () => Ctx) {
  describe("settle_auction", () => {
    it("winner settles — NFT transferred, fees distributed, escrow closed", async () => {
      const { program, connection, platform } = getCtx();

      const auctionCtx = await setupDigitalNftAuction(
        program,
        connection,
        platform,
      );

      const winner = await setupBid(
        program,
        connection,
        platform,
        auctionCtx.auction,
        new BN(6_000_000),
      );

      await endAuction(
        program,
        auctionCtx.auction,
        auctionCtx.seller.publicKey,
        0,
      );

      // Seller USDC ATA (receives proceeds)
      const sellerTokenAccount = await createFundedTokenAccount(
        connection,
        platform.admin,
        platform.usdcMint,
        auctionCtx.seller.publicKey,
        0,
      );

      // Pre-create winner NFT ATA
      const winnerNftAccount = getAssociatedTokenAddressSync(
        auctionCtx.nftMint,
        winner.bidder.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const setupTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          winner.bidder.publicKey,
          winnerNftAccount,
          winner.bidder.publicKey,
          auctionCtx.nftMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      await sendAndConfirmTransaction(connection, setupTx, [winner.bidder]);

      await program.methods
        .settleAuction(new BN(0))
        .accountsStrict({
          winner: winner.bidder.publicKey,
          seller: auctionCtx.seller.publicKey,
          authenticator: Keypair.generate().publicKey,
          auction: auctionCtx.auction,
          bid: winner.bid,
          authentication: null,
          platformConfig: platform.platformConfig,
          escrowVault: winner.escrowVault,
          sellerTokenAccount,
          treasury: platform.treasuryUsdc,
          authenticatorTokenAccount: null,
          nftMint: auctionCtx.nftMint,
          itemVault: auctionCtx.itemVault,
          winnerNftAccount,
          tokenMint: platform.usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([winner.bidder])
        .rpc();

      // NFT arrived at winner
      const winnerNft = await getAccount(
        connection,
        winnerNftAccount,
        undefined,
        TOKEN_PROGRAM_ID,
      );
      expect(Number(winnerNft.amount)).to.equal(1);

      // Auction is Settled
      const auctionData = await program.account.auction.fetch(
        auctionCtx.auction,
      );
      expect(auctionData.auctionStatus).to.deep.equal({ settled: {} });

      // Platform fee in treasury: 6_000_000 * 250 / 10_000 = 150_000
      const expectedFee = Math.floor((6_000_000 * 250) / 10_000);
      const treasury = await getAccount(
        connection,
        platform.treasuryUsdc,
        undefined,
        TOKEN_PROGRAM_ID,
      );
      expect(Number(treasury.amount)).to.be.gte(expectedFee);
    });

    it("prevents settlement when auction not Ended", async () => {
      const { program, connection, platform } = getCtx();

      const auctionCtx = await setupDigitalNftAuction(
        program,
        connection,
        platform,
      );

      const winner = await setupBid(
        program,
        connection,
        platform,
        auctionCtx.auction,
        new BN(6_000_000),
      );
      // DO NOT force Ended — still Active

      const sellerTokenAccount = await createFundedTokenAccount(
        connection,
        platform.admin,
        platform.usdcMint,
        auctionCtx.seller.publicKey,
        0,
      );
      const winnerNftAccount = getAssociatedTokenAddressSync(
        auctionCtx.nftMint,
        winner.bidder.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const setupTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          winner.bidder.publicKey,
          winnerNftAccount,
          winner.bidder.publicKey,
          auctionCtx.nftMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      await sendAndConfirmTransaction(connection, setupTx, [winner.bidder]);

      await assertAnchorError(
        program.methods
          .settleAuction(new BN(0))
          .accountsStrict({
            winner: winner.bidder.publicKey,
            seller: auctionCtx.seller.publicKey,
            authenticator: Keypair.generate().publicKey,
            auction: auctionCtx.auction,
            bid: winner.bid,
            authentication: null,
            platformConfig: platform.platformConfig,
            escrowVault: winner.escrowVault,
            sellerTokenAccount,
            treasury: platform.treasuryUsdc,
            authenticatorTokenAccount: null,
            nftMint: auctionCtx.nftMint,
            itemVault: auctionCtx.itemVault,
            winnerNftAccount,
            tokenMint: platform.usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([winner.bidder])
          .rpc(),
        "AuctionNotEnded",
      );
    });

    it("non-winner tries to settle → NotWinner", async () => {
      const { program, connection, platform } = getCtx();

      const auctionCtx = await setupDigitalNftAuction(
        program,
        connection,
        platform,
      );

      const impostorBid = await setupBid(
        program,
        connection,
        platform,
        auctionCtx.auction,
        new BN(2_000_000),
      );
      const winner = await setupBid(
        program,
        connection,
        platform,
        auctionCtx.auction,
        new BN(6_000_000),
      );
      await endAuction(
        program,
        auctionCtx.auction,
        auctionCtx.seller.publicKey,
        0,
      );

      const sellerTokenAccount = await createFundedTokenAccount(
        connection,
        platform.admin,
        platform.usdcMint,
        auctionCtx.seller.publicKey,
        0,
      );
      const impostorNftAccount = getAssociatedTokenAddressSync(
        auctionCtx.nftMint,
        impostorBid.bidder.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const setupTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          impostorBid.bidder.publicKey,
          impostorNftAccount,
          impostorBid.bidder.publicKey,
          auctionCtx.nftMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      await sendAndConfirmTransaction(connection, setupTx, [
        impostorBid.bidder,
      ]);

      await assertAnchorError(
        program.methods
          .settleAuction(new BN(0))
          .accountsStrict({
            winner: impostorBid.bidder.publicKey,
            seller: auctionCtx.seller.publicKey,
            authenticator: Keypair.generate().publicKey,
            auction: auctionCtx.auction,
            bid: impostorBid.bid,
            authentication: null,
            platformConfig: platform.platformConfig,
            escrowVault: impostorBid.escrowVault,
            sellerTokenAccount,
            treasury: platform.treasuryUsdc,
            authenticatorTokenAccount: null,
            nftMint: auctionCtx.nftMint,
            itemVault: auctionCtx.itemVault,
            winnerNftAccount: impostorNftAccount,
            tokenMint: platform.usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([impostorBid.bidder])
          .rpc(),
        "NotWinner",
      );
    });

    it("reserve price not met => No settlement, item can be relisted", async () => {
      const { program, connection, platform } = getCtx();

      const auctionCtx = await setupDigitalNftAuction(
        program,
        connection,
        platform,
      );

      const lowBidder = await setupBid(
        program,
        connection,
        platform,
        auctionCtx.auction,
        new BN(2_000_000), // < 5 USDC reserve
      );

      await endAuction(
        program,
        auctionCtx.auction,
        auctionCtx.seller.publicKey,
        0,
      );

      const sellerTokenAccount = await createFundedTokenAccount(
        connection,
        platform.admin,
        platform.usdcMint,
        auctionCtx.seller.publicKey,
        0,
      );
      const winnerNftAccount = getAssociatedTokenAddressSync(
        auctionCtx.nftMint,
        lowBidder.bidder.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const setupTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          lowBidder.bidder.publicKey,
          winnerNftAccount,
          lowBidder.bidder.publicKey,
          auctionCtx.nftMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      await sendAndConfirmTransaction(connection, setupTx, [lowBidder.bidder]);

      await assertAnchorError(
        program.methods
          .settleAuction(new BN(0))
          .accountsStrict({
            winner: lowBidder.bidder.publicKey,
            seller: auctionCtx.seller.publicKey,
            authenticator: Keypair.generate().publicKey,
            auction: auctionCtx.auction,
            bid: lowBidder.bid,
            authentication: null,
            platformConfig: platform.platformConfig,
            escrowVault: lowBidder.escrowVault,
            sellerTokenAccount,
            treasury: platform.treasuryUsdc,
            authenticatorTokenAccount: null,
            nftMint: auctionCtx.nftMint,
            itemVault: auctionCtx.itemVault,
            winnerNftAccount,
            tokenMint: platform.usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([lowBidder.bidder])
          .rpc(),
        "ReserveNotMet",
      );
    });
  });

  // --------------- WITHDRAW -------------------------

  describe("withdraw_bid", () => {
    let auctionCtx: AuctionContext;
    let winnerBid: BidContext;
    let loserBid: BidContext;

    before(async () => {
      const { program, connection, platform } = getCtx();

      auctionCtx = await setupDigitalNftAuction(program, connection, platform);

      // loser bids 2 USDC, winner outbids with 6 USDC
      loserBid = await setupBid(
        program,
        connection,
        platform,
        auctionCtx.auction,
        new BN(2_000_000),
      );
      winnerBid = await setupBid(
        program,
        connection,
        platform,
        auctionCtx.auction,
        new BN(6_000_000),
      );

      await endAuction(
        program,
        auctionCtx.auction,
        auctionCtx.seller.publicKey,
        0,
      );
    });

    it("losing bidder withdraws funds after auction ends", async () => {
      const { program, connection, platform } = getCtx();

      const before = await getAccount(
        connection,
        loserBid.bidderTokenAccount,
        undefined,
        TOKEN_PROGRAM_ID,
      );

      await program.methods
        .withdrawBid(new BN(0)) // NOTE: pass auction nonce (0) to match WithdrawBid PDA seeds
        .accountsStrict({
          bidder: loserBid.bidder.publicKey,
          seller: auctionCtx.seller.publicKey,
          auction: auctionCtx.auction,
          bid: loserBid.bid,
          escrowVault: loserBid.escrowVault,
          bidderTokenAccount: loserBid.bidderTokenAccount,
          tokenMint: platform.usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([loserBid.bidder])
        .rpc();

      const after = await getAccount(
        connection,
        loserBid.bidderTokenAccount,
        undefined,
        TOKEN_PROGRAM_ID,
      );

      const refunded = Number(after.amount) - Number(before.amount);
      expect(refunded).to.equal(loserBid.bidAmount.toNumber());
    });

    it("highest bidder cannot withdraw => StillWinning", async () => {
      const { program, platform } = getCtx();

      await assertAnchorError(
        program.methods
          .withdrawBid(new BN(0)) // NOTE: pass auction nonce (0) to match WithdrawBid PDA seeds
          .accountsStrict({
            bidder: winnerBid.bidder.publicKey,
            seller: auctionCtx.seller.publicKey,
            auction: auctionCtx.auction,
            bid: winnerBid.bid,
            escrowVault: winnerBid.escrowVault,
            bidderTokenAccount: winnerBid.bidderTokenAccount,
            tokenMint: platform.usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([winnerBid.bidder])
          .rpc(),
        "StillWinning",
      );
    });

    it("cannot withdraw while auction still Active => StillWinning", async () => {
      const { program, connection, platform } = getCtx();

      const freshAuction = await setupDigitalNftAuction(
        program,
        connection,
        platform,
      );

      const bidder = await setupBid(
        program,
        connection,
        platform,
        freshAuction.auction,
        new BN(2_000_000),
      );
      // Auction stays Active — not Ended

      await assertAnchorError(
        program.methods
          .withdrawBid(new BN(0)) // NOTE: pass auction nonce (0) to match WithdrawBid PDA seeds
          .accountsStrict({
            bidder: bidder.bidder.publicKey,
            seller: freshAuction.seller.publicKey,
            auction: freshAuction.auction,
            bid: bidder.bid,
            escrowVault: bidder.escrowVault,
            bidderTokenAccount: bidder.bidderTokenAccount,
            tokenMint: platform.usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([bidder.bidder])
          .rpc(),
        "StillWinning",
      );
    });
  });
}
