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
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { expect } from "chai";
import { Bidx } from "../target/types/bidx";
import {
  fund,
  assertAnchorError,
  createNftMint,
  mintNftToSeller,
  getAuctionPDA,
  getAuthenticationPDA,
  getSellerStatePDA,
  PlatformContext,
} from "./helpers";

interface Ctx {
  program: Program<Bidx>;
  connection: anchor.web3.Connection;
  platform: PlatformContext;
}

export function runCreateAuctionTests(getCtx: () => Ctx) {
  describe("create auction (DigitalNFT)", () => {
    // ── local helper ──────────────────────
    async function buildAuctionAccounts(
      program: Program<Bidx>,
      connection: anchor.web3.Connection,
      platform: PlatformContext,
      seller: Keypair,
    ) {
      const nftMint = await createNftMint(connection, platform.admin);
      const sellerNftAccount = await mintNftToSeller(
        connection,
        platform.admin,
        nftMint,
        seller.publicKey,
      );

      const [sellerState] = getSellerStatePDA(
        seller.publicKey,
        program.programId,
      );
      const [auction] = getAuctionPDA(seller.publicKey, 0, program.programId);
      const [authentication] = getAuthenticationPDA(auction, program.programId);

      const itemVault = getAssociatedTokenAddressSync(
        nftMint,
        auction,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      // Transfer NFT seller -> item_vault before calling create_auction
      const tx = new Transaction()
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
            sellerNftAccount,
            nftMint,
            itemVault,
            seller.publicKey,
            1,
            0,
            [],
            TOKEN_PROGRAM_ID,
          ),
        );
      await sendAndConfirmTransaction(connection, tx, [seller]);

      return {
        nftMint,
        sellerNftAccount,
        sellerState,
        auction,
        authentication,
        itemVault,
      };
    }

    // ── success path ──────
    it("seller creates a DigitalNFT auction successfully", async () => {
      const { program, connection, platform } = getCtx();
      const seller = Keypair.generate();
      await fund(connection, seller.publicKey);

      const { nftMint, sellerState, auction, authentication, itemVault } =
        await buildAuctionAccounts(program, connection, platform, seller);

      const now = Math.floor(Date.now() / 1000);
      const startingBid = new BN(1_000_000);
      const reservedPrice = new BN(5_000_000);

      await program.methods
        .createAuction(
          platform.usdcMint,
          startingBid,
          reservedPrice,
          new BN(now + 60),
          new BN(now + 60 * 60),
          null,
          { digitalNft: {} },
        )
        .accountsStrict({
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

      const auctionData = await program.account.auction.fetch(auction);
      expect(auctionData.seller.toBase58()).to.equal(
        seller.publicKey.toBase58(),
      );
      expect(auctionData.startingBid.toNumber()).to.equal(
        startingBid.toNumber(),
      );
      expect(auctionData.reservedPrice.toNumber()).to.equal(
        reservedPrice.toNumber(),
      );
      expect(auctionData.auctionStatus).to.deep.equal({ active: {} });
      expect(auctionData.authStatus).to.deep.equal({ notRequired: {} });
      expect(auctionData.highestBid.toNumber()).to.equal(0);
      expect(auctionData.acceptedToken.toBase58()).to.equal(
        platform.usdcMint.toBase58(),
      );

      const sellerStateData = await program.account.sellerState.fetch(
        sellerState,
      );
      expect(sellerStateData.auctionCount.toNumber()).to.equal(1);
    });

    // error paths
    it("auction start date cannot be behind end date", async () => {
      const { program, connection, platform } = getCtx();
      const seller = Keypair.generate();
      await fund(connection, seller.publicKey);

      const { nftMint, sellerState, auction, authentication, itemVault } =
        await buildAuctionAccounts(program, connection, platform, seller);

      const now = Math.floor(Date.now() / 1000);

      await assertAnchorError(
        program.methods
          .createAuction(
            platform.usdcMint,
            new BN(1_000_000),
            new BN(5_000_000),
            new BN(now - 100), // past
            new BN(now + 60 * 60),
            null,
            { digitalNft: {} },
          )
          .accountsStrict({
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
          .rpc(),
        "StartDateIsBehind",
      );
    });

    it("end date before start_date => EndDateIsBehindStartDate", async () => {
      const { program, connection, platform } = getCtx();
      const seller = Keypair.generate();
      await fund(connection, seller.publicKey);

      const { nftMint, sellerState, auction, authentication, itemVault } =
        await buildAuctionAccounts(program, connection, platform, seller);

      const now = Math.floor(Date.now() / 1000);

      await assertAnchorError(
        program.methods
          .createAuction(
            platform.usdcMint,
            new BN(1_000_000),
            new BN(5_000_000),
            new BN(now + 60 * 60), // start = 1hr
            new BN(now + 60), // end = 1min — before start
            null,
            { digitalNft: {} },
          )
          .accountsStrict({
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
          .rpc(),
        "EndDateIsBehindStartDate",
      );
    });

    it("ensuures reserved_price is less than or equal starting_bid", async () => {
      const { program, connection, platform } = getCtx();
      const seller = Keypair.generate();
      await fund(connection, seller.publicKey);

      const { nftMint, sellerState, auction, authentication, itemVault } =
        await buildAuctionAccounts(program, connection, platform, seller);

      const now = Math.floor(Date.now() / 1000);

      await assertAnchorError(
        program.methods
          .createAuction(
            platform.usdcMint,
            new BN(5_000_000), // starting_bid
            new BN(1_000_000), // reserved_price < starting_bid
            new BN(now + 60),
            new BN(now + 60 * 60),
            null,
            { digitalNft: {} },
          )
          .accountsStrict({
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
          .rpc(),
        "ReservedPriceTooLow",
      );
    });
  });
}
