/**
 * CCTP V2 mint relayer: submits Circle's signed message + attestation to
 * Injective's MessageTransmitterV2 on behalf of the user, so the user
 * doesn't need INJ-EVM gas for the mint step.
 *
 * Safe because CCTP V2's receiveMessage is permissionless: the USDC mint
 * lands at the mintRecipient encoded in the original burn, regardless of
 * who submits the tx. Replay is contract-side: each message has a nonce
 * the contract tracks, so re-submitting fails harmlessly.
 *
 * Re-uses FAUCET_PRIVATE_KEY, same risk profile (small INJ float),
 * unified ops.
 */

import { ethers } from 'ethers';
import { INJECTIVE_EVM_RPC_URL } from '../services/injectiveNetwork.js';

const FAUCET_PRIVATE_KEY = process.env.FAUCET_PRIVATE_KEY ?? '';

const MESSAGE_TRANSMITTER_ADDR = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';
const MESSAGE_TRANSMITTER_ABI = [
  'function receiveMessage(bytes message, bytes attestation) external returns (bool)',
];

const MIN_RELAY_GAS_PRICE = ethers.parseUnits('1', 'gwei');
const GAS_LIMIT_BUFFER_NUMERATOR = 140n;
const GAS_LIMIT_BUFFER_DENOMINATOR = 100n;
const GAS_LIMIT_EXTRA_UNITS = 50_000n;
const RECEIPT_TIMEOUT_MS = 45_000;
const RECEIPT_POLL_MS = 1_000;

// Per-IP throttle. Each mint costs the relayer ~0.000035 INJ; the user
// would have already paid much more on the source chain to burn USDC, so
// griefing isn't economical, but we cap anyway so a runaway client can't
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
//   version (4) | sourceDomain (4) | destinationDomain (4) | nonce (32) | ...
// destinationDomain lives at byte offset 8 (chars 18..26 of the 0x-string).
function parseDestinationDomain(messageHex) {
  return parseInt(messageHex.slice(18, 26), 16);
}

const INJECTIVE_DOMAIN = 29;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function relayGasLimitFromEstimate(estimate) {
  const units = BigInt(estimate);
  return ((units * GAS_LIMIT_BUFFER_NUMERATOR) / GAS_LIMIT_BUFFER_DENOMINATOR) + GAS_LIMIT_EXTRA_UNITS;
}

export function relayGasPriceFromFeeData(feeData) {
  const gasPrice = BigInt(feeData?.gasPrice || 0);
  if (gasPrice <= 0n) return MIN_RELAY_GAS_PRICE;

  const buffered = gasPrice * 2n;
  return buffered > MIN_RELAY_GAS_PRICE ? buffered : MIN_RELAY_GAS_PRICE;
}

async function evmRpc(method, params) {
  const res = await fetch(INJECTIVE_EVM_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || `${method} failed`);
  return data.result;
}

async function waitForReceipt(txHash) {
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const receipt = await evmRpc('eth_getTransactionReceipt', [txHash]);
    if (!receipt) {
      await sleep(RECEIPT_POLL_MS);
      continue;
    }

    if (receipt.status !== '0x1') {
      throw new Error(`Mint relayer tx reverted: ${txHash}`);
    }
    return receipt;
  }

  throw new Error(`Mint relayer tx not confirmed: ${txHash}`);
}

export async function relayMint({ message, attestation }, ip) {
  if (!FAUCET_PRIVATE_KEY) throw new Error('Mint relayer not configured');
  if (!rateLimitOk(ip)) throw new Error('Rate limit exceeded, wait a minute');
  if (!isHex(message, 124)) throw new Error('Invalid CCTP message hex');
  if (!isHex(attestation, 65)) throw new Error('Invalid attestation hex');

  const dst = parseDestinationDomain(message);
  if (dst !== INJECTIVE_DOMAIN) {
    throw new Error(`Message dst domain ${dst} != ${INJECTIVE_DOMAIN} (Injective)`);
  }

  const provider = new ethers.JsonRpcProvider(INJECTIVE_EVM_RPC_URL);
  const wallet = new ethers.Wallet(FAUCET_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(MESSAGE_TRANSMITTER_ADDR, MESSAGE_TRANSMITTER_ABI, wallet);
  const gasEstimate = await contract.receiveMessage.estimateGas(message, attestation);
  const gasLimit = relayGasLimitFromEstimate(gasEstimate);
  const gasPrice = relayGasPriceFromFeeData(await provider.getFeeData());

  const tx = await contract.receiveMessage(message, attestation, {
    type: 0,
    gasLimit,
    gasPrice,
  });

  console.info('[CCTP-MINT] relay.submitted', JSON.stringify({
    txHash: tx.hash,
    gasEstimate: gasEstimate.toString(),
    gasLimit: gasLimit.toString(),
    gasPrice: gasPrice.toString(),
  }));

  const receipt = await waitForReceipt(tx.hash);

  console.info('[CCTP-MINT] relay.confirmed', JSON.stringify({
    txHash: tx.hash,
    blockNumber: parseInt(receipt.blockNumber, 16),
    gasUsed: parseInt(receipt.gasUsed, 16),
  }));

  return tx.hash;
}
