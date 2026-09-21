const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("=== Starting BotDAO Deployment ===");

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer configured. Ensure PRIVATE_KEY is set in .env");
  }

  const networkInfo = await ethers.provider.getNetwork();
  const chainId = Number(networkInfo.chainId);
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Network Name:        ${network.name}`);
  console.log(`Chain ID:            ${chainId}`);
  console.log(`Deployer Address:    ${deployer.address}`);
  console.log(`Deployer Balance:    ${ethers.formatEther(balance)} BOT`);

  if (balance === 0n) {
    throw new Error(
      `Deployer wallet ${deployer.address} has 0 BOT balance on chain ${chainId}. Fund the account with testnet BOT before deploying.`
    );
  }

  console.log("\nDeploying BotDAO contract...");
  const BotDAO = await ethers.getContractFactory("BotDAO", deployer);
  const botDAO = await BotDAO.deploy();

  console.log("Waiting for deployment transaction confirmation...");
  await botDAO.waitForDeployment();

  const contractAddress = await botDAO.getAddress();
  console.log(`BotDAO Deployed at:  ${contractAddress}`);

  // Post-deployment read-only verification
  const admin = await botDAO.admin();
  const proposalCount = await botDAO.proposalCount();
  const minVotingDuration = await botDAO.minVotingDuration();
  const maxVotingDuration = await botDAO.maxVotingDuration();

  console.log("\n=== Deployed Contract State Verification ===");
  console.log(`Admin Address:       ${admin}`);
  console.log(`Proposal Count:      ${proposalCount.toString()}`);
  console.log(`Min Voting Duration: ${minVotingDuration.toString()} seconds`);
  console.log(`Max Voting Duration: ${maxVotingDuration.toString()} seconds`);

  if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Admin mismatch! Expected ${deployer.address}, got ${admin}`);
  }
  console.log("Verification check passed: admin matches deployer.");

  // Save deployment metadata
  const deploymentRecord = {
    network: network.name,
    chainId: chainId,
    contractName: "BotDAO",
    contractAddress: contractAddress,
    deployer: deployer.address,
    admin: admin,
    minVotingDuration: minVotingDuration.toString(),
    maxVotingDuration: maxVotingDuration.toString(),
    deployedAt: new Date().toISOString()
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFilePath = path.join(deploymentsDir, "botchain-testnet.json");
  fs.writeFileSync(deploymentFilePath, JSON.stringify(deploymentRecord, null, 2));
  console.log(`\nDeployment record saved to: ${deploymentFilePath}`);
  console.log("=== Deployment Completed Successfully ===");
}

main().catch((error) => {
  console.error("\nDeployment failed with error:", error);
  process.exitCode = 1;
});
