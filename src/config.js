// Configuration constants for BOT Chain Mainnet and BotDAO contract

export const BOTCHAIN_MAINNET = {
  chainId: 677,
  chainIdHex: '0x2a5', // 677 in hexadecimal
  chainName: 'BOT Chain Mainnet',
  rpcUrl: 'https://rpc.botchain.ai',
  currencySymbol: 'BOT',
  currencyDecimals: 18,
  explorerUrl: 'https://scan.botchain.ai',
};

// Backwards-compatible testnet definition
export const BOTCHAIN_TESTNET = {
  chainId: 968,
  chainIdHex: '0x3c8',
  chainName: 'BOT Chain Testnet',
  rpcUrl: 'https://rpc.bohr.life',
  currencySymbol: 'BOT',
  currencyDecimals: 18,
  explorerUrl: 'https://scan.bohr.life',
};

// Single source of truth for the deployed BotDAO contract address on Mainnet
export const CONTRACT_ADDRESS = '0x7F5EFeE7643465a4551a8DFBbC17FdD30ddC8a06';
