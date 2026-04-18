/**
 * Browser AuthZ grant flow.
 * Generates an ephemeral key, signs MsgGrant via MetaMask EIP-712, sends
 * the ephemeral private key to the server for session-based trading.
 *
 * Adapted from agentic-trading/src/client/lib/autosign.ts.
 */

import {
  PrivateKey,
  MsgGrant,
  getGenericAuthorizationFromMessageType,
  getEip712TypedData,
  createTxRawEIP712,
  createWeb3Extension,
  createTransaction,
  SIGN_AMINO,
  TxGrpcApi,
  ChainRestAuthApi,
} from '@injectivelabs/sdk-ts';
import { getNetworkEndpoints, getNetworkChainInfo, Network } from '@injectivelabs/networks';
import { ethers } from 'ethers';

const NETWORK = Network.MainnetSentry;
const endpoints = getNetworkEndpoints(NETWORK);
const chainInfo = getNetworkChainInfo(NETWORK);

const authApi = new ChainRestAuthApi(endpoints.rest);
const txApi = new TxGrpcApi(endpoints.grpc);

const GRANT_MSG_TYPES = [
  '/injective.exchange.v1beta1.MsgCreateDerivativeMarketOrder',
  '/injective.exchange.v1beta1.MsgCreateDerivativeLimitOrder',
  '/injective.exchange.v1beta1.MsgCancelDerivativeOrder',
  '/injective.exchange.v1beta1.MsgBatchUpdateOrders',
  '/injective.exchange.v1beta1.MsgIncreasePositionMargin',
];

const GRANT_DURATION_S = 60 * 60 * 24 * 3; // 3 days

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Account isn't on chain yet → derive its compressed pubkey from a personal_sign.
async function recoverPubKeyFromWallet(ethAddress) {
  const msg = `Injective account verification: ${ethAddress}`;
  const sig = await window.ethereum.request({
    method: 'personal_sign',
    params: [msg, ethAddress],
  });
  const msgHash = ethers.hashMessage(msg);
  const uncompressed = ethers.SigningKey.recoverPublicKey(msgHash, sig);
  const compressed = ethers.SigningKey.computePublicKey(uncompressed, true);
  const bytes = ethers.getBytes(compressed);
  return btoa(String.fromCharCode(...bytes));
}

export async function grantAuthZ(injAddress, onProgress) {
  onProgress?.('Generating ephemeral signing key...');

  const { privateKey: privKey } = PrivateKey.generate();
  const ephemeralAddress = privKey.toBech32();

  onProgress?.('Confirm the AuthZ grant in your wallet (one-time)...');

  const [acct, blockRes] = await Promise.all([
    authApi.fetchAccount(injAddress),
    fetch(`${endpoints.rest}/cosmos/base/tendermint/v1beta1/blocks/latest?_=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()),
  ]);
  const base = acct.account.base_account;
  const accountNumber = parseInt(base.account_number, 10);
  const sequence = parseInt(base.sequence, 10);
  const pubKey = base.pub_key?.key ?? '';
  const latestHeight = parseInt(blockRes.block?.header?.height ?? '0', 10);
  const timeoutHeight = latestHeight + 200;

  if (!window.ethereum) throw new Error('No wallet detected');

  const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
  if (parseInt(currentChain, 16) !== 1776) {
    onProgress?.('Switching to Injective network...');
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x6f0' }],
      });
    } catch {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x6f0',
            chainName: 'Injective',
            nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
            rpcUrls: ['https://sentry.evm-rpc.injective.network/'],
            blockExplorerUrls: ['https://blockscout.injective.network'],
          }],
        });
      } catch {
        // Some wallets reject the add but actually switch — verify below.
      }
    }
    const recheck = await window.ethereum.request({ method: 'eth_chainId' });
    if (parseInt(recheck, 16) !== 1776) {
      throw new Error('Please switch to Injective (chain ID 1776) in your wallet');
    }
  }

  // evmChainId must come from MetaMask at sign-time, not be hardcoded.
  const evmChainId = parseInt(
    await window.ethereum.request({ method: 'eth_chainId' }), 16
  );

  const expiration = Math.floor(Date.now() / 1000) + GRANT_DURATION_S;

  const msgGrants = GRANT_MSG_TYPES.map(msgType =>
    MsgGrant.fromJSON({
      grantee: ephemeralAddress,
      granter: injAddress,
      authorization: getGenericAuthorizationFromMessageType(msgType),
      expiration,
    })
  );

  const typedData = getEip712TypedData({
    msgs: msgGrants,
    tx: {
      accountNumber: accountNumber.toString(),
      sequence: sequence.toString(),
      timeoutHeight: timeoutHeight.toString(),
      chainId: chainInfo.chainId,
      memo: 'Enable Bet autosign',
    },
    evmChainId,
  });

  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const from = accounts[0];

  let resolvedPubKey = pubKey;
  if (!resolvedPubKey) {
    onProgress?.('Verifying wallet public key...');
    resolvedPubKey = await recoverPubKeyFromWallet(from);
  }

  const sig = await window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [from, JSON.stringify(typedData)],
  });
  const sigBytes = hexToBytes(sig.replace('0x', ''));

  const { txRaw } = createTransaction({
    message: msgGrants,
    memo: 'Enable Bet autosign',
    pubKey: resolvedPubKey,
    sequence,
    accountNumber,
    chainId: chainInfo.chainId,
    timeoutHeight,
    signMode: SIGN_AMINO,
  });

  const web3Extension = createWeb3Extension({ evmChainId });
  const txRawEip712 = createTxRawEIP712(txRaw, web3Extension);
  txRawEip712.signatures = [sigBytes];

  onProgress?.('Broadcasting AuthZ grant...');
  const response = await txApi.broadcast(txRawEip712);
  if (response.code !== 0) {
    throw new Error(`AuthZ grant failed (code ${response.code}): ${response.rawLog}`);
  }

  onProgress?.('Authorization granted.');

  return {
    privateKeyHex: privKey.toPrivateKeyHex(),
    injectiveAddress: ephemeralAddress,
    expiration,
    evmChainId,
  };
}
