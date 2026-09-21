// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title BotDAO
 * @dev A beginner-friendly DAO contract deployed on BotChain testnet.
 * Membership is determined dynamically by holding native BOT (msg.sender.balance > 0).
 */
contract BotDAO {
    // --- Data Structures ---

    enum ProposalStatus {
        Active,
        Passed,
        Rejected,
        Tied
    }

    struct Proposal {
        uint256 id;
        address creator;
        string title;
        string description;
        uint256 startTime;
        uint256 deadline;
        uint256 yesVotes;
        uint256 noVotes;
    }

    // --- State Variables ---

    address public admin;
    uint256 public proposalCount;
    uint256 public minVotingDuration;
    uint256 public maxVotingDuration;

    // proposalId => Proposal
    mapping(uint256 => Proposal) public proposals;

    // proposalId => voter address => hasVoted
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // --- Events ---

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed creator,
        string title,
        uint256 startTime,
        uint256 deadline
    );

    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 totalYes,
        uint256 totalNo
    );

    event VotingDurationLimitsUpdated(
        uint256 minDuration,
        uint256 maxDuration
    );

    event AdminTransferred(
        address indexed previousAdmin,
        address indexed newAdmin
    );

    // --- Modifiers ---

    modifier onlyAdmin() {
        require(msg.sender == admin, "BOTDAO: Caller is not admin");
        _;
    }

    modifier onlyMember() {
        require(msg.sender.balance > 0, "BOTDAO: Must hold native BOT to participate");
        _;
    }

    // --- Constructor ---

    constructor() {
        admin = msg.sender;
        // Default voting limits: minimum 60 seconds (for testnet testing), maximum 7 days
        minVotingDuration = 60;
        maxVotingDuration = 7 days; // 604,800 seconds
    }

    // --- Member Functions ---

    /**
     * @notice Creates a new proposal in the DAO.
     * @param title A short title (1 to 100 bytes).
     * @param description Full proposal details (1 to 1000 bytes).
     * @param duration Voting window duration in seconds (must be within min and max limits).
     * @return proposalId The ID of the newly created proposal.
     */
    function createProposal(
        string calldata title,
        string calldata description,
        uint256 duration
    ) external onlyMember returns (uint256 proposalId) {
        require(bytes(title).length > 0, "BOTDAO: Title cannot be empty");
        require(bytes(title).length <= 100, "BOTDAO: Title exceeds 100 bytes");
        require(bytes(description).length > 0, "BOTDAO: Description cannot be empty");
        require(bytes(description).length <= 1000, "BOTDAO: Description exceeds 1000 bytes");
        require(
            duration >= minVotingDuration && duration <= maxVotingDuration,
            "BOTDAO: Duration outside allowed range"
        );

        proposalCount++;
        proposalId = proposalCount;

        uint256 startTime = block.timestamp;
        uint256 deadline = startTime + duration;

        proposals[proposalId] = Proposal({
            id: proposalId,
            creator: msg.sender,
            title: title,
            description: description,
            startTime: startTime,
            deadline: deadline,
            yesVotes: 0,
            noVotes: 0
        });

        emit ProposalCreated(proposalId, msg.sender, title, startTime, deadline);
    }

    /**
     * @notice Casts a vote on an active proposal.
     * @param proposalId The ID of the proposal to vote on.
     * @param support True for YES, False for NO.
     */
    function vote(uint256 proposalId, bool support) external onlyMember {
        require(proposalId > 0 && proposalId <= proposalCount, "BOTDAO: Proposal does not exist");

        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp <= proposal.deadline, "BOTDAO: Voting has ended");
        require(!hasVoted[proposalId][msg.sender], "BOTDAO: Already voted on this proposal");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            proposal.yesVotes++;
        } else {
            proposal.noVotes++;
        }

        emit VoteCast(proposalId, msg.sender, support, proposal.yesVotes, proposal.noVotes);
    }

    // --- View Functions ---

    /**
     * @notice Returns the current dynamic status of a proposal.
     * @param proposalId The ID of the proposal.
     */
    function getProposalStatus(uint256 proposalId) public view returns (ProposalStatus) {
        require(proposalId > 0 && proposalId <= proposalCount, "BOTDAO: Proposal does not exist");

        Proposal storage proposal = proposals[proposalId];

        if (block.timestamp <= proposal.deadline) {
            return ProposalStatus.Active;
        }

        if (proposal.yesVotes > proposal.noVotes) {
            return ProposalStatus.Passed;
        } else if (proposal.noVotes > proposal.yesVotes) {
            return ProposalStatus.Rejected;
        } else {
            return ProposalStatus.Tied;
        }
    }

    /**
     * @notice Returns full proposal data and its computed status in a single call.
     * @param proposalId The ID of the proposal.
     */
    function getProposal(uint256 proposalId)
        external
        view
        returns (Proposal memory proposal, ProposalStatus status)
    {
        require(proposalId > 0 && proposalId <= proposalCount, "BOTDAO: Proposal does not exist");
        proposal = proposals[proposalId];
        status = getProposalStatus(proposalId);
    }

    /**
     * @notice Checks whether an account currently qualifies as a DAO member.
     * @param account The address to check.
     */
    function isMember(address account) external view returns (bool) {
        return account.balance > 0;
    }

    // --- Admin Functions ---

    /**
     * @notice Updates the minimum and maximum allowed voting duration for future proposals.
     * @param _minDuration Minimum duration in seconds (> 0).
     * @param _maxDuration Maximum duration in seconds (>= _minDuration).
     */
    function setVotingDurationLimits(uint256 _minDuration, uint256 _maxDuration) external onlyAdmin {
        require(_minDuration > 0, "BOTDAO: Min duration must be greater than zero");
        require(_minDuration <= _maxDuration, "BOTDAO: Min duration cannot exceed max duration");

        minVotingDuration = _minDuration;
        maxVotingDuration = _maxDuration;

        emit VotingDurationLimitsUpdated(_minDuration, _maxDuration);
    }

    /**
     * @notice Transfers admin authority to a new address.
     * @param newAdmin Address of the new admin.
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "BOTDAO: New admin cannot be zero address");
        require(newAdmin != admin, "BOTDAO: New admin must be different from current admin");

        address previousAdmin = admin;
        admin = newAdmin;

        emit AdminTransferred(previousAdmin, newAdmin);
    }
}
