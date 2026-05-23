/**
 * CCTP V2 mint relayer — submits Circle's signed message + attestation to
 * Injective's MessageTransmitterV2 on behalf of the user, so the user
 * doesn't need INJ-EVM gas for the mint step.
 *
 * Safe because CCTP V2's receiveMessage is permissionless: the USDC mint
 * lands at the mintRecipient encoded in the original burn, regardless of
 * who submits the tx. Replay is contract-side: each message has a nonce
 * the contract tracks, so re-submitting fails harmlessly.
 *
 * Re-uses FAUCET_PRIVATE_KEY — same risk profile (small INJ float),
 * unified ops.
 */

import { ethers } from 'ethers';

const FAUCET_PRIVATE_KEY = process.env.FAUCET_PRIVATE_KEY ?? '';
const INJ_EVM_RPC = 'https://sentry.evm-rpc.injective.network/';

const MESSAGE_TRANSMITTER_ADDR = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';
const MESSAGE_TRANSMITTER_ABI = [
  'function receiveMessage(bytes message, bytes attestation) external returns (bool)',
];

// Per-IP throttle. Each mint costs the relayer ~0.000035 INJ; the user
// would have already paid much more on the source chain to burn USDC, so
// griefing isn't economical — but we cap anyway so a runaway client can't
// burn through the float in seconds.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 5;
const _ipHits = new Map();

function rateLimitOk(ip) {
  const now = Date.now();
  const hits = (_ipHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  _ipHits.set(ip, hits);
  return true;
}

function isHex(s, minBytes = 0) {
  if (typeof s !== 'string') return false;
  if (!/^0x[0-9a-fA-F]*$/.test(s)) return false;
  return (s.length - 2) / 2 >= minBytes;
}

// CCTP V2 message header layout:
//   version (4)  | sourceDomain (4)  | destinationDomain (4)  | nonce (8) | ...
// destinationDomain lives at byte offset 8 (chars 18..26 of the 0x-string).
function parseDestinationDomain(messageHex) {
  return parseInt(messageHex.slice(18, 26), 16);
}

const INJECTIVE_DOMAIN = 29;

export async function relayMint({ message, attestation }, ip) {
  if (!FAUCET_PRIVATE_KEY) throw new Error('Mint relayer not configured');
  if (!rateLimitOk(ip)) throw new Error('Rate limit exceeded — wait a minute');
  if (!isHex(message, 124)) throw new Error('Invalid CCTP message hex');
  if (!isHex(attestation, 65)) throw new Error('Invalid attestation hex');

  const dst = parseDestinationDomain(message);
  if (dst !== INJECTIVE_DOMAIN) {
    throw new Error(`Message dst domain ${dst} ≠ ${INJECTIVE_DOMAIN} (Injective)`);
  }

  const provider = new ethers.JsonRpcProvider(INJ_EVM_RPC);
  const wallet = new ethers.Wallet(FAUCET_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(MESSAGE_TRANSMITTER_ADDR, MESSAGE_TRANSMITTER_ABI, wallet);

  const tx = await contract.receiveMessage(message, attestation, {
    type: 0,
    gasLimit: 300_000,
    gasPrice: ethers.parseUnits('500', 'gwei'),
  });

  // Don't wait for receipt — Injective EVM RPC can be flaky on
  // getTransactionReceipt and the client polls the indexer for the
  // USDC balance change as the signal of success.
  return tx.hash;
}
