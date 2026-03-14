# PROJECT OVERVIEW

BidX is an open-source auction protocol on Solana for high-value digital and physical assets, starting with NFT collectibles and luxury watches. Unlike traditional platforms (eBay, Heritage Auctions, StockX), BidX requires bidders to lock funds in escrow before bidding—eliminating fake bids, payment defaults, and non-serious participants. Every bid and authentication record is recorded on-chain, providing cryptographic proof of auction fairness that buyers can independently verify. Settlement is instant: when auctions close, funds transfer to sellers and assets transfer to winners in seconds, not weeks. We're targeting NFT traders (immediate traction) and cross-border luxury collectors holding stablecoins who are currently locked out of traditional platforms by KYC barriers.

Read the full project proposal here: [BidX-Protocol full proposal](https://docs.google.com/document/d/1aXTD0X6sAnh9L7fHNwXLEFFMvSHGfe6dRo3Q-SViKsQ/edit?usp=sharing)

## WHY SOLANA? WEB2 vs WEB3 ARCHITECTURE

### Traditional Web2 Auction Backend

**Stack:**

```
Users → Express/Django API → PostgreSQL → Redis Cache → Stripe
                ↓
        Background Workers (Celery/Bull)
                ↓
        Email Service + SMS Notifications
```

**How it works:**

1. **Bidding:** User submits bid → API validates → Write to database → Pub/Sub notification
2. **Escrow:** Funds held by Stripe (3-7 days hold period)
3. **Settlement:** Cron job checks expired auctions → Trigger Stripe payment → Email winner → Manual NFT transfer
4. **Verification:** Admin reviews photos → Manual approval in dashboard
5. **State:** Stored in Postgres tables (auctions, bids, users, escrows)

**Pain Points:**

- ⏰ **Settlement lag:** 5-30 days (payment processing + shipping)
- 💰 **High fees:** 10-25% (platform + payment processor + currency conversion)
- 🌍 **Geographic barriers:** KYC requirements exclude global buyers
- 🔒 **Trust dependency:** Platform can freeze funds, manipulate bids
- 🐛 **Failure modes:** Payment fails → rollback → manual reconciliation

---

### BidX on Solana

**Stack:**

```
Users → Wallet → Solana Program (Rust) → On-Chain Accounts (PDAs)
                        ↓
                Event Logs (Indexing)
```

**How it works:**

1. **Bidding:** User signs transaction → Program validates escrow → Update AuctionAccount PDA → Emit BidPlaced event
2. **Escrow:** USDC locked in BidAccount PDA (immediate, trustless)
3. **Settlement:** Winner calls `settle_auction` → Atomic transfer (NFT + funds) in single transaction
4. **Verification:** Authenticator (from on-chain registry) attests → Update AuthenticationAccount PDA
5. **State:** Stored in Solana accounts (rent-backed, permanent)

**Architectural Mapping:**

| Web2 Component        | Solana Equivalent           | Implementation                    |
| --------------------- | --------------------------- | --------------------------------- |
| **Database Tables**   | Program Accounts (PDAs)     | AuctionAccount, BidAccount, etc.  |
| **Primary Keys**      | PDA Seeds                   | `[b"auction", seller, nonce]`     |
| **Foreign Keys**      | Pubkey References           | `auction.seller`, `bid.auction`   |
| **Indexes**           | Event Logs                  | `emit!(AuctionCreated {...})`     |
| **Transactions (DB)** | Solana Transactions         | Atomic CPI calls                  |
| **Cron Jobs**         | User-Triggered Instructions | `settle_auction()` after end_time |
| **Payment Gateway**   | SPL Token Transfers         | `transfer_checked()` with PDAs    |
| **Admin Panel**       | Multisig Wallet             | Squads 3-of-5 for config updates  |
| **Rate Limiting**     | Compute Budget              | 200k CU per instruction           |
| **Backups**           | Validators + Arweave        | Permanent state replication       |

---

### Key Design Decisions

#### **1. Why PDAs for Escrow?**

**Web2:** Stripe holds funds → requires trust  
**BidX:** Each bid has its own PDA-controlled token account → program-enforced release

```rust
[b"bid", bidder_pubkey, auction_pubkey] → BidAccount PDA
  ↓
Associated Token Account (owned by BidAccount PDA)
  ↓
Locked USDC (only program can release)
```

#### **2. Why Round-Robin Authenticator Assignment?**

**Web2:** Admin manually assigns verifiers → favoritism risk  
**BidX:** `next_index % authenticators.len()` → fair, deterministic, no collusion

```rust
let authenticator = registry.authenticators[registry.next_index as usize];
registry.next_index = (registry.next_index + 1) % registry.authenticators.len();
```

#### **3. Why Basis Points for Fees?**

**Web2:** Hardcoded percentages in app config  
**BidX:** `platform_fee_bps: u16` stored on-chain → admin can update via instruction

```rust
let platform_fee = (winning_bid * platform_fee_bps) / 10_000;
// 250 bps = 2.5%
```

#### **4. Why Optional Authentication Account?**

**Web2:** All items go through same verification flow  
**BidX:** Digital NFTs skip auth (`auth_status = NotRequired`), Physical RWAs require it

---

### Tradeoffs & Constraints

| Aspect                 | Web2 Winner       | Solana Winner           | Why                     |
| ---------------------- | ----------------- | ----------------------- | ----------------------- |
| **Settlement Speed**   | ❌ 5-30 days      | ✅ 400ms                | No intermediaries       |
| **Global Access**      | ❌ KYC required   | ✅ Wallet only          | Permissionless          |
| **Fee Transparency**   | ❌ Hidden costs   | ✅ On-chain config      | Immutable               |
| **Fraud Detection**    | ✅ ML models      | ❌ Registry-based       | Compute limits          |
| **UX Complexity**      | ✅ Email/password | ❌ Wallet setup         | Web3 learning curve     |
| **Scalability**        | ✅ Horizontal     | ❌ Vertical (CU limits) | 1400 TPS cap            |
| **Data Privacy**       | ✅ Private DB     | ❌ Public ledger        | Blockchain transparency |
| **Dispute Resolution** | ✅ Chargebacks    | ❌ Finality             | No reversal             |

**Constraints We Accepted:**

1. **No Complex ML:** Can't run fraud detection models on-chain → Use registry whitelisting
2. **Off-Chain Storage:** Authentication docs (photos, PDFs) stored on IPFS → Only hashes on-chain
3. **Manual Triggering:** Winner must call `settle_auction()` → No auto-execution (could add Clockwork in V2)
4. **Compute Limits:** Max ~200k CU per instruction → Can't batch-settle 100+ auctions
5. **Finality:** Settled auctions immutable → Disputes handled off-chain with treasury funds

**What We Gained:**

1. ✅ **Zero Counterparty Risk:** Code enforces escrow, no platform can rug
2. ✅ **Instant Settlement:** Atomic NFT + fund transfer
3. ✅ **Transparent Fees:** Hardcoded in PlatformConfig, publicly auditable
4. ✅ **Permissionless:** No sign-up, no KYC, global access
5. ✅ **Immutable Provenance:** Every bid, authentication, transfer on-chain forever

---

### State Machine vs REST API

**Web2 Auction Lifecycle (REST):**

```
POST /auctions        → DB write
GET /auctions/:id     → DB read
POST /bids            → DB write + async job
PATCH /auctions/:id   → DB update (admin only)
DELETE /auctions/:id  → Soft delete
```

**BidX Instruction Flow:**

```
create_auction        → Initialize PDAs (Auction + Authentication)
place_bid             → Lock escrow + update state
attest_authentication → Change status (Pending → Active)
settle_auction        → Atomic transfer + close accounts
withdraw_bid          → Return funds + close account
```

**State Transitions:**

```
Pending → Active → Ended → Settled
   ↓                 ↓
Cancelled         Failed
```

Solana enforces state transitions via `require!()` checks - invalid transitions fail at runtime.

---

### Why This Matters for Traditional Devs

**If you've built:**

- E-commerce checkout → You understand escrow logic
- Auction sites (eBay clone) → You understand bid validation
- Subscription billing → You understand state machines
- RBAC systems → You understand account-based permissions

**Then you can build on Solana** by mapping:

- Database → Accounts (PDAs)
- Foreign keys → Pubkey references
- Transactions → Solana transactions (atomic CPIs)
- Cron jobs → User-triggered instructions
- Payment APIs → SPL token transfers

**BidX proves you don't need crypto expertise** - just backend architecture knowledge.

## RUNNING

**REQUIREMENTS**
You need to have the following installed [Check Here for full Rust/Solana/Anchor Installation](https://www.anchor-lang.com/docs/installation)

- Rust
- Solana
- Anchor
- NodeJs
- Yarn

Clone or fork this repo
Then run:

```bash
  anchor build
  yarn install
```

## TESTING

Localnet (full suite):

```bash
anchor test
```

Devnet (full suite; platform PDAs are derived from the admin wallet):

```bash
anchor test --provider.cluster devnet
```

Launch CLI

```bash
yarn cli
```

Note: On devnet, tests fund new accounts by transferring SOL from your `ANCHOR_WALLET`.
Make sure that wallet is funded before running tests. The test helpers default to
funding 0.05 SOL per new account, and the admin gets 0.5 SOL, so a full devnet run
stays under ~3 SOL total.

Devnet timing: auctions use a 20s start delay and 60s duration to avoid clock skew,
so the settle/withdraw suite takes longer on devnet.

## CLI USAGE

BidX includes an interactive terminal interface for managing auctions.

### Installation

```bash
yarn install
```

### Interactive Dashboard

Launch the full-featured dashboard:

```bash
yarn cli
# or
yarn cli dashboard
```

**Features:**

- 🎨 Create auctions (digital NFT or physical RWA)
- 📋 List all active auctions
- 💰 Place bids with escrow locking
- 🏆 Settle completed auctions
- 💸 Withdraw funds from outbid positions
- ⚙️ View platform status
- 🔍 Inspect auction details

### Direct Commands

Skip the dashboard and use commands directly:

```bash
# List all auctions
yarn cli list

# View auction details
yarn cli view --auction <AUCTION_PUBKEY>

# Create auction
yarn cli create \
  --seller ~/.config/solana/id.json \
  --type digital \
  --starting 1 \
  --reserve 5 \
  --duration 3600

# Place bid
yarn cli bid \
  --bidder ~/.config/solana/id.json \
  --auction <AUCTION_PUBKEY> \
  --amount 10

# Settle auction (winner)
yarn cli settle \
  --winner ~/.config/solana/id.json \
  --auction <AUCTION_PUBKEY>

# Withdraw bid (losers)
yarn cli withdraw \
  --bidder ~/.config/solana/id.json \
  --auction <AUCTION_PUBKEY>
```

### Command Reference

| Command             | Description                  |
| ------------------- | ---------------------------- |
| `yarn cli`          | Launch interactive dashboard |
| `yarn cli list`     | List all auctions            |
| `yarn cli view`     | View auction details         |
| `yarn cli create`   | Create new auction           |
| `yarn cli bid`      | Place bid on auction         |
| `yarn cli settle`   | Settle ended auction         |
| `yarn cli withdraw` | Withdraw outbid funds        |
| `yarn cli status`   | View platform configuration  |

<!-- **Demo Video:** [Watch CLI in action](link) -->

## DEVNET DEPLOYMENT

**Program ID:** `2skNLUQeMc1ZBKPPXEuUEms2WvREu2TpVT5R7JvWzNVm`

**Live on Solana Devnet** - Explore the deployed program:

- [View Program on Solana Explorer](https://explorer.solana.com/address/2skNLUQeMc1ZBKPPXEuUEms2WvREu2TpVT5R7JvWzNVm?cluster=devnet)

### Example Transactions

These are real transactions you can inspect on Solana Explorer:

**1. Platform Initialization**  
Creates the BidX platform with fee configuration and authenticator registry.  
[View Transaction →](https://explorer.solana.com/tx/3eTjydrS18btH3W8MAZJCQECTzbzpL2KYcVqK7HA9T8aNYc5Tfv3b8tY2yZuQkNfUQthoahTPSomjctQdQYrhoKH?cluster=devnet)

**2. Auction Created**  
Seller creates a digital NFT auction with starting bid and reserve price.  
[View Transaction →](https://explorer.solana.com/tx/2RqKDjUsvcVA3bgS5JoApehqSmbkdWFGYiZdNpKUN9TFm4BLA4xnh927UEzr51reW5zwHCK5755ve45YsfKE4au?cluster=devnet)

**3. Bid Placed (Escrow Locked)**  
Bidder places bid and USDC is locked in escrow PDA.  
[View Transaction →](https://explorer.solana.com/tx/3C5LjHxExT5AzyAhuCdq8SzkVPLLMBXF1W8xvWqgz6oWNhywEBu24yktjazyxrCdYPGq7C6VbVFHReosUMUmpwXh?cluster=devnet)

**4. Auction Settled (Atomic Transfer)**  
Winner receives NFT, seller receives funds, platform receives fees - all in one transaction.  
[View Transaction →](https://explorer.solana.com/tx/2HPahPSJE9PiJtBNAqvKuUxh9VPJVbRcQPXhUdtrBtsAKVwaQQgMQwSee3ZtY8CMP8DmcZsaKnw3keF9z81xmqHT?cluster=devnet)

**5. Bid Withdrawn (Loser Refunded)**  
Outbid user withdraws their locked USDC from escrow.  
[View Transaction →](https://explorer.solana.com/tx/3DrCq9nV8mZF2iP9YCmDWM5xD8UMJfZaaEAswhC3fFZ8K5ZdU5agbKbSvUeQphtcHvkqErrtW95JoSArpcZPxAGc?cluster=devnet)

### Inspect Live Accounts

- **Program Account:** [View on Explorer](https://explorer.solana.com/address/2skNLUQeMc1ZBKPPXEuUEms2WvREu2TpVT5R7JvWzNVm?cluster=devnet)
- **Example Auction:** [dX5sZ7LzvECdMc6AohFNqFjudgA6CLp6qqEUCEv5opk](https://explorer.solana.com/address/dX5sZ7LzvECdMc6AohFNqFjudgA6CLp6qqEUCEv5opk?cluster=devnet)

## BIDX Protocol's Architectural Diagram

Summarized Flow

![Summarized Flow Chart](./Assets//BidX-Summarized%20Arch%20Diagram.drawio.png)

Full

![Full](./Assets//BidX%20Architectural%20Diagram-2026-02-08-030655.png)

See the different component at: [Architectural Diagram](https://docs.google.com/document/d/1seagNHfNQQNR2gh0QuAQ1Ie_4g7tpYkMLmbrSVc-G-4/edit?usp=sharing)

## CORE INSTRUCTIONS

### initialize (SETUP PLATFORM)

This is the first step where the platform is setup, and inital authenticators are added.

_Requirements_

- Admin Wallet
- Authenticators (Physical Item Validators - They ensure item being auctioned meets the specified standards and stated conditions by the seller)

_Settings_

- platform fee
- authenticator fee
- minimum auction duration (e.g. 1 hour)
- maximum auction duration (eg. 10 days)

Authenticators Registry

```Rust
  #[account]
  #[derive(InitSpace)]
  pub struct AuthenticatorsRegistry {
      pub admin: Pubkey,
      #[max_len(100)]
      pub authenticators: Vec<Pubkey>,
      pub next_index: u64, // for programmatically assigning authenticators to auctions that require physical verification and approval
      pub bump: u8,
  }

```

### create_auction

This is the process of listing auctions and making them available to the public after approval

_Requirements_

- Seller with Assets: Digital NFT or Physical Real world assets (e.g. wristwatches)
- If physical asset, authentication is required. An authentication record is created and an authenticator is assigned programmatically using "round robin". See the authentication account:

  ```Rust
  #[account]
  #[derive(InitSpace)]
  pub struct Authentication {
      pub auction: Pubkey,
      pub auth_status: AuthStatus,
      pub authenticator: Pubkey,
      pub seller: Pubkey,
      #[max_len(300)]
      pub metadata_hash: String, // IPFS hash containig item documentation from seller
      #[max_len(300)]
      pub report_hash: String, // IPFS hash containing item verification report from seller
      pub uploaded_at: i64, // report hash upload timestamp
      pub verified_at: i64,
      pub fee_amount: u64,
      pub fee_paid: bool,
      pub bump: u8,
  }

  AUTHENTICATION STATUS
  #[derive(Debug, Clone, InitSpace, AnchorSerialize, AnchorDeserialize, PartialEq)]
  pub enum AuthStatus {
    NotRequired, // Digital assets does not require authentication
    Pending,
    Verified,
    Rejected,
  }
  ```

### register_authenticators & remove_authenticator

Admin can add authenticators to the platform and can remove authenticators

** Warning - Check if authenticator is assigned to auctions before removal. Else, Auctions get stuck in "Pending" state unless Seller cancels and relist them **

### settle

After auction expiry time, if reserved price is not met the locked NFT will be withdrawable by the seller. Otherwise, settlement instruction is called.

- The NFT is immediately released to the winner through
- The seller gets payed from the locked escrow
- Platform fee is deposited to platform's treasury
- Auhtenticator's fee is paid (if Physical Real World Asset)

### withdraw_bid

None Winning bids makes fund availble for withdrawals into bidder account

### update_platfom_config

Admin can update

- platform fee
- authentication fee
- min aucttion start time
- max auction start time

### toggle_pause_platform

Admin can pause the platorm if a critical error/issue is discovered in the platform. They can unpause it as well

### upload_auth_report

Authenticators can upload report hash containing findings on a Physical Asset they have been assigned to verify

### attest_authentication

Authenticators can approve or decline a Physical RWA if their findings about the asset is not satisfactory (this is only possible after they have uploaded report about the asset)
