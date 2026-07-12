/**
 * MetaMask / Rabby wallet bridge for Injective.
 *
 * Derives Injective bech32 address + subaccount ID from the Ethereum address.
 * Uses EIP-712 signing pattern (no private key extraction needed).
 */

import { Address } from '@injectivelabs/sdk-ts';

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

function getInjAddress(ethAddress) {
  return Address.fromHex(ethAddress).toBech32();
}

function getSubaccountId(ethAddress) {
  return Address.fromHex(ethAddress).getSubaccountId(0);
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
