# CampusVoice

**Student decisions, transparently recorded.**

CampusVoice is a student governance platform built on the BotChain testnet. It gives Student Government Associations (SUGs) a simple way to create proposals, collect wallet-based votes, and publish verifiable results on-chain.

CampusVoice is designed as a transparent participation tool, not as official university election infrastructure.

## How It Works

1. **SUG creates a proposal** - A proposal includes a title, description, and voting duration.
2. **Students review the proposal** - Active proposals are displayed in the CampusVoice interface.
3. **Students vote** - Eligible wallets can vote YES or NO once per proposal.
4. **Results are recorded** - Vote counts and proposal status are stored on BotChain.
5. **Anyone can verify** - The deployed smart contract and on-chain activity can be inspected through the BotChain explorer.

## Example Proposals

- Should SUG organize a student career fair this semester?
- Should SUG prioritize a campus welfare programme?
- Should SUG organize an inter-faculty sports event?

## Features

- Create proposals on-chain
- Fixed voting duration per proposal
- One wallet, one vote per proposal
- YES / NO voting
- Automatic proposal status: Active, Passed, Rejected, or Tied
- On-chain vote counts
- Proposal sharing
- Wallet-based participation
- BotChain Testnet integration
- Verified smart contract
- Responsive React frontend

## Deployed Contract

**Network:** BotChain Testnet
**Chain ID:** 968
**Native Currency:** BOT
**RPC:** `https://rpc.bohr.life`
**Explorer:** `https://scan.bohr.life`
**Contract:** `0x13E171aeCDcA456E8Ca0c6EFbC3bb0943dBC759B`

[View verified contract on BotChain Explorer](https://scan.bohr.life/address/0x13E171aeCDcA456E8Ca0c6EFbC3bb0943dBC759B)

The contract source code is verified with an exact match on the BotChain explorer.

## Smart Contract

The main contract is `contracts/BotDAO.sol`.

The contract handles:

- Proposal creation
- Proposal storage
- Voting
- One vote per wallet per proposal
- Voting deadlines
- Proposal status
- Admin controls for voting-duration limits
- Dynamic membership based on native BOT balance

The contract does not hold a treasury or user funds.

## Testing

The project includes a Hardhat test suite covering:

- Deployment
- Admin controls
- Membership checks
- Proposal creation and validation
- Proposal events
- YES / NO voting
- Duplicate-vote prevention
- Proposal status transitions
- Voting deadlines
- Contract events
- Dynamic membership

**Current test result: 45 passing**

## Tech Stack

- Solidity `0.8.24`
- Hardhat
- Ethers.js
- React
- Vite
- JavaScript
- BotChain Testnet

## Project Structure

```text
botdao/
â”œâ”€â”€ contracts/
â”‚   â””â”€â”€ BotDAO.sol
â”œâ”€â”€ scripts/
â”œâ”€â”€ test/
â”‚   â””â”€â”€ BotDAO.test.js
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ App.jsx
â”‚   â”œâ”€â”€ abi.js
â”‚   â”œâ”€â”€ config.js
â”‚   â””â”€â”€ index.css
â”œâ”€â”€ hardhat.config.js
â”œâ”€â”€ foundry.toml
â”œâ”€â”€ package.json
â””â”€â”€ vite.config.js
