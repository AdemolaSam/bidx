import { Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { expect } from "chai";
import { Bidx } from "../target/types/bidx";
import { fund, assertAnchorError, PlatformContext } from "./helpers";

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

interface Ctx {
  program: Program<Bidx>;
  connection: anchor.web3.Connection;
  platform: PlatformContext;
}

export function runInitializeTests(getCtx: () => Ctx) {
  describe("initialize_platform", () => {
    it("platform config is set correctly on-chain", async () => {
      const { program, platform } = getCtx();

      const config = await program.account.platformConfig.fetch(
        platform.platformConfig,
      );

      expect(config.admin.toBase58()).to.equal(
        platform.admin.publicKey.toBase58(),
      );
      expect(config.platformFeeBps).to.equal(250);
      expect(config.authFeeBps).to.equal(100);
      expect(config.isPaused).to.be.false;
      expect(config.treasuryUsdc.toBase58()).to.equal(
        platform.treasuryUsdc.toBase58(),
      );
      expect(config.treasurySol.toBase58()).to.equal(
        platform.treasurySol.toBase58(),
      );

      const registry = await program.account.authenticatorsRegistry.fetch(
        platform.authenticatorsRegistry,
      );
      expect(registry.admin.toBase58()).to.equal(
        platform.admin.publicKey.toBase58(),
      );
      expect(registry.nextIndex.toNumber()).to.equal(0);
    });
  });

  // Register authenticators
  describe("register_authenticators", () => {
    it("admin registers new authenticators", async () => {
      const { program, platform } = getCtx();

      const auth1 = Keypair.generate().publicKey;
      const auth2 = Keypair.generate().publicKey;

      await program.methods
        .registerAuthenticators([auth1, auth2])
        .accountsPartial({
          admin: platform.admin.publicKey,
          registry: platform.authenticatorsRegistry,
        })
        .signers([platform.admin])
        .rpc();

      const registry = await program.account.authenticatorsRegistry.fetch(
        platform.authenticatorsRegistry,
      );
      const keys = registry.authenticators.map((k) => k.toBase58());
      expect(keys).to.include(auth1.toBase58());
      expect(keys).to.include(auth2.toBase58());
    });

    it("non-admin cannot register authenticators", async () => {
      const { program, connection, platform } = getCtx();

      const impostor = Keypair.generate();
      await fund(connection, impostor.publicKey);

      await assertAnchorError(
        program.methods
          .registerAuthenticators([Keypair.generate().publicKey])
          .accountsPartial({
            admin: impostor.publicKey,
            registry: platform.authenticatorsRegistry,
          })
          .signers([impostor])
          .rpc(),
        "ExclusiveToAdmin",
      );
    });

    it("prevents duplicate authenticator", async () => {
      const { program, platform } = getCtx();

      const auth = Keypair.generate().publicKey;

      // Register once
      await program.methods
        .registerAuthenticators([auth])
        .accountsPartial({
          admin: platform.admin.publicKey,
          registry: platform.authenticatorsRegistry,
        })
        .signers([platform.admin])
        .rpc();

      // Trying again with the same key
      const memoIx = new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [],
        data: Buffer.from(`dup-${Date.now()}`),
      });
      await assertAnchorError(
        program.methods
          .registerAuthenticators([auth])
          .preInstructions([memoIx])
          .accountsPartial({
            admin: platform.admin.publicKey,
            registry: platform.authenticatorsRegistry,
          })
          .signers([platform.admin])
          .rpc(),
        "AlreadyRegistered",
      );
    });

    it("admin cannot register themselves", async () => {
      const { program, platform } = getCtx();

      await assertAnchorError(
        program.methods
          .registerAuthenticators([platform.admin.publicKey])
          .accountsPartial({
            admin: platform.admin.publicKey,
            registry: platform.authenticatorsRegistry,
          })
          .signers([platform.admin])
          .rpc(),
        "AdminCannotbeAuthenticator",
      );
    });
  });
}
