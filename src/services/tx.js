/**
 * EIP-712 transaction signing via MetaMask + Injective broadcast.
 * Adapted from easyperps tx.ts.
 */

import {
  MsgCreateDerivativeMarketOrder,
  OrderTypeMap,
  Address,
  getEip712TypedDataV2,
  createTxRawEIP712,
  createWeb3Extension,
  createTransaction,
  SIGN_EIP712_V2,
  TxGrpcApi,
  ChainRestAuthApi,
  ChainRestTendermintApi,
  IndexerGrpcOracleApi,
} from '@injectivelabs/sdk-ts';
import { getNetworkEndpoints, getNetworkChainInfo, Network } from '@injectivelabs/networks';
import Decimal from 'decimal.js';

// Version tag — if you see this in console, the new code is loaded
console.log('[tx.js] v9 — fixed closeTrade quantize functions');

const NETWORK = Network.MainnetSentry;
const endpoints = getNetworkEndpoints(NETWORK);
const chainInfo = getNetworkChainInfo(NETWORK);

const authApi = new ChainRestAuthApi(endpoints.rest);
const tendermintApi = new ChainRestTendermintApi(endpoints.rest);
const txApi = new TxGrpcApi(endpoints.grpc);
const oracleApi = new IndexerGrpcOracleApi(endpoints.indexer);

const TIMEOUT_BLOCKS = 200; // ~3-4 min window for MetaMask confirmation

// ─── Helpers ─────────────────────────────────────────────────────────────────
// fromJSON expects CHAIN-SCALED values — matching the MCP server approach:
//   price  = humanPrice × 10^6, quantized to chain tick size, integer string
//   margin = humanMargin × 10^6, integer string
//   qty    = humanQty quantized to qty tick size (NOT ×10^6)

const QUOTE_SCALE = new Decimal(10).pow(6); // 10^6 for USDT quote decimals

/** Scale human price → chain units (×10^6), quantize to chain tick, return integer string */
function toChainPrice(humanPrice, chainTickSize) {
  const chainPrice = humanPrice.mul(QUOTE_SCALE);
  const tick = new Decimal(chainTickSize);
  const quantized = chainPrice.div(tick).floor().mul(tick);
  return quantized.toFixed(0, Decimal.ROUND_DOWN);
}

/** Quantize human qty to tick, return string with up to 18 decimals */
function toChainQty(humanQty, minQuantityTickSize) {
  const tick = new Decimal(minQuantityTickSize);
  const quantized = humanQty.div(tick).floor().mul(tick);
  return quantized.toFixed(18).replace(/\.?0+$/, '') || '0';
}

/** Scale human USDT margin → chain base units (×10^6), return integer string */
function toChainMargin(humanMargin) {
  return humanMargin.mul(QUOTE_SCALE).toFixed(0, Decimal.ROUND_DOWN);
}

async function getAccountDetails(injAddress) {
  const account = await authApi.fetchAccount(injAddress);
  const base = account.account.base_account;
  return {
    accountNumber: parseInt(base.account_number, 10),
    sequence: parseInt(base.sequence, 10),
    pubKey: base.pub_key?.key || '',
  };
}

async function getTimeoutHeight() {
  const block = await tendermintApi.fetchLatestBlock();
  return parseInt(block.header.height, 10) + TIMEOUT_BLOCKS;
}

async function signEip712(typedData) {
  if (!window.ethereum) throw new Error('Wallet not available');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const from = accounts[0];

  const sig = await window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [from, JSON.stringify(typedData)],
  });

  return sig;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function emptyPubkey() {
  return btoa(String.fromCharCode(...new Uint8Array(33)));
}

// ─── Build + broadcast helper ────────────────────────────────────────────────

async function buildSignBroadcast(msg, memo, injAddress, ethAddress) {
  const [acct, timeoutHeight] = await Promise.all([
    getAccountDetails(injAddress),
    getTimeoutHeight(),
  ]);

  // Read MetaMask's current chain ID — passed through to EIP-712 domain + Web3Extension.
  // No chain switching needed; Injective EIP-712 works from any network.
  const evmChainId = parseInt(
    await window.ethereum.request({ method: 'eth_chainId' }), 16
  );

  const fee = { amount: [{ denom: 'inj', amount: '200000000000000' }], gas: '1000000' };

  const typedData = getEip712TypedDataV2({
    msgs: msg,
    tx: {
      accountNumber: acct.accountNumber.toString(),
      sequence: acct.sequence.toString(),
      timeoutHeight: timeoutHeight.toString(),
      chainId: chainInfo.chainId,
      memo,
    },
    fee,
    evmChainId,
  });

  const sig = await signEip712(typedData);
  const sigBytes = hexToBytes(sig.replace('0x', ''));

  const { txRaw } = createTransaction({
    message: msg,
    memo,
    pubKey: acct.pubKey || emptyPubkey(),
    sequence: acct.sequence,
    accountNumber: acct.accountNumber,
    chainId: chainInfo.chainId,
    timeoutHeight,
    signMode: SIGN_EIP712_V2,
    fee,
  });

  const web3Extension = createWeb3Extension({ evmChainId });
  const txRawEip712 = createTxRawEIP712(txRaw, web3Extension);
  txRawEip712.signatures = [sigBytes];

  const response = await txApi.broadcast(txRawEip712);
  if (response.code !== 0) {
    throw new Error(`Tx failed (code ${response.code}): ${response.rawLog}`);
  }

  return { txHash: response.txHash };
}

// ─── Open trade ───────────────────────────────────────────────────────────────

