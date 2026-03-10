import { Program, BN } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Bidx } from "../target/types/bidx";
import {
  fund,
  assertAnchorError,
  createFundedTokenAccount,
  createTokenMint,
  getBidPDA,
  setupDigitalNftAuction,
  PlatformContext,
  AuctionContext,
} from "./helpers";

interface Ctx {
  program: Program<Bidx>;
  connection: anchor.web3.Connection;
  platform: PlatformContext;
}

export function runPlaceBidTests(getCtx: () => Ctx) {
  describe("place_bid", () => {
    let auctionCtx: AuctionContext;

    before(async () => {
      const { program, connection, platform } = getCtx();
      auctionCtx = await setupDigitalNftAuction(program, connection, platform);
    });

    // success paths

    it("ensures first bid is higher than starting bid", async () => {
      const { program, connection, platform } = getCtx();
      const bidder = Keypair.generate();
      await fund(connection, bidder.publicKey);

      const bidAmount = new BN(2_000_000); // 2 USDC > 1 USDC starting_bid

      const bidderTokenAccount = await createFundedTokenAccount(
        connection,
        platform.admin,
        platform.usdcMint,
        bidder.publicKey,
        bidAmount.toNumber() * 5,
      );

      const [bid] = getBidPDA(
        bidder.publicKey,
        auctionCtx.auction,
        program.programId,
      );
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
          auction: auctionCtx.auction,
          bidderTokenAccount,
          escrowVault,
          tokenMint: platform.usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([bidder])
        .rpc();

      const bidData = await program.account.bid.fetch(bid);
      expect(bidData.amount.toNumber()).to.equal(bidAmount.toNumber());
      expect(bidData.bidder.toBase58()).to.equal(bidder.publicKey.toBase58());
      expect(bidData.isActive).to.be.true;

      const auctionData = await program.account.auction.fetch(
        auctionCtx.auction,
      );
      expect(auctionData.highestBid.toNumber()).to.equal(bidAmount.toNumber());
      expect(auctionData.highestBidder.toBase58()).to.equal(
        bidder.publicKey.toBase58(),
      );

      const vault = await getAccount(
        connection,
        escrowVault,
        undefined,
        TOKEN_PROGRAM_ID,
      );
      expect(Number(vault.amount)).to.equal(bidAmount.toNumber());
    });

    it("bidder increases their existing bid", async () => {
      const { program, connection, platform } = getCtx();
      const bidder = Keypair.generate();
      await fund(connection, bidder.publicKey);

      const firstBid = new BN(3_000_000);
      const increase = new BN(2_000_000);
      const expectedTotal = firstBid.add(increase);

      const bidderTokenAccount = await createFundedTokenAccount(
        connection,
        platform.admin,
        platform.usdcMint,
        bidder.publicKey,
        expectedTotal.toNumber() * 2,
      );

      const [bid] = getBidPDA(
        bidder.publicKey,
        auctionCtx.auction,
        program.programId,
      );
      const escrowVault = getAssociatedTokenAddressSync(
        platform.usdcMint,
        bid,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      const accounts = {
        bidder: bidder.publicKey,
        bid,
        auction: auctionCtx.auction,
        bidderTokenAccount,
        escrowVault,
        tokenMint: platform.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      };

      await program.methods
        .placeBid(firstBid)
        .accounts(accounts)
        .signers([bidder])
        .rpc();
      await program.methods
        .placeBid(increase)
        .accounts(accounts)
        .signers([bidder])
        .rpc();

      const bidData = await program.account.bid.fetch(bid);
      expect(bidData.amount.toNumber()).to.equal(expectedTotal.toNumber());

      const auctionData = await program.account.auction.fetch(
        auctionCtx.auction,
      );
      expect(auctionData.highestBid.toNumber()).to.equal(
        expectedTotal.toNumber(),
      );
    });

    // error paths

    it("prevents bidding on `inactive` auction(s)", async () => {
      const { program, connection, platform } = getCtx();

      // Fresh auction stays Pending
      const pendingAuction = await setupDigitalNftAuction(
        program,
        connection,
        platform,
      );

      const bidder = Keypair.generate();
      await fund(connection, bidder.publicKey);

      const bidAmount = new BN(2_000_000);
      const bidderTokenAccount = await createFundedTokenAccount(
        connection,
        platform.admin,
        platform.usdcMint,
        bidder.publicKey,
        bidAmount.toNumber() * 2,
      );

      const [bid] = getBidPDA(
        bidder.publicKey,
        pendingAuction.auction,
        program.programId,
      );
      const escrowVault = getAssociatedTokenAddressSync(
        platform.usdcMint,
        bid,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      await assertAnchorError(
        program.methods
          .placeBid(bidAmount)
          .accountsPartial({
            bidder: bidder.publicKey,
            bid,
            auction: pendingAuction.auction,
            bidderTokenAccount,
            escrowVault,
            tokenMint: platform.usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([bidder])
          .rpc(),
        "AuctionNotAvailable",
      );
    });

    it("rejects wrong token mint / ensures bidders can only bid with approved token", async () => {
      const { program, connection, platform } = getCtx();
      const bidder = Keypair.generate();
      await fund(connection, bidder.publicKey);

      const wrongMint = await createTokenMint(connection, platform.admin, 6);
      const bidAmount = new BN(2_000_000);

      const bidderTokenAccount = await createFundedTokenAccount(
        connection,
        platform.admin,
        wrongMint,
        bidder.publicKey,
        bidAmount.toNumber() * 2,
      );

      const [bid] = getBidPDA(
        bidder.publicKey,
        auctionCtx.auction,
        program.programId,
      );
      const escrowVault = getAssociatedTokenAddressSync(
        wrongMint,
        bid,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      await assertAnchorError(
        program.methods
          .placeBid(bidAmount)
          .accountsStrict({
            bidder: bidder.publicKey,
            bid,
            auction: auctionCtx.auction,
            bidderTokenAccount,
            escrowVault,
            tokenMint: wrongMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([bidder])
          .rpc(),
        "WrongToken",
      );
    });

    it("prevents bid amount less than the current highest bid", async () => {
      const { program, connection, platform } = getCtx();
      const bidder = Keypair.generate();
      await fund(connection, bidder.publicKey);

      const tooLow = new BN(500_000); // 0.5 USDC < 1 USDC starting_bid

      const bidderTokenAccount = await createFundedTokenAccount(
        connection,
        platform.admin,
        platform.usdcMint,
        bidder.publicKey,
        tooLow.toNumber() * 2,
      );

      const [bid] = getBidPDA(
        bidder.publicKey,
        auctionCtx.auction,
        program.programId,
      );
      const escrowVault = getAssociatedTokenAddressSync(
        platform.usdcMint,
        bid,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      await assertAnchorError(
        program.methods
          .placeBid(tooLow)
          .accountsStrict({
            bidder: bidder.publicKey,
            bid,
            auction: auctionCtx.auction,
            bidderTokenAccount,
            escrowVault,
            tokenMint: platform.usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([bidder])
          .rpc(),
        "BidTooLow",
      );
    });
  });
}
