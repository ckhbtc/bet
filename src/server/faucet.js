/**
 * Account initialization faucet — sends 0.001 INJ via EVM to fresh
 * Injective wallets so they can pay gas for their first AuthZ grant.
 * Mirrors agentic-trading/src/server/faucet.ts.
 */

import { ethers } from 'ethers';
import { Address } from '@injectivelabs/sdk-ts';

const FAUCET_PRIVATE_KEY = process.env.FAUCET_PRIVATE_KEY ?? '';
const INJ_EVM_RPC = 'https://sentry.evm-rpc.injective.network/';
const MIN_BALANCE = ethers.parseEther('0.001');

const _recentInits = new Map();
const INIT_COOLDOWN_MS = 60_000;

export async function initAccount(wallet) {
  if (!FAUCET_PRIVATE_KEY) throw new Error('Faucet not configured');
  const lastInit = _recentInits.get(wallet) ?? 0;
  if (Date.now() - lastInit < INIT_COOLDOWN_MS) throw new Error('Please wait before retrying');

  const ethAddress = Address.fromBech32(wallet).toHex();
  const provider = new ethers.JsonRpcProvider(INJ_EVM_RPC);
  const faucetWallet = new ethers.Wallet(FAUCET_PRIVATE_KEY, provider);

  const balance = await provider.getBalance(ethAddress);
  if (balance >= MIN_BALANCE) {
    _recentInits.set(wallet, Date.now());
    return 'already_funded';
  }

  const topUp = MIN_BALANCE - balance;
  const tx = await faucetWallet.sendTransaction({
    to: ethAddress,
    value: topUp,
    type: 0,
    gasLimit: 21000,
    gasPrice: ethers.parseUnits('500', 'gwei'),
  });

  // Don't wait for receipt — Injective EVM RPC can be flaky on getTransactionReceipt.
  // Client waits ~5s before retrying the AuthZ grant, which is long enough for inclusion.
  _recentInits.set(wallet, Date.now());
  return tx.hash;
}
