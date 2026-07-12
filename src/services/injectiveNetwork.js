import { Network } from '@injectivelabs/networks';

export const INJECTIVE_NETWORK = Network.MainnetSentry;
export const INJECTIVE_CHAIN_ID = 'injective-1';
export const INJECTIVE_EVM_CHAIN_ID = 1776;
const INJECTIVE_EVM_CHAIN_HEX = '0x6f0';
export const INJECTIVE_EVM_RPC_URL = 'https://sentry.evm-rpc.injective.network/';
export const INJECTIVE_EVM_EXPLORER_URL = 'https://blockscout.injective.network/';
export const INJECTIVE_USDC_ADDRESS = '0xa00C59fF5a080D2b954d0c75e46E22a0c371235a';
export const INJECTIVE_USDC_DENOM = `erc20:${INJECTIVE_USDC_ADDRESS.toLowerCase()}`;

export const INJECTIVE_EVM_WALLET_CHAIN = {
  chainId: INJECTIVE_EVM_CHAIN_HEX,
  chainName: 'Injective',
  nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
  rpcUrls: [INJECTIVE_EVM_RPC_URL],
  blockExplorerUrls: [INJECTIVE_EVM_EXPLORER_URL],
};
