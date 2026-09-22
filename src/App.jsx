import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { BOTCHAIN_TESTNET, CONTRACT_ADDRESS } from './config';
import { BOTDAO_ABI } from './abi';

// Proposal status mapping matching the BotDAO smart contract enum:
// enum ProposalStatus { Active (0), Passed (1), Rejected (2), Tied (3) }
const STATUS_CONFIG = {
  0: { label: 'Active', badgeClass: 'badge-active' },
  1: { label: 'Passed', badgeClass: 'badge-passed' },
  2: { label: 'Rejected', badgeClass: 'badge-rejected' },
  3: { label: 'Tied', badgeClass: 'badge-tied' },
};

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return 'â€”';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hrs`;
  return `${Math.round(seconds / 86400)} days`;
}

function truncateAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function App() {
  const [theme, setTheme] = useState('light');
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [balance, setBalance] = useState(null);
  const [isMember, setIsMember] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletError, setWalletError] = useState(null);

  // Contract read-only state
  const [contractData, setContractData] = useState({
    admin: null,
    proposalCount: 0,
    minVotingDuration: 0,
    maxVotingDuration: 0,
    proposals: [],
  });
  const [isLoadingContract, setIsLoadingContract] = useState(true);
  const [contractError, setContractError] = useState(null);
  const [expandedProposalId, setExpandedProposalId] = useState(null);

  // Create proposal state
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposalTitle, setProposalTitle] = useState('');
  const [proposalDescription, setProposalDescription] = useState('');
  const [proposalDurationValue, setProposalDurationValue] = useState('1');
  const [proposalDurationUnit, setProposalDurationUnit] = useState('hours');
  const [isCreatingProposal, setIsCreatingProposal] = useState(false);
  const [proposalTransactionStatus, setProposalTransactionStatus] = useState(null);
  const [votingState, setVotingState] = useState({});
  const [shareStatus, setShareStatus] = useState({});

  // Theme synchronization
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const isCorrectNetwork = chainId === BOTCHAIN_TESTNET.chainId;

  // Load contract read-only data using public RPC provider
  const fetchContractData = useCallback(async () => {
    setIsLoadingContract(true);
    setContractError(null);

    try {
      const readProvider = new ethers.JsonRpcProvider(BOTCHAIN_TESTNET.rpcUrl);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BOTDAO_ABI, readProvider);

      const [adminAddress, countBN, minDurBN, maxDurBN] = await Promise.all([
        contract.admin(),
        contract.proposalCount(),
        contract.minVotingDuration(),
        contract.maxVotingDuration(),
      ]);

      const count = Number(countBN);
      const loadedProposals = [];

      // Fetch each existing proposal from the contract (if any exist)
      for (let i = 1; i <= count; i++) {
        const [proposalData, statusEnum] = await contract.getProposal(i);
        loadedProposals.push({
          id: Number(proposalData.id),
          creator: proposalData.creator,
          title: proposalData.title,
          description: proposalData.description,
          startTime: Number(proposalData.startTime),
          deadline: Number(proposalData.deadline),
          yesVotes: Number(proposalData.yesVotes),
          noVotes: Number(proposalData.noVotes),
          status: Number(statusEnum), // Source of truth directly from smart contract
        });
      }

      setContractData({
        admin: adminAddress,
        proposalCount: count,
        minVotingDuration: Number(minDurBN),
        maxVotingDuration: Number(maxDurBN),
        proposals: loadedProposals,
      });
    } catch (err) {
      console.error('Failed to read contract data from BotChain RPC:', err);
      setContractError(
        'Unable to load DAO contract data from BotChain testnet RPC. Please verify your connection or click Retry.'
      );
    } finally {
      setIsLoadingContract(false);
    }
  }, []);

  // Fetch balance and membership status for the connected wallet
  const fetchUserAccountData = useCallback(async (userAddress) => {
    if (!userAddress) {
      setBalance(null);
      setIsMember(false);
      return;
    }

    try {
      const readProvider = new ethers.JsonRpcProvider(BOTCHAIN_TESTNET.rpcUrl);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BOTDAO_ABI, readProvider);

      const [bal, mem] = await Promise.all([
        readProvider.getBalance(userAddress),
        contract.isMember(userAddress),
      ]);

      setBalance(ethers.formatEther(bal));
      setIsMember(mem);
    } catch (err) {
      console.error('Failed to fetch user account data:', err);
    }
  }, []);


  // Check whether the connected wallet has already voted on each proposal
  const fetchVotingState = useCallback(async (proposals, userAddress) => {
    if (!userAddress || !proposals?.length) {
      setVotingState({});
      return;
    }

    try {
      const readProvider = new ethers.JsonRpcProvider(BOTCHAIN_TESTNET.rpcUrl);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BOTDAO_ABI, readProvider);
      const results = {};

      await Promise.all(
        proposals.map(async (proposal) => {
          try {
            results[proposal.id] = await contract.hasVoted(proposal.id, userAddress);
          } catch (err) {
            console.error(`Failed to check vote status for proposal #${proposal.id}:`, err);
            results[proposal.id] = false;
          }
        })
      );

      setVotingState(results);
    } catch (err) {
      console.error('Failed to load voting status:', err);
    }
  }, []);

  // Refresh voting status whenever the connected wallet or proposals change
  useEffect(() => {
    fetchVotingState(contractData.proposals, account);
  }, [contractData.proposals, account, fetchVotingState]);

  // Open and scroll to a proposal from a shared link
  useEffect(() => {
    const proposalFromUrl = new URLSearchParams(window.location.search).get('proposal');
    if (!proposalFromUrl || contractData.proposals.length === 0) return;

    const proposalId = Number(proposalFromUrl);
    if (!Number.isInteger(proposalId) || proposalId <= 0) return;

    const proposalExists = contractData.proposals.some((proposal) => proposal.id === proposalId);
    if (!proposalExists) return;

    setExpandedProposalId(proposalId);

    setTimeout(() => {
      const proposalElement = document.getElementById("proposal-" + proposalId);
      if (proposalElement) {
        proposalElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  }, [contractData.proposals]);

  // Initial load of contract data
  useEffect(() => {
    fetchContractData();
  }, [fetchContractData]);

  // Handle wallet accounts changed
  const handleAccountsChanged = useCallback(
    (accounts) => {
      if (accounts && accounts.length > 0) {
        setAccount(accounts[0]);
        setWalletError(null);
        fetchUserAccountData(accounts[0]);
      } else {
        setAccount(null);
        setBalance(null);
        setIsMember(false);
      }
    },
    [fetchUserAccountData]
  );

  // Handle chain changed
  const handleChainChanged = useCallback(
    (chainIdHex) => {
      const parsedChainId = parseInt(chainIdHex, 16);
      setChainId(parsedChainId);
      setWalletError(null);
      if (account) {
        fetchUserAccountData(account);
      }
    },
    [account, fetchUserAccountData]
  );

  // Initialize browser wallet listeners
  useEffect(() => {
    if (window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum);

      provider
        .send('eth_accounts', [])
        .then((accounts) => {
          if (accounts && accounts.length > 0) {
            setAccount(accounts[0]);
            fetchUserAccountData(accounts[0]);
          }
        })
        .catch(console.error);

      provider
        .getNetwork()
        .then((network) => {
          setChainId(Number(network.chainId));
        })
        .catch(console.error);

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

      return () => {
        if (window.ethereum.removeListener) {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
          window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
      };
    }
  }, [handleAccountsChanged, handleChainChanged, fetchUserAccountData]);

  // Connect wallet
  const connectWallet = async () => {
    if (!window.ethereum) {
      setWalletError('No EVM wallet detected. Please install MetaMask or another Web3 browser wallet.');
      return;
    }

    setIsConnecting(true);
    setWalletError(null);

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const network = await provider.getNetwork();

      setAccount(accounts[0]);
      setChainId(Number(network.chainId));
      await fetchUserAccountData(accounts[0]);
    } catch (err) {
      console.error('Wallet connection error:', err);
      if (err.code === 4001) {
        setWalletError('Connection request was rejected by user.');
      } else {
        setWalletError(err.message || 'Failed to connect wallet.');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  // Switch or add BotChain Testnet
  const switchNetwork = async () => {
    if (!window.ethereum) return;

    setWalletError(null);

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BOTCHAIN_TESTNET.chainIdHex }],
      });
    } catch (switchError) {
      if (switchError.code === 4902 || switchError?.data?.originalError?.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: BOTCHAIN_TESTNET.chainIdHex,
                chainName: BOTCHAIN_TESTNET.chainName,
                rpcUrls: [BOTCHAIN_TESTNET.rpcUrl],
                nativeCurrency: {
                  name: 'BOT',
                  symbol: BOTCHAIN_TESTNET.currencySymbol,
                  decimals: BOTCHAIN_TESTNET.currencyDecimals,
                },
                blockExplorerUrls: [BOTCHAIN_TESTNET.explorerUrl],
              },
            ],
          });
        } catch (addError) {
          console.error('Failed to add BotChain Testnet:', addError);
          setWalletError(addError.message || 'Failed to add BotChain Testnet.');
        }
      } else if (switchError.code === 4001) {
        setWalletError('Network switch request was rejected by user.');
      } else {
        console.error('Failed to switch network:', switchError);
        setWalletError(switchError.message || 'Failed to switch to BotChain Testnet.');
      }
    }
  };


  // Cast a YES or NO vote on-chain
  const handleVote = async (proposalId, support) => {
    if (!window.ethereum) {
      setVotingState((prev) => ({
        ...prev,
        [proposalId]: { status: 'error', error: 'No wallet detected. Please install or unlock your wallet.' }
      }));
      return;
    }

    if (!account) {
      setVotingState((prev) => ({
        ...prev,
        [proposalId]: { status: 'error', error: 'Connect your wallet before voting.' }
      }));
      return;
    }

    if (!isCorrectNetwork) {
      setVotingState((prev) => ({
        ...prev,
        [proposalId]: { status: 'error', error: 'Switch to BOT Chain Testnet before voting.' }
      }));
      return;
    }

    if (!isMember) {
      setVotingState((prev) => ({
        ...prev,
        [proposalId]: { status: 'error', error: 'Only active DAO members can vote.' }
      }));
      return;
    }

    if (votingState[proposalId] === true) return;

    setVotingState((prev) => ({
      ...prev,
      [proposalId]: { status: 'confirming', support }
    }));

    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const signer = await browserProvider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BOTDAO_ABI, signer);

      const tx = await contract.vote(proposalId, support);

      setVotingState((prev) => ({
        ...prev,
        [proposalId]: { status: 'pending', support, hash: tx.hash }
      }));

      await tx.wait();

      await fetchContractData();

      const readProvider = new ethers.JsonRpcProvider(BOTCHAIN_TESTNET.rpcUrl);
      const readContract = new ethers.Contract(CONTRACT_ADDRESS, BOTDAO_ABI, readProvider);
      const alreadyVoted = await readContract.hasVoted(proposalId, account);

      setVotingState((prev) => ({
        ...prev,
        [proposalId]: alreadyVoted
      }));
    } catch (err) {
      console.error('Vote transaction failed:', err);

      let message = 'Vote failed. Please try again.';

      if (err?.code === 4001 || err?.code === 'ACTION_REJECTED') {
        message = 'Transaction was rejected in your wallet.';
      } else if (err?.shortMessage) {
        message = err.shortMessage;
      } else if (err?.reason) {
        message = err.reason;
      } else if (err?.message) {
        message = err.message;
      }

      setVotingState((prev) => ({
        ...prev,
        [proposalId]: { status: 'error', error: message }
      }));
    }
  };

  const handleShareProposal = async (proposalId) => {
    const shareUrl = window.location.origin + window.location.pathname + "?proposal=" + proposalId;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus((prev) => ({ ...prev, [proposalId]: 'Link copied' }));
    } catch (err) {
      console.error('Failed to copy proposal link:', err);
      setShareStatus((prev) => ({ ...prev, [proposalId]: 'Could not copy link' }));
    }

    setTimeout(() => {
      setShareStatus((prev) => ({ ...prev, [proposalId]: null }));
    }, 2500);
  };

  // Create a new proposal on-chain
  const handleCreateProposal = async (event) => {
    event.preventDefault();

    if (!window.ethereum) {
      setProposalTransactionStatus({
        type: 'error',
        message: 'No browser wallet detected. Please install MetaMask or another Web3 wallet.',
      });
      return;
    }

    if (!account) {
      setProposalTransactionStatus({
        type: 'error',
        message: 'Connect your wallet before creating a proposal.',
      });
      return;
    }

    if (!isCorrectNetwork) {
      setProposalTransactionStatus({
        type: 'error',
        message: 'Switch to BotChain Testnet before creating a proposal.',
      });
      return;
    }

    if (!isMember) {
      setProposalTransactionStatus({
        type: 'error',
        message: 'Only wallets holding native BOT can create proposals.',
      });
      return;
    }

    const title = proposalTitle.trim();
    const description = proposalDescription.trim();
    const value = Number(proposalDurationValue);

    if (!title) {
      setProposalTransactionStatus({
        type: 'error',
        message: 'Proposal title is required.',
      });
      return;
    }

    if (new TextEncoder().encode(title).length > 100) {
      setProposalTransactionStatus({
        type: 'error',
        message: 'Proposal title must be 100 bytes or fewer.',
      });
      return;
    }

    if (!description) {
      setProposalTransactionStatus({
        type: 'error',
        message: 'Proposal description is required.',
      });
      return;
    }

    if (new TextEncoder().encode(description).length > 1000) {
      setProposalTransactionStatus({
        type: 'error',
        message: 'Proposal description must be 1000 bytes or fewer.',
      });
      return;
    }

    if (!Number.isFinite(value) || value <= 0) {
      setProposalTransactionStatus({
        type: 'error',
        message: 'Enter a valid proposal duration.',
      });
      return;
    }

    const unitSeconds = {
      seconds: 1,
      minutes: 60,
      hours: 3600,
      days: 86400,
    };

    const duration = Math.floor(value * unitSeconds[proposalDurationUnit]);

    if (!Number.isSafeInteger(duration)) {
      setProposalTransactionStatus({
        type: 'error',
        message: 'Proposal duration is too large.',
      });
      return;
    }

    if (
      duration < contractData.minVotingDuration ||
      duration > contractData.maxVotingDuration
    ) {
      setProposalTransactionStatus({
        type: 'error',
        message: `Duration must be between ${formatDuration(
          contractData.minVotingDuration
        )} and ${formatDuration(contractData.maxVotingDuration)}.`,
      });
      return;
    }

    setIsCreatingProposal(true);
    setProposalTransactionStatus({
      type: 'pending-wallet',
      message: 'Waiting for wallet confirmation...',
    });

    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const signer = await browserProvider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BOTDAO_ABI, signer);

      const tx = await contract.createProposal(title, description, duration);

      setProposalTransactionStatus({
        type: 'pending',
        message: 'Transaction submitted. Waiting for BotChain confirmation...',
        hash: tx.hash,
      });

      await tx.wait();

      setProposalTransactionStatus({
        type: 'success',
        message: 'Proposal created successfully on BotChain.',
        hash: tx.hash,
      });

      setProposalTitle('');
      setProposalDescription('');
      setProposalDurationValue('1');
      setProposalDurationUnit('hours');
      setShowProposalForm(false);

      await fetchContractData();
    } catch (err) {
      console.error('Create proposal transaction failed:', err);

      let message = 'Failed to create proposal. Please try again.';

      if (err?.code === 4001 || err?.code === 'ACTION_REJECTED') {
        message = 'Transaction was rejected in your wallet.';
      } else if (err?.shortMessage) {
        message = err.shortMessage;
      } else if (err?.reason) {
        message = err.reason;
      } else if (err?.message) {
        message = err.message;
      }

      setProposalTransactionStatus({
        type: 'error',
        message,
      });
    } finally {
      setIsCreatingProposal(false);
    }
  };

  // Filter proposals into Active vs Completed
  const activeProposals = useMemo(
    () => contractData.proposals.filter((p) => p.status === 0),
    [contractData.proposals]
  );

  const completedProposals = useMemo(
    () => contractData.proposals.filter((p) => p.status !== 0),
    [contractData.proposals]
  );

  const isConnectedAdmin = useMemo(() => {
    if (!account || !contractData.admin) return false;
    return account.toLowerCase() === contractData.admin.toLowerCase();
  }, [account, contractData.admin]);

  return (
    <div className="container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-group">
          <div className="brand-logo">CV</div>
          <div>
            <h1 className="brand-title">CampusVoice</h1>
            <div className="brand-tagline">Student decisions, transparently recorded.</div>
          </div>
        </div>

        <div className="header-actions">
          {account && (
            <span className={`badge ${isCorrectNetwork ? 'badge-neutral' : 'badge-tied'}`}>
              <span className="badge-dot"></span>
              {isCorrectNetwork ? 'BotChain Testnet' : `Chain ID: ${chainId ?? 'Unknown'}`}
            </span>
          )}

          {!account ? (
            <button className="btn btn-primary" onClick={connectWallet} disabled={isConnecting}>
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          ) : !isCorrectNetwork ? (
            <button className="btn btn-warning btn-sm" onClick={switchNetwork}>
              Switch to BotChain
            </button>
          ) : (
            <button className="btn btn-sm" onClick={connectWallet} title="Click to switch account">
              {truncateAddress(account)}
            </button>
          )}

          <button className="btn btn-sm" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>

      {/* Network mismatch banner */}
      {account && !isCorrectNetwork && (
        <div className="alert-banner alert-banner-warning">
          <div>
            <strong>Wrong Network:</strong> Your wallet is currently connected to Chain ID{' '}
            {chainId ?? 'Unknown'}. CampusVoice operates on <strong>BotChain Testnet (Chain ID 968)</strong>.
          </div>
          <button className="btn btn-warning btn-sm" onClick={switchNetwork}>
            Switch to BotChain Testnet
          </button>
        </div>
      )}

      {/* Wallet error banner */}
      {walletError && (
        <div className="alert-banner alert-banner-danger">
          <div>{walletError}</div>
          <button className="btn btn-sm" onClick={() => setWalletError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Contract read error banner */}
      {contractError && (
        <div className="alert-banner alert-banner-danger">
          <div>{contractError}</div>
          <button className="btn btn-sm" onClick={fetchContractData}>
            Retry
          </button>
        </div>
      )}

      <main>
        {/* HERO / OVERVIEW */}
        <section className="hero-card">
          <div>
            <div className="section-count" style={{ marginBottom: '20px' }}>01 / PARTICIPATION</div>
            <h2 className="hero-headline">Your campus.<br />Your voice.</h2>
            <p className="hero-subtext">
              CampusVoice gives students a transparent way to participate in SUG decisions,
              vote on proposals, and see the final result recorded on BotChain.
            </p>

            <div className="vote-actions" style={{ marginTop: '28px' }}>
              <button
                className="btn btn-primary"
                onClick={() => document.getElementById('active-proposals')?.scrollIntoView({ behavior: 'smooth' })}
              >
                View Proposals
              </button>

              <button
                className="btn btn-sm"
                onClick={() => setShowProposalForm(true)}
                disabled={!account || !isCorrectNetwork || !isMember || isCreatingProposal}
                title={
                  !account
                    ? 'Connect your wallet first'
                    : !isCorrectNetwork
                      ? 'Switch to BotChain Testnet first'
                      : !isMember
                        ? 'You need native BOT to create proposals'
                        : 'Create a new proposal'
                }
              >
                Create Proposal
              </button>
            </div>
          </div>

          {/* User Identity Strip */}
          <div className="user-identity-strip">
            {!account ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Connect your wallet to check participation eligibility and take part in active student proposals.
              </div>
            ) : (
              <>
                <div className="identity-item">
                  <span className="identity-label">Connected:</span>
                  <span className="identity-val" title={account}>
                    {truncateAddress(account)}
                  </span>
                </div>

                <div className="identity-item">
                  <span className="identity-label">Balance:</span>
                  <span className="identity-val">
                    {balance !== null ? `${Number(balance).toFixed(4)} BOT` : 'â€”'}
                  </span>
                </div>

                <div className="identity-item">
                  <span className="identity-label">Status:</span>
                  {isMember ? (
                    <span className="badge badge-passed">
                      <span className="badge-dot"></span> Active DAO Member
                    </span>
                  ) : (
                    <span className="badge badge-neutral">
                      <span className="badge-dot"></span> Non-Member (0 BOT)
                    </span>
                  )}
                </div>

                {isConnectedAdmin && (
                  <div className="identity-item">
                    <span className="badge badge-admin">DAO Admin</span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* DAO STATS GRID */}
        <section className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Total Proposals</div>
            <div className="stat-number">
              {isLoadingContract ? <span className="skeleton" style={{ display: 'inline-block', width: '40px', height: '28px' }}></span> : contractData.proposalCount}
            </div>
            <div className="stat-subtext">Recorded on-chain</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Active Proposals</div>
            <div className="stat-number">
              {isLoadingContract ? <span className="skeleton" style={{ display: 'inline-block', width: '40px', height: '28px' }}></span> : activeProposals.length}
            </div>
            <div className="stat-subtext">Currently open for vote</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Completed Proposals</div>
            <div className="stat-number">
              {isLoadingContract ? <span className="skeleton" style={{ display: 'inline-block', width: '40px', height: '28px' }}></span> : completedProposals.length}
            </div>
            <div className="stat-subtext">Passed, Rejected, or Tied</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Voting Duration Range</div>
            <div className="stat-number" style={{ fontSize: '1.25rem', paddingTop: '6px' }}>
              {isLoadingContract ? (
                <span className="skeleton" style={{ display: 'inline-block', width: '80px', height: '22px' }}></span>
              ) : (
                `${formatDuration(contractData.minVotingDuration)} â€“ ${formatDuration(contractData.maxVotingDuration)}`
              )}
            </div>
            <div className="stat-subtext">Configured limits</div>
          </div>
        </section>

        {/* ACTIVE PROPOSALS SECTION */}
        <section id="active-proposals" style={{ marginBottom: '72px' }}>
          <div className="section-header">
            <div>
              <div className="section-count" style={{ marginBottom: '12px' }}>02 / OPEN DECISIONS</div>
              <div className="section-title">
                Active Proposals
                <span className="section-count">{activeProposals.length}</span>
              </div>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setShowProposalForm((prev) => !prev);
                setProposalTransactionStatus(null);
              }}
              disabled={!account || !isCorrectNetwork || !isMember || isCreatingProposal}
              title={
                !account
                  ? 'Connect your wallet first'
                  : !isCorrectNetwork
                    ? 'Switch to BotChain Testnet first'
                    : !isMember
                      ? 'You need native BOT to create proposals'
                      : 'Create a new proposal'
              }
            >
              {showProposalForm ? 'Close Form' : '+ New Proposal'}
            </button>
          </div>

          {showProposalForm && (
            <form
              onSubmit={handleCreateProposal}
              className="empty-state-card"
              style={{ marginBottom: '20px', textAlign: 'left' }}
            >
              <div style={{ marginBottom: '20px' }}>
                <h3 className="empty-state-title" style={{ marginBottom: '6px' }}>
                  Create a Proposal
                </h3>
                <p className="empty-state-desc">
                  Submit a YES/NO governance proposal directly to the BotChain smart contract.
                </p>
              </div>

              <div style={{ display: 'grid', gap: '16px' }}>
                <label>
                  <div className="transparency-label" style={{ marginBottom: '6px' }}>
                    Title
                  </div>
                  <input
                    type="text"
                    value={proposalTitle}
                    onChange={(e) => setProposalTitle(e.target.value)}
                    maxLength={100}
                    placeholder="e.g. Should SUG organize a student career fair this semester?"
                    disabled={isCreatingProposal}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--card-background)',
                      color: 'var(--text-primary)',
                      font: 'inherit',
                    }}
                  />
                  <div style={{ marginTop: '5px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                    {new TextEncoder().encode(proposalTitle).length}/100 bytes
                  </div>
                </label>

                <label>
                  <div className="transparency-label" style={{ marginBottom: '6px' }}>
                    Description
                  </div>
                  <textarea
                    value={proposalDescription}
                    onChange={(e) => setProposalDescription(e.target.value)}
                    maxLength={1000}
                    rows={5}
                    placeholder="Explain what you are proposing and what members should vote on."
                    disabled={isCreatingProposal}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--card-background)',
                      color: 'var(--text-primary)',
                      font: 'inherit',
                      resize: 'vertical',
                    }}
                  />
                  <div style={{ marginTop: '5px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                    {new TextEncoder().encode(proposalDescription).length}/1000 bytes
                  </div>
                </label>

                <div>
                  <div className="transparency-label" style={{ marginBottom: '6px' }}>
                    Voting Duration
                  </div>

                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={proposalDurationValue}
                      onChange={(e) => setProposalDurationValue(e.target.value)}
                      disabled={isCreatingProposal}
                      style={{
                        flex: '1 1 140px',
                        minWidth: '120px',
                        padding: '12px 14px',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--card-background)',
                        color: 'var(--text-primary)',
                        font: 'inherit',
                      }}
                    />

                    <select
                      value={proposalDurationUnit}
                      onChange={(e) => setProposalDurationUnit(e.target.value)}
                      disabled={isCreatingProposal}
                      style={{
                        flex: '1 1 160px',
                        padding: '12px 14px',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--card-background)',
                        color: 'var(--text-primary)',
                        font: 'inherit',
                      }}
                    >
                      <option value="seconds">Seconds</option>
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>

                  <div style={{ marginTop: '6px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                    Allowed range: {formatDuration(contractData.minVotingDuration)} ? {formatDuration(contractData.maxVotingDuration)}
                  </div>
                </div>

                {proposalTransactionStatus && (
                  <div
                    className={`alert-banner ${
                      proposalTransactionStatus.type === 'error'
                        ? 'alert-banner-danger'
                        : proposalTransactionStatus.type === 'success'
                          ? 'alert-banner-success'
                          : 'alert-banner-warning'
                    }`}
                    style={{ marginBottom: 0 }}
                  >
                    <div>
                      <strong>
                        {proposalTransactionStatus.type === 'success'
                          ? 'Success'
                          : proposalTransactionStatus.type === 'error'
                            ? 'Error'
                            : proposalTransactionStatus.type === 'pending'
                              ? 'Transaction pending'
                              : 'Wallet confirmation'}
                      </strong>
                      <div>{proposalTransactionStatus.message}</div>
                      {proposalTransactionStatus.hash && (
                        <a
                          className="link"
                          href={`${BOTCHAIN_TESTNET.explorerUrl}/tx/${proposalTransactionStatus.hash}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: 'inline-block', marginTop: '5px' }}
                        >
                          View transaction ?
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setShowProposalForm(false);
                      setProposalTransactionStatus(null);
                    }}
                    disabled={isCreatingProposal}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={isCreatingProposal}
                  >
                    {isCreatingProposal ? 'Creating Proposal...' : 'Create Proposal'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {isLoadingContract ? (
            <div className="empty-state-card">
              <div className="empty-state-desc">Loading proposals from BotChain Testnet...</div>
            </div>
          ) : activeProposals.length === 0 ? (
            <div className="empty-state-card">
              <div className="empty-state-icon">ðŸ“‹</div>
              <h3 className="empty-state-title">No active proposals</h3>
              <p className="empty-state-desc">
                There are currently no proposals open for voting on BotChain testnet. When a proposal is created, it will appear here for members to vote YES or NO.
              </p>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setShowProposalForm(true);
                  setProposalTransactionStatus(null);
                }}
                disabled={!account || !isCorrectNetwork || !isMember || isCreatingProposal}
              >
                {account && isMember ? 'Create the First Proposal' : 'Connect as a DAO Member to Create'}
              </button>
            </div>
          ) : (
            <div className="proposals-grid">
              {activeProposals.map((proposal) => {
                const totalVotes = proposal.yesVotes + proposal.noVotes;
                const yesPercent = totalVotes > 0 ? (proposal.yesVotes / totalVotes) * 100 : 50;
                const isExpanded = expandedProposalId === proposal.id;

                return (
                  <div key={proposal.id} id={`proposal-${proposal.id}`} className="proposal-card">
                    <div className="proposal-card-header">
                      <div>
                        <div className="section-count" style={{ marginBottom: '10px' }}>
                          PROPOSAL {String(proposal.id).padStart(2, '0')}
                        </div>
                        <h4 className="proposal-card-title">{proposal.title}</h4>
                      </div>

                      <span className={`badge ${STATUS_CONFIG[proposal.status]?.badgeClass ?? 'badge-neutral'}`}>
                        <span className="badge-dot"></span>
                        {STATUS_CONFIG[proposal.status]?.label ?? 'Active'}
                      </span>
                    </div>

                    <p className="proposal-card-desc">
                      {isExpanded || proposal.description.length <= 160
                        ? proposal.description
                        : `${proposal.description.slice(0, 160)}...`}
                    </p>

                    {proposal.description.length > 160 && (
                      <button
                        className="btn btn-sm"
                        style={{ marginBottom: '20px', padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => setExpandedProposalId(isExpanded ? null : proposal.id)}
                      >
                        {isExpanded ? 'Show less' : 'Read full proposal'}
                      </button>
                    )}

                    <div className="vote-breakdown">
                      <div className="vote-counts-row">
                        <span className="vote-count-yes">YES {proposal.yesVotes}</span>
                        <span>{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span>
                        <span className="vote-count-no">NO {proposal.noVotes}</span>
                      </div>

                      <div className="vote-progress-bar">
                        <div
                          className="vote-progress-yes"
                          style={{ width: `${totalVotes > 0 ? yesPercent : 0}%` }}
                        ></div>
                        <div
                          className="vote-progress-no"
                          style={{ width: `${totalVotes > 0 ? 100 - yesPercent : 0}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="proposal-meta-row">
                      <div>
                        <span>Voting closes</span>
                        <strong>{new Date(proposal.deadline * 1000).toLocaleString()}</strong>
                      </div>

                      <div>
                        <span>Created by</span>
                        <a
                          className="link"
                          href={`${BOTCHAIN_TESTNET.explorerUrl}/address/${proposal.creator}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {truncateAddress(proposal.creator)}
                        </a>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleShareProposal(proposal.id)}
                      >
                        {shareStatus[proposal.id] || 'Share Proposal'}
                      </button>
                    </div>

                    <div className="proposal-voting">
                      {votingState[proposal.id] === true ? (
                        <div className="vote-complete">
                          ✓ You have already voted on this proposal
                        </div>
                      ) : (
                        <>
                          <div className="vote-actions">
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => handleVote(proposal.id, true)}
                              disabled={
                                votingState[proposal.id]?.status === 'confirming' ||
                                votingState[proposal.id]?.status === 'pending'
                              }
                            >
                              {votingState[proposal.id]?.status === 'confirming' && votingState[proposal.id]?.support === true
                                ? 'Confirm in wallet...'
                                : votingState[proposal.id]?.status === 'pending' && votingState[proposal.id]?.support === true
                                ? 'Voting...'
                                : 'Vote YES'}
                            </button>

                            <button
                              type="button"
                              className="btn"
                              onClick={() => handleVote(proposal.id, false)}
                              disabled={
                                votingState[proposal.id]?.status === 'confirming' ||
                                votingState[proposal.id]?.status === 'pending'
                              }
                            >
                              {votingState[proposal.id]?.status === 'confirming' && votingState[proposal.id]?.support === false
                                ? 'Confirm in wallet...'
                                : votingState[proposal.id]?.status === 'pending' && votingState[proposal.id]?.support === false
                                ? 'Voting...'
                                : 'Vote NO'}
                            </button>
                          </div>

                          {votingState[proposal.id]?.error && (
                            <div className="vote-error">
                              {votingState[proposal.id].error}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* PROPOSAL HISTORY SECTION */}
        <section style={{ marginBottom: '72px' }}>
          <div className="section-header">
            <div>
              <div className="section-count" style={{ marginBottom: '12px' }}>03 / DECISIONS</div>
              <div className="section-title">
                Proposal History
                <span className="section-count">{completedProposals.length}</span>
              </div>
            </div>
          </div>

          {isLoadingContract ? (
            <div className="empty-state-card">
              <div className="empty-state-desc">Loading proposal history...</div>
            </div>
          ) : completedProposals.length === 0 ? (
            <div className="empty-state-card">
              <div className="empty-state-icon">ðŸ</div>
              <h3 className="empty-state-title">No completed proposals yet</h3>
              <p className="empty-state-desc">
                Proposals that have reached their voting deadline will be archived here with their final immutable result: Passed, Rejected, or Tied.
              </p>
            </div>
          ) : (
            <div className="proposals-grid">
              {completedProposals.map((proposal) => {
                const totalVotes = proposal.yesVotes + proposal.noVotes;
                const statusMeta = STATUS_CONFIG[proposal.status] ?? { label: 'Concluded', badgeClass: 'badge-neutral' };

                return (
                  <div key={proposal.id} id={`proposal-${proposal.id}`} className="proposal-card">
                    <div className="proposal-card-header">
                      <div>
                        <div className="section-count" style={{ marginBottom: '10px' }}>
                          DECISION {String(proposal.id).padStart(2, '0')}
                        </div>
                        <h4 className="proposal-card-title">{proposal.title}</h4>
                      </div>

                      <span className={`badge ${statusMeta.badgeClass}`}>
                        <span className="badge-dot"></span>
                        {statusMeta.label}
                      </span>
                    </div>

                    <p className="proposal-card-desc">{proposal.description}</p>

                    <div className="vote-breakdown">
                      <div className="vote-counts-row">
                        <span className="vote-count-yes">YES {proposal.yesVotes}</span>
                        <span>{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span>
                        <span className="vote-count-no">NO {proposal.noVotes}</span>
                      </div>

                      <div className="vote-progress-bar">
                        <div
                          className="vote-progress-yes"
                          style={{ width: `${totalVotes > 0 ? (proposal.yesVotes / totalVotes) * 100 : 0}%` }}
                        ></div>
                        <div
                          className="vote-progress-no"
                          style={{ width: `${totalVotes > 0 ? (proposal.noVotes / totalVotes) * 100 : 0}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="proposal-meta-row">
                      <div>
                        <span>Closed at</span>
                        <strong>{new Date(proposal.deadline * 1000).toLocaleString()}</strong>
                      </div>

                      <div>
                        <span>Created by</span>
                        <a
                          className="link"
                          href={`${BOTCHAIN_TESTNET.explorerUrl}/address/${proposal.creator}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {truncateAddress(proposal.creator)}
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* CONTRACT TRANSPARENCY CARD */}
        <section className="transparency-card">
          <div style={{ marginBottom: '32px' }}>
            <div className="section-count" style={{ marginBottom: '12px' }}>04 / VERIFICATION</div>
            <h3 style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', fontWeight: 700, letterSpacing: '-0.04em', marginBottom: '12px' }}>
              Every decision leaves a record.
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', maxWidth: '620px', margin: 0 }}>
              CampusVoice records proposals and vote tallies on BotChain Testnet.
              Anyone can inspect the contract and verify the activity on-chain.
            </p>
          </div>

          <div className="transparency-grid">
            <div className="transparency-item">
              <div className="transparency-label">Contract</div>
              <div className="transparency-value">
                <a
                  className="link"
                  href={`${BOTCHAIN_TESTNET.explorerUrl}/address/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {truncateAddress(CONTRACT_ADDRESS)} ↗
                </a>
              </div>
            </div>

            <div className="transparency-item">
              <div className="transparency-label">Contract Admin</div>
              <div className="transparency-value">
                {contractData.admin ? (
                  <a
                    className="link"
                    href={`${BOTCHAIN_TESTNET.explorerUrl}/address/${contractData.admin}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {truncateAddress(contractData.admin)} ↗
                  </a>
                ) : '—'}
              </div>
            </div>

            <div className="transparency-item">
              <div className="transparency-label">Network</div>
              <div className="transparency-value">{BOTCHAIN_TESTNET.chainName}</div>
            </div>

            <div className="transparency-item">
              <div className="transparency-label">Chain ID</div>
              <div className="transparency-value">{BOTCHAIN_TESTNET.chainId}</div>
            </div>

            <div className="transparency-item">
              <div className="transparency-label">RPC Endpoint</div>
              <div className="transparency-value" style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>
                {BOTCHAIN_TESTNET.rpcUrl}
              </div>
            </div>

            <div className="transparency-item" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <a
                className="btn btn-primary btn-sm"
                href={`${BOTCHAIN_TESTNET.explorerUrl}/address/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noreferrer"
              >
                View Contract on Explorer ↗
              </a>
            </div>
          </div>

          <div style={{ marginTop: '28px', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={fetchContractData} disabled={isLoadingContract}>
              {isLoadingContract ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;




