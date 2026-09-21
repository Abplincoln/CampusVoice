const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, setBalance } = require("@nomicfoundation/hardhat-network-helpers");

describe("BotDAO Smart Contract", function () {
  let BotDAO;
  let botDAO;
  let admin;
  let member1;
  let member2;
  let member3;
  let nonMember;

  // ProposalStatus enum mirroring the contract:
  // 0: Active, 1: Passed, 2: Rejected, 3: Tied
  const ProposalStatus = {
    Active: 0,
    Passed: 1,
    Rejected: 2,
    Tied: 3,
  };

  beforeEach(async function () {
    [admin, member1, member2, member3] = await ethers.getSigners();

    // Create a dedicated wallet with 0 native balance
    nonMember = ethers.Wallet.createRandom().connect(ethers.provider);

    BotDAO = await ethers.getContractFactory("BotDAO");
    botDAO = await BotDAO.deploy();
    await botDAO.waitForDeployment();
  });

  describe("1. Deployment / Initial State", function () {
    it("deploys successfully and sets the deployer as admin", async function () {
      expect(await botDAO.admin()).to.equal(admin.address);
    });

    it("initializes proposalCount to 0", async function () {
      expect(await botDAO.proposalCount()).to.equal(0);
    });

    it("initializes minVotingDuration to 60 seconds", async function () {
      expect(await botDAO.minVotingDuration()).to.equal(60);
    });

    it("initializes maxVotingDuration to 7 days (604,800 seconds)", async function () {
      expect(await botDAO.maxVotingDuration()).to.equal(7 * 24 * 60 * 60);
    });
  });

  describe("2. Membership", function () {
    it("recognizes an address with native balance > 0 as a member", async function () {
      const balance = await ethers.provider.getBalance(member1.address);
      expect(balance).to.be.greaterThan(0);
      expect(await botDAO.isMember(member1.address)).to.be.true;
    });

    it("does not recognize an address with 0 native balance as a member", async function () {
      const balance = await ethers.provider.getBalance(nonMember.address);
      expect(balance).to.equal(0);
      expect(await botDAO.isMember(nonMember.address)).to.be.false;
    });
  });

  describe("3. Proposal Creation", function () {
    it("allows a member to create a valid proposal and stores all data correctly", async function () {
      const title = "Upgrade BotChain Infrastructure";
      const description = "Proposal to fund RPC infrastructure improvements";
      const duration = 3600; // 1 hour

      const tx = await botDAO.connect(member1).createProposal(title, description, duration);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      expect(await botDAO.proposalCount()).to.equal(1);

      const [proposal, status] = await botDAO.getProposal(1);
      expect(proposal.id).to.equal(1);
      expect(proposal.creator).to.equal(member1.address);
      expect(proposal.title).to.equal(title);
      expect(proposal.description).to.equal(description);
      expect(proposal.startTime).to.equal(block.timestamp);
      expect(proposal.deadline).to.equal(block.timestamp + duration);
      expect(proposal.yesVotes).to.equal(0);
      expect(proposal.noVotes).to.equal(0);
      expect(status).to.equal(ProposalStatus.Active);
    });

    it("emits the ProposalCreated event with correct arguments", async function () {
      const duration = 120;
      const tx = await botDAO.connect(member1).createProposal("Title", "Desc", duration);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(botDAO, "ProposalCreated")
        .withArgs(1, member1.address, "Title", block.timestamp, block.timestamp + duration);
    });
  });

  describe("4. Non-Member Cannot Create Proposal", function () {
    it("prevents a wallet with 0 native balance from creating a proposal", async function () {
      await expect(
        botDAO.connect(nonMember).createProposal("Spam Title", "Spam Description", 100, { gasPrice: 0 })
      ).to.be.revertedWith("BOTDAO: Must hold native BOT to participate");
    });
  });

  describe("5. Invalid Proposal Data Validation", function () {
    it("reverts if the title is empty", async function () {
      await expect(
        botDAO.connect(member1).createProposal("", "Valid description", 300)
      ).to.be.revertedWith("BOTDAO: Title cannot be empty");
    });

    it("reverts if the title exceeds 100 bytes", async function () {
      const longTitle = "a".repeat(101);
      await expect(
        botDAO.connect(member1).createProposal(longTitle, "Valid description", 300)
      ).to.be.revertedWith("BOTDAO: Title exceeds 100 bytes");
    });

    it("reverts if the description is empty", async function () {
      await expect(
        botDAO.connect(member1).createProposal("Valid title", "", 300)
      ).to.be.revertedWith("BOTDAO: Description cannot be empty");
    });

    it("reverts if the description exceeds 1000 bytes", async function () {
      const longDescription = "b".repeat(1001);
      await expect(
        botDAO.connect(member1).createProposal("Valid title", longDescription, 300)
      ).to.be.revertedWith("BOTDAO: Description exceeds 1000 bytes");
    });

    it("reverts if duration is below minimum allowed duration", async function () {
      await expect(
        botDAO.connect(member1).createProposal("Title", "Desc", 59)
      ).to.be.revertedWith("BOTDAO: Duration outside allowed range");
    });

    it("reverts if duration is above maximum allowed duration", async function () {
      const tooLong = 7 * 24 * 60 * 60 + 1;
      await expect(
        botDAO.connect(member1).createProposal("Title", "Desc", tooLong)
      ).to.be.revertedWith("BOTDAO: Duration outside allowed range");
    });
  });

  describe("6. Voting", function () {
    beforeEach(async function () {
      await botDAO.connect(member1).createProposal("Proposal 1", "Voting Test", 3600);
    });

    it("records a YES vote correctly and emits VoteCast event", async function () {
      await expect(botDAO.connect(member1).vote(1, true))
        .to.emit(botDAO, "VoteCast")
        .withArgs(1, member1.address, true, 1, 0);

      const [proposal, status] = await botDAO.getProposal(1);
      expect(proposal.yesVotes).to.equal(1);
      expect(proposal.noVotes).to.equal(0);
      expect(await botDAO.hasVoted(1, member1.address)).to.be.true;
      expect(status).to.equal(ProposalStatus.Active);
    });

    it("records a NO vote from another member independently", async function () {
      await botDAO.connect(member1).vote(1, true);

      await expect(botDAO.connect(member2).vote(1, false))
        .to.emit(botDAO, "VoteCast")
        .withArgs(1, member2.address, false, 1, 1);

      const [proposal] = await botDAO.getProposal(1);
      expect(proposal.yesVotes).to.equal(1);
      expect(proposal.noVotes).to.equal(1);
      expect(await botDAO.hasVoted(1, member2.address)).to.be.true;
    });

    it("reverts when attempting to vote on a non-existent proposal", async function () {
      await expect(
        botDAO.connect(member1).vote(999, true)
      ).to.be.revertedWith("BOTDAO: Proposal does not exist");
    });
  });

  describe("7. Duplicate Vote Prevention", function () {
    beforeEach(async function () {
      await botDAO.connect(member1).createProposal("Proposal 1", "Duplicate Test", 3600);
      await botDAO.connect(member1).vote(1, true);
    });

    it("reverts if the same wallet tries to vote twice on the same proposal", async function () {
      await expect(
        botDAO.connect(member1).vote(1, true)
      ).to.be.revertedWith("BOTDAO: Already voted on this proposal");
    });
  });

  describe("8. Vote Cannot Be Changed", function () {
    beforeEach(async function () {
      await botDAO.connect(member1).createProposal("Proposal 1", "Immutability Test", 3600);
      await botDAO.connect(member1).vote(1, true);
    });

    it("reverts if a voter attempts to change their vote from YES to NO", async function () {
      await expect(
        botDAO.connect(member1).vote(1, false)
      ).to.be.revertedWith("BOTDAO: Already voted on this proposal");
    });
  });

  describe("9. Non-Member Cannot Vote", function () {
    beforeEach(async function () {
      await botDAO.connect(member1).createProposal("Proposal 1", "Non-member Vote Test", 3600);
    });

    it("reverts when a wallet with 0 native balance attempts to vote", async function () {
      await expect(
        botDAO.connect(nonMember).vote(1, true, { gasPrice: 0 })
      ).to.be.revertedWith("BOTDAO: Must hold native BOT to participate");
    });
  });

  describe("10. Proposal Status Determination", function () {
    it("remains Active before the deadline regardless of current votes", async function () {
      await botDAO.connect(member1).createProposal("Active Test", "Desc", 3600);
      await botDAO.connect(member1).vote(1, true);
      await botDAO.connect(member2).vote(1, true);

      expect(await botDAO.getProposalStatus(1)).to.equal(ProposalStatus.Active);
    });

    it("returns Passed after deadline when YES votes exceed NO votes", async function () {
      await botDAO.connect(member1).createProposal("Pass Test", "Desc", 100);
      await botDAO.connect(member1).vote(1, true);
      await botDAO.connect(member2).vote(1, true);
      await botDAO.connect(member3).vote(1, false); // 2 YES, 1 NO

      await time.increase(101);

      expect(await botDAO.getProposalStatus(1)).to.equal(ProposalStatus.Passed);
    });

    it("returns Rejected after deadline when NO votes exceed YES votes", async function () {
      await botDAO.connect(member1).createProposal("Reject Test", "Desc", 100);
      await botDAO.connect(member1).vote(1, false);
      await botDAO.connect(member2).vote(1, false);
      await botDAO.connect(member3).vote(1, true); // 1 YES, 2 NO

      await time.increase(101);

      expect(await botDAO.getProposalStatus(1)).to.equal(ProposalStatus.Rejected);
    });

    it("returns Tied after deadline when YES votes equal NO votes", async function () {
      await botDAO.connect(member1).createProposal("Tie Test", "Desc", 100);
      await botDAO.connect(member1).vote(1, true);
      await botDAO.connect(member2).vote(1, false); // 1 YES, 1 NO

      await time.increase(101);

      expect(await botDAO.getProposalStatus(1)).to.equal(ProposalStatus.Tied);
    });

    it("returns Tied after deadline when a proposal receives zero votes", async function () {
      await botDAO.connect(member1).createProposal("Zero Vote Test", "Desc", 100);

      await time.increase(101);

      expect(await botDAO.getProposalStatus(1)).to.equal(ProposalStatus.Tied);
    });
  });

  describe("11. Deadline Enforcement", function () {
    beforeEach(async function () {
      await botDAO.connect(member1).createProposal("Deadline Test", "Desc", 100);
      await botDAO.connect(member1).vote(1, true);
    });

    it("reverts voting after the deadline has passed", async function () {
      await time.increase(101);

      await expect(
        botDAO.connect(member2).vote(1, true)
      ).to.be.revertedWith("BOTDAO: Voting has ended");
    });

    it("preserves vote counts immutably after the deadline", async function () {
      await time.increase(101);

      const [proposal, status] = await botDAO.getProposal(1);
      expect(proposal.yesVotes).to.equal(1);
      expect(proposal.noVotes).to.equal(0);
      expect(status).to.equal(ProposalStatus.Passed);
    });
  });

  describe("12. getProposal View Function", function () {
    it("returns full proposal struct and dynamic status accurately", async function () {
      await botDAO.connect(member1).createProposal("Full Query", "Testing getProposal", 200);
      await botDAO.connect(member1).vote(1, true);

      const [proposal, status] = await botDAO.getProposal(1);
      expect(proposal.id).to.equal(1);
      expect(proposal.title).to.equal("Full Query");
      expect(proposal.yesVotes).to.equal(1);
      expect(status).to.equal(ProposalStatus.Active);
    });

    it("reverts getProposal for an invalid proposal ID", async function () {
      await expect(botDAO.getProposal(0)).to.be.revertedWith("BOTDAO: Proposal does not exist");
      await expect(botDAO.getProposal(99)).to.be.revertedWith("BOTDAO: Proposal does not exist");
    });
  });

  describe("13. Admin Controls & Duration Limits", function () {
    it("reverts when a non-admin attempts to set voting duration limits", async function () {
      await expect(
        botDAO.connect(member1).setVotingDurationLimits(120, 86400)
      ).to.be.revertedWith("BOTDAO: Caller is not admin");
    });

    it("allows the admin to update duration limits and emits an event", async function () {
      await expect(botDAO.connect(admin).setVotingDurationLimits(120, 86400))
        .to.emit(botDAO, "VotingDurationLimitsUpdated")
        .withArgs(120, 86400);

      expect(await botDAO.minVotingDuration()).to.equal(120);
      expect(await botDAO.maxVotingDuration()).to.equal(86400);
    });

    it("enforces updated limits on future proposals while leaving existing proposals intact", async function () {
      // Create proposal 1 with duration 60 under old limits
      await botDAO.connect(member1).createProposal("Old Limits", "Desc", 60);
      const [proposal1] = await botDAO.getProposal(1);

      // Admin updates min to 120
      await botDAO.connect(admin).setVotingDurationLimits(120, 86400);

      // Creating a proposal with duration 60 now fails
      await expect(
        botDAO.connect(member1).createProposal("Too Short", "Desc", 60)
      ).to.be.revertedWith("BOTDAO: Duration outside allowed range");

      // Creating with duration 120 succeeds
      await botDAO.connect(member1).createProposal("New Valid", "Desc", 120);
      expect(await botDAO.proposalCount()).to.equal(2);

      // Proposal 1's deadline remains unchanged
      const [proposal1After] = await botDAO.getProposal(1);
      expect(proposal1After.deadline).to.equal(proposal1.deadline);
    });
  });

  describe("14. Invalid Admin Duration Limits Validation", function () {
    it("reverts if minimum duration is zero", async function () {
      await expect(
        botDAO.connect(admin).setVotingDurationLimits(0, 86400)
      ).to.be.revertedWith("BOTDAO: Min duration must be greater than zero");
    });

    it("reverts if minimum duration exceeds maximum duration", async function () {
      await expect(
        botDAO.connect(admin).setVotingDurationLimits(500, 400)
      ).to.be.revertedWith("BOTDAO: Min duration cannot exceed max duration");
    });
  });

  describe("15. Transfer Admin", function () {
    it("allows the current admin to transfer admin role and emits AdminTransferred", async function () {
      await expect(botDAO.connect(admin).transferAdmin(member1.address))
        .to.emit(botDAO, "AdminTransferred")
        .withArgs(admin.address, member1.address);

      expect(await botDAO.admin()).to.equal(member1.address);
    });

    it("ensures old admin loses admin permissions after transfer", async function () {
      await botDAO.connect(admin).transferAdmin(member1.address);

      await expect(
        botDAO.connect(admin).setVotingDurationLimits(100, 200)
      ).to.be.revertedWith("BOTDAO: Caller is not admin");

      // New admin has permissions
      await expect(
        botDAO.connect(member1).setVotingDurationLimits(100, 200)
      ).to.not.be.reverted;
    });

    it("reverts when non-admin attempts to transfer admin role", async function () {
      await expect(
        botDAO.connect(member2).transferAdmin(member3.address)
      ).to.be.revertedWith("BOTDAO: Caller is not admin");
    });

    it("reverts when transferring admin to zero address", async function () {
      await expect(
        botDAO.connect(admin).transferAdmin(ethers.ZeroAddress)
      ).to.be.revertedWith("BOTDAO: New admin cannot be zero address");
    });

    it("reverts when transferring admin to the existing admin", async function () {
      await expect(
        botDAO.connect(admin).transferAdmin(admin.address)
      ).to.be.revertedWith("BOTDAO: New admin must be different from current admin");
    });
  });

  describe("16. Dynamic Membership Evaluation", function () {
    it("dynamically recognizes membership only while native balance > 0", async function () {
      // Create a dedicated dynamic user and fund it with 1 ETH
      const dynamicUser = ethers.Wallet.createRandom().connect(ethers.provider);
      await setBalance(dynamicUser.address, ethers.parseEther("1.0"));

      // 1. When funded, user is a member and can create a proposal
      expect(await botDAO.isMember(dynamicUser.address)).to.be.true;
      await expect(
        botDAO.connect(dynamicUser).createProposal("Member Proposal", "Desc", 100)
      ).to.not.be.reverted;

      // 2. Set user balance to 0
      await setBalance(dynamicUser.address, 0);

      // 3. User is no longer recognized as a member
      expect(await botDAO.isMember(dynamicUser.address)).to.be.false;

      // 4. Calling member functions reverts
      await expect(
        botDAO.connect(dynamicUser).createProposal("Denied Proposal", "Desc", 100, { gasPrice: 0 })
      ).to.be.revertedWith("BOTDAO: Must hold native BOT to participate");

      await expect(
        botDAO.connect(dynamicUser).vote(1, true, { gasPrice: 0 })
      ).to.be.revertedWith("BOTDAO: Must hold native BOT to participate");

      // 5. Refund user balance
      await setBalance(dynamicUser.address, ethers.parseEther("0.5"));

      // 6. User qualifies as member again and can vote
      expect(await botDAO.isMember(dynamicUser.address)).to.be.true;
      await expect(
        botDAO.connect(dynamicUser).vote(1, true)
      ).to.not.be.reverted;
    });
  });

  describe("17. Event Argument Validation", function () {
    it("validates all event arguments on ProposalCreated", async function () {
      const tx = await botDAO.connect(member1).createProposal("Event Test", "Validating args", 500);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(botDAO, "ProposalCreated")
        .withArgs(1, member1.address, "Event Test", block.timestamp, block.timestamp + 500);
    });

    it("validates all event arguments on VoteCast", async function () {
      await botDAO.connect(member1).createProposal("Vote Event Test", "Desc", 500);

      await expect(botDAO.connect(member2).vote(1, true))
        .to.emit(botDAO, "VoteCast")
        .withArgs(1, member2.address, true, 1, 0);

      await expect(botDAO.connect(member3).vote(1, false))
        .to.emit(botDAO, "VoteCast")
        .withArgs(1, member3.address, false, 1, 1);
    });

    it("validates all event arguments on VotingDurationLimitsUpdated", async function () {
      await expect(botDAO.connect(admin).setVotingDurationLimits(300, 100000))
        .to.emit(botDAO, "VotingDurationLimitsUpdated")
        .withArgs(300, 100000);
    });

    it("validates all event arguments on AdminTransferred", async function () {
      await expect(botDAO.connect(admin).transferAdmin(member2.address))
        .to.emit(botDAO, "AdminTransferred")
        .withArgs(admin.address, member2.address);
    });
  });
});