export async function openTrade({
  injAddress,
  ethAddress,
  market,
  side,         // 'long' or 'short'
  stakeUsdt,    // margin in USDT
  leverage,     // e.g. 5, 15, 30
  slippage = 0.01,
}) {
  const subaccountId = Address.fromHex(ethAddress).getSubaccountId(0);

  const stake = new Decimal(stakeUsdt);
  const leverageDec = new Decimal(leverage);
  const isBuy = side === 'long';

  // Fetch oracle price for accurate pricing
  const oraclePriceRes = await oracleApi.fetchOraclePrice({
    baseSymbol: market.oracleBase,
    quoteSymbol: market.oracleQuote,
    oracleType: market.oracleType,
  }).catch(() => null);

  const oraclePrice = oraclePriceRes?.price
    ? new Decimal(oraclePriceRes.price)
    : null;

  if (!oraclePrice) throw new Error('Could not fetch oracle price');

  const slippageMul = isBuy
    ? new Decimal(1).plus(slippage)
    : new Decimal(1).minus(slippage);
  const priceWithSlippage = oraclePrice.mul(slippageMul);

  // Qty = stake * leverage / oraclePrice
  const humanQty = stake.mul(leverageDec).div(oraclePrice);
  if (humanQty.lte(0)) throw new Error('Computed quantity is zero');

  // Margin must satisfy:
  // 1. User's stake (the margin they want to risk)
  // 2. Chain mark price threshold: margin >= qty * (price*(1+IMR) - markPrice)
  //    Using oracle as proxy for mark price. 10% buffer for safety.
  const IMR = new Decimal(market.initialMarginRatio || '0.033333');
  const markSafeMargin = humanQty.mul(
    priceWithSlippage.mul(IMR.plus(1)).minus(oraclePrice)
  );
  // At low leverage, stake dominates. At high leverage, markSafe kicks in.
  const humanMargin = Decimal.max(stake, markSafeMargin).mul(new Decimal('1.05'));

  // Convert to chain format — matching MCP server approach
  const chainPrice = toChainPrice(priceWithSlippage, market.minPriceTickSize);
  const chainQty = toChainQty(humanQty, market.minQuantityTickSize);
  const chainMargin = toChainMargin(humanMargin);

  if (chainQty === '0') throw new Error('Quantity rounds to zero — try a larger size');

  console.log('[tx.js] openTrade DEBUG v8 — chain-scaled values for fromJSON', {
    stakeUsdt, leverage, side,
    oraclePrice: oraclePrice.toFixed(),
    priceWithSlippage: priceWithSlippage.toFixed(),
    humanQty: humanQty.toFixed(), humanMargin: humanMargin.toFixed(),
    chainPrice, chainQty, chainMargin,
    minPriceTickSize: market.minPriceTickSize,
    minQuantityTickSize: market.minQuantityTickSize,
  });

  const msg = MsgCreateDerivativeMarketOrder.fromJSON({
    marketId: market.marketId,
    subaccountId,
    injectiveAddress: injAddress,
    orderType: isBuy ? OrderTypeMap.BUY : OrderTypeMap.SELL,
    price: chainPrice,
    margin: chainMargin,
    quantity: chainQty,
    feeRecipient: injAddress,
  });

  return buildSignBroadcast(msg, `open ${side} ${market.symbol}`, injAddress, ethAddress);
}

// ─── Close trade ──────────────────────────────────────────────────────────────

export async function closeTrade({
  injAddress,
  ethAddress,
  market,
  side,       // existing position side ('long' or 'short')
  quantity,   // position quantity string
}) {
  const subaccountId = Address.fromHex(ethAddress).getSubaccountId(0);

  const isClosingLong = side === 'long';
  const closeOrderType = isClosingLong ? OrderTypeMap.SELL : OrderTypeMap.BUY;

  const oraclePriceRes = await oracleApi.fetchOraclePrice({
    baseSymbol: market.oracleBase,
    quoteSymbol: market.oracleQuote,
    oracleType: market.oracleType,
  }).catch(() => null);

  const oraclePrice = oraclePriceRes?.price
    ? new Decimal(oraclePriceRes.price)
    : null;

  if (!oraclePrice) throw new Error('Could not fetch oracle price');

  // For closing: use worst-case price that's still safe.
  // Closing long = sell → set price low (worst fill price).
  // Closing short = buy → set price high (worst fill price).
  // Use 1% slippage to avoid hitting bankruptcy price.
  const CLOSE_SLIPPAGE = 0.01;
  const slippageMul = isClosingLong
    ? new Decimal(1).minus(CLOSE_SLIPPAGE)
    : new Decimal(1).plus(CLOSE_SLIPPAGE);
  const priceWithSlippage = oraclePrice.mul(slippageMul);

  const qty = new Decimal(quantity);
  const chainPrice = toChainPrice(priceWithSlippage, market.minPriceTickSize);
  const chainQty = toChainQty(qty, market.minQuantityTickSize);

  console.log('[tx.js] closeTrade DEBUG', { side, chainPrice, chainQty, oraclePrice: oraclePrice.toFixed() });

  const msg = MsgCreateDerivativeMarketOrder.fromJSON({
    marketId: market.marketId,
    subaccountId,
    injectiveAddress: injAddress,
    orderType: closeOrderType,
    price: chainPrice,
    margin: '0',
    quantity: chainQty,
    feeRecipient: injAddress,
  });

  return buildSignBroadcast(msg, `close ${market.symbol}`, injAddress, ethAddress);
}
