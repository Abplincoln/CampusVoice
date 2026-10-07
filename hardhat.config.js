if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch (_) {}
}

require("@nomicfoundation/hardhat-toolbox");

const privateKey = process.env.PRIVATE_KEY;
const accounts = privateKey
  ? [privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`]
  : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    botchainTestnet: {
      url: "https://rpc.bohr.life",
      chainId: 968,
      accounts: accounts
    },
    botchainMainnet: {
      url: "https://rpc.botchain.ai",
      chainId: 677,
      accounts: accounts
    }
  }
};
