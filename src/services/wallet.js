/**
 * MetaMask / Rabby wallet bridge for Injective.
 *
 * Derives Injective bech32 address + subaccount ID from the Ethereum address.
 * Uses EIP-712 signing pattern (no private key extraction needed).
 */

import { Address } from '@injectivelabs/sdk-ts';

export function isWalletAvailable() {
  return typeof window !== 'undefined' && !!window.ethereum;
}

export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error('No wallet detected. Please install MetaMask or Rabby.');
  }

  const accounts = await window.ethereum.request({
    method: 'eth_requestAccounts',
  });

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned from wallet.');
  }

  const ethAddress = accounts[0];
  const injAddress = getInjAddress(ethAddress);
  const subaccountId = getSubaccountId(ethAddress);

  return { ethAddress, injAddress, subaccountId };
}

export function getInjAddress(ethAddress) {
  return Address.fromHex(ethAddress).toBech32();
}

export function getSubaccountId(ethAddress) {
  return Address.fromHex(ethAddress).getSubaccountId(0);
}

/**
 * Try to switch wallet to Injective EVM chain (2525 / 0x9dd).
 * Auto-adds the chain if missing. Non-blocking — EIP-712 signing works from any chain.
 */
export async function ensureInjectiveChain() {
  if (!window.ethereum) return;
  const chainHex = '0x6f0'; // 1776

  const current = await window.ethereum.request({ method: 'eth_chainId' });
  if (parseInt(current, 16) === 1776) return;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainHex }],
    });
  } catch (err) {
    if (err.code === 4902) {
      // Chain not in wallet — add it
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chainHex,
            chainName: 'Injective EVM Mainnet',
            nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
            rpcUrls: ['https://sentry.evm-rpc.injective.network/'],
            blockExplorerUrls: ['https://blockscout.injective.network/'],
          }],
        });
      } catch (addErr) {
        // User rejected adding chain — not fatal, EIP-712 works from any chain
        console.warn('Could not add Injective EVM chain:', addErr.message);
      }
    } else if (err.code !== 4001) {
      // Unknown error — log but don't block
      console.warn('Chain switch failed:', err.message);
    }
  }
}

export function onAccountsChanged(cb) {
  if (!window.ethereum) return () => {};

  const handler = (accounts) => {
    if (!accounts || accounts.length === 0) {
      cb(null);
    } else {
      cb({
        ethAddress: accounts[0],
        injAddress: getInjAddress(accounts[0]),
        subaccountId: getSubaccountId(accounts[0]),
      });
    }
  };

  window.ethereum.on('accountsChanged', handler);
  return () => window.ethereum.removeListener('accountsChanged', handler);
}
