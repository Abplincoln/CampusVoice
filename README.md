# BOTDAO

A simple decentralized autonomous organization (DAO) project designed for the BotChain testnet.

## Project Overview
- **Network**: BOT Chain Testnet
- **Chain ID**: 968
- **RPC URL**: `https://rpc.bohr.life`
- **Explorer**: `https://scan.bohr.life`
- **Currency**: BOT
- **Membership Model**: Any wallet holding native BOT on testnet is a DAO member (no separate token required).

## Project Structure
- `contracts/`: Solidity smart contracts (to be implemented in next step)
- `scripts/`: Deployment and automation scripts
- `test/`: Smart contract test suite
- `src/`: Frontend interface (React + Vite + Ethers.js)
- `hardhat.config.js`: Hardhat configuration for BotChain compilation & deployment
- `vite.config.js`: Vite dev server and build configuration

## Setup & Commands
- Install dependencies: `npm install`
- Start frontend dev server: `npm run dev`
- Build frontend: `npm run build`
- Compile smart contracts: `npm run compile`
