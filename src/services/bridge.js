/**
 * USDC inbound bridge to Injective EVM via Circle CCTP V2 burn-and-mint.
 *
 * Replaces the previous deBridge DLN flow, which couldn't route to the
 * native USDC denom (erc20:0xa00c59ff...) that the new USDC perps quote in.
 * CCTP's mint side is permissionless — any wallet can submit the
 * attestation — so a self-hosted widget like this works without a relayer.
 *
 * The state machine is intentionally linear; if the burn lands but the
 * mint never gets submitted, the user can recover via the standalone
 * widget at /Users/ck/dev/usdc-widget (see its README).
 *
 * Ported from /Users/ck/dev/usdc-widget/public/app.js — keep them in sync.
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  fallback,
  parseUnits,
  pad,
  getAddress,
  isAddress,
} from 'viem';

import {
  SOURCE_CHAINS,
  INJECTIVE,
  ATTESTATION_API,
  STANDARD_FINALITY,
  STANDARD_MAX_FEE,
  ZERO_BYTES32,
  viemChain,
  TOKEN_MESSENGER_V2_ABI,
  MESSAGE_TRANSMITTER_V2_ABI,
  ERC20_ABI,
} from './cctp.js';

// ─── Re-exports for callers (BridgeModal expects these here) ──────────────
export { SOURCE_CHAINS, INJECTIVE } from './cctp.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function publicClient(c) {
  return createPublicClient({
    chain: viemChain(c),
    transport: fallback(c.rpcs.map((url) => http(url, { timeout: 8000 }))),
  });
}

function walletClient(chain) {
  if (!window.ethereum) {
    throw new Error('No wallet detected. Connect MetaMask to bridge.');
  }
  return createWalletClient({
    chain: viemChain(chain),
    transport: custom(window.ethereum),
  });
}

async function ensureChain(chain) {
  const hexId = '0x' + chain.id.toString(16);
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexId }],
    });
  } catch (err) {
    if (err.code === 4902 || err?.data?.originalError?.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hexId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcs,
          blockExplorerUrls: [chain.explorer],
        }],
      });
    } else {
      throw err;
    }
  }
}

// ─── Source-side reads ────────────────────────────────────────────────────

export async function fetchSourceUsdcBalance(chainId, account) {
  const chain = SOURCE_CHAINS.find((c) => c.id === chainId);
  if (!chain) throw new Error(`Unsupported source chain: ${chainId}`);
  if (!isAddress(account)) throw new Error('Invalid account address');
  return publicClient(chain).readContract({
    address: chain.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [getAddress(account)],
  });
}

// ─── Attestation polling ──────────────────────────────────────────────────

async function pollAttestation(srcDomain, burnTxHash) {
  const url = `${ATTESTATION_API}/v2/messages/${srcDomain}?transactionHash=${burnTxHash}`;
  const start = Date.now();
  const timeoutMs = 30 * 60 * 1000; // 30 min

  while (true) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const msg = data.messages?.[0];
        if (msg && msg.status === 'complete' && msg.attestation && msg.attestation !== 'PENDING') {
          return { message: msg.message, attestation: msg.attestation };
        }
      }
    } catch {
      // network blip — retry
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Attestation timed out after 30 minutes.');
    }
    await sleep(5000);
  }
}

// ─── High-level orchestrator ──────────────────────────────────────────────

/**
 * Run a CCTP V2 inbound bridge: USDC on `sourceChainId` → native USDC on
 * Injective EVM. Drives a finite state machine via `onPhase(phase, data)`,
 * where `phase` is one of:
 *
 *   'approve-sign' | 'approve-confirm' | 'burn-sign' | 'burn-confirm' |
 *   'attest' | 'switch' | 'mint-sign' | 'mint-confirm' | 'success'
 *
 * `data` carries phase-relevant fields (txHash, message, attestation, ...).
 *
 * The function throws if any step fails — caller surfaces the error and
 * decides whether to retry. Recovery from a half-completed run (burn ok,
 * mint pending) is manual — see the widget README.
 */
export async function executeBridge({
  sourceChainId, amountHuman, senderEvm, recipientEvm, onPhase = () => {},
}) {
  const src = SOURCE_CHAINS.find((c) => c.id === sourceChainId);
  if (!src) throw new Error(`Unsupported source chain: ${sourceChainId}`);
  if (!isAddress(senderEvm) || !isAddress(recipientEvm)) {
    throw new Error('sender/recipient must be a 0x… EVM address');
  }

  const amount = parseUnits(amountHuman, 6);
  if (amount === 0n) throw new Error('Amount must be > 0');

  const recipientChecksummed = getAddress(recipientEvm);
  const mintRecipient = pad(recipientChecksummed, { size: 32 });
  const senderChecksummed = getAddress(senderEvm);

  const srcPublic = publicClient(src);
  const dstPublic = publicClient(INJECTIVE);

  // 1. Switch wallet to the source chain.
  await ensureChain(src);

  // 2. Allowance check — skip approve if sufficient.
  const allowance = await srcPublic.readContract({
    address: src.usdc,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [senderChecksummed, src.cctp.tokenMessenger],
  });

  let approveHash = null;
  if (allowance < amount) {
    onPhase('approve-sign', { src: src.name });
    approveHash = await walletClient(src).writeContract({
      account: senderChecksummed,
      address: src.usdc,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [src.cctp.tokenMessenger, amount],
    });
    onPhase('approve-confirm', { txHash: approveHash, src: src.name });
    await srcPublic.waitForTransactionReceipt({ hash: approveHash });
  }

  // 3. Burn on the source chain.
  onPhase('burn-sign', { src: src.name });
  const burnHash = await walletClient(src).writeContract({
    account: senderChecksummed,
    address: src.cctp.tokenMessenger,
    abi: TOKEN_MESSENGER_V2_ABI,
    functionName: 'depositForBurn',
    args: [
      amount,
      INJECTIVE.domain,
      mintRecipient,
      src.usdc,
      ZERO_BYTES32,
      STANDARD_MAX_FEE,
      STANDARD_FINALITY,
    ],
  });
  onPhase('burn-confirm', { txHash: burnHash, src: src.name });
  await srcPublic.waitForTransactionReceipt({ hash: burnHash });

  // 4. Poll Circle for attestation. Can take ~13 min on Ethereum,
  // ~1 min on Arbitrum/Base/OP/Avalanche, ~5 min on Polygon.
  onPhase('attest', { srcDomain: src.domain, burnHash });
  const { message, attestation } = await pollAttestation(src.domain, burnHash);

  // 5. Switch to Injective EVM for the mint.
  onPhase('switch', { dst: INJECTIVE.name });
  await ensureChain(INJECTIVE);

  // 6. Mint on Injective EVM (permissionless — anyone can submit).
  onPhase('mint-sign', { dst: INJECTIVE.name });
  const mintHash = await walletClient(INJECTIVE).writeContract({
    account: senderChecksummed,
    address: INJECTIVE.cctp.messageTransmitter,
    abi: MESSAGE_TRANSMITTER_V2_ABI,
    functionName: 'receiveMessage',
    args: [message, attestation],
  });
  onPhase('mint-confirm', { txHash: mintHash, dst: INJECTIVE.name });
  await dstPublic.waitForTransactionReceipt({ hash: mintHash });

  onPhase('success', { burnHash, mintHash, src: src.name });
  return { burnHash, mintHash, srcName: src.name, srcExplorer: src.explorer };
}
