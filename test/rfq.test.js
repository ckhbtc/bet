import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CosmosTxV1Beta1TxPb,
  PrivateKey,
  base64ToUint8Array,
  uint8ArrayToBase64,
} from '@injectivelabs/sdk-ts';
import { MsgExec as AuthzMsgExecPb } from '@injectivelabs/core-proto-ts-v2/generated/cosmos/authz/v1beta1/tx_pb.js';
import { MsgExecuteContractCompat as WasmxMsgExecuteContractCompatPb } from '@injectivelabs/core-proto-ts-v2/generated/injective/wasmx/v1/tx_pb.js';
import {
  assertPreparedQuoteFreshness,
  broadcastSignedRfqTxRaw,
  buildAcceptQuoteMessage,
  buildRfqCloseInput,
  buildRfqGatewayPrepareRequest,
  buildRfqQuoteResult,
  buildRfqOrderInput,
  getRfqQuoteRejectReason,
  getPreparedQuoteExpiryReport,
  getPreparedTxSignatureIndexes,
  normalizeRfqQuoteForContract,
  requestRfqQuotes,
  selectRfqQuotesForAccept,
  signPreparedAutoSignTxRaw,
  signatureHexToBytes,
  signatureHexToBase64,
} from '../src/services/rfq.js';
import {
  formatLeverage,
  leverageOptionsForMarket,
  leveragePresetRowForMax,
  marketMaxLeverage,
  maxOpenLeverage,
  requiredOpenMargin,
  steppedMaxOpenLeverage,
  steppedMarketMaxLeverage,
} from '../src/services/leverageLimits.js';
import {
  RFQ_CHAIN_ID,
  RFQ_CONTRACT_ADDRESS,
  RFQ_EVM_CHAIN_ID,
  RFQ_GRPC_WEB_URL,
  RFQ_COLLECT_QUOTES_MS,
  RFQ_MIN_QUOTE_TTL_MS,
} from '../src/services/rfqConstants.js';

const market = {
  marketId: '0xmarket',
  minPriceTickSize: '10000',
  minQuantityTickSize: '0.001',
};

const futureExpiryMs = Date.now() + 60_000;

function quote(overrides = {}) {
  return {
    chainId: RFQ_CHAIN_ID,
    contractAddress: RFQ_CONTRACT_ADDRESS,
    marketId: market.marketId,
    rfqId: 12,
    takerDirection: 'long',
    margin: '50.0000',
    quantity: '5.000',
    price: '100.00',
    expiry: { timestamp: futureExpiryMs, height: 0 },
    maker: 'inj1maker',
    taker: 'inj1taker',
    signature: '0x1234',
    signMode: 'v2',
    evmChainId: RFQ_EVM_CHAIN_ID,
    makerSubaccountNonce: 0,
    minFillQuantity: '',
    ...overrides,
  };
}

function preparedTxWithQuotes(quotes) {
  const acceptMsg = buildAcceptQuoteMessage({
    sender: 'inj1sender',
    rfqId: 12,
    marketId: market.marketId,
    direction: 'long',
    margin: '50',
    quantity: '5',
    worstPrice: '101',
    quotes,
  });
  const executeAny = {
    typeUrl: '/injective.wasmx.v1.MsgExecuteContractCompat',
    value: WasmxMsgExecuteContractCompatPb.toBinary(acceptMsg.toProto()),
  };
  const exec = AuthzMsgExecPb.create({
    grantee: 'inj1grantee',
    msgs: [executeAny],
  });
  const body = CosmosTxV1Beta1TxPb.TxBody.create({
    messages: [{
      typeUrl: '/cosmos.authz.v1beta1.MsgExec',
      value: AuthzMsgExecPb.toBinary(exec),
    }],
  });
  const txRaw = CosmosTxV1Beta1TxPb.TxRaw.create({
    bodyBytes: CosmosTxV1Beta1TxPb.TxBody.toBinary(body),
    authInfoBytes: new Uint8Array(),
    signatures: [],
  });
  return CosmosTxV1Beta1TxPb.TxRaw.toBinary(txRaw);
}

test('buildRfqOrderInput formats human RFQ decimals from market ticks', () => {
  const input = buildRfqOrderInput({
    market,
    oraclePrice: '100',
    side: 'long',
    stakeUsdt: '50',
    leverage: '10',
    slippage: 0.01,
  });

  assert.deepEqual(input, {
    direction: 'long',
    margin: '50',
    quantity: '5',
    worstPrice: '101',
  });
});

test('maxOpenLeverage includes RFQ slippage in the market margin cap', () => {
  assert.equal(formatLeverage(maxOpenLeverage('0.083333', 0.01)), '10.6');
});

test('steppedMaxOpenLeverage rounds the market cap down to a standard step', () => {
  assert.equal(steppedMaxOpenLeverage('0.083333', 0.01), 10);
});

test('steppedMarketMaxLeverage rounds the raw market max down to the nearest standard step', () => {
  assert.equal(formatLeverage(marketMaxLeverage('0.019230769')), '52');
  assert.equal(steppedMarketMaxLeverage('0.019230769'), 50);
});

test('leverageOptionsForMarket uses the standard preset row for the safe max step', () => {
  const options = leverageOptionsForMarket('0.083333', 0.01);

  assert.deepEqual(
    options.map(option => [option.key, option.leverage, option.allowed]),
    [
      ['LOW', 2, true],
      ['MEDIUM', 3, true],
      ['HIGH', 5, true],
      ['MAX', 10, true],
    ]
  );
});

test('leverageOptionsForMarket keeps Mad Max at the stepped market max', () => {
  const options = leverageOptionsForMarket('0.019230769', 0.01);

  assert.equal(options.find(option => option.key === 'MAX').leverage, 50);
});

test('leveragePresetRowForMax matches the standard leverage table', () => {
  assert.deepEqual(
    [5, 10, 25, 50, 100].map(max => [
      max,
      Object.values(leveragePresetRowForMax(max).levels),
    ]),
    [
      [5, [1, 2, 3, 5]],
      [10, [2, 3, 5, 10]],
      [25, [2, 5, 10, 25]],
      [50, [5, 10, 25, 50]],
      [100, [10, 25, 50, 100]],
    ]
  );
});

test('RFQ conditional orders use the public RFQ grpc-web host', () => {
  assert.equal(new URL(RFQ_GRPC_WEB_URL).host, 'rfq.grpc-web.injective.network');
  assert.doesNotMatch(RFQ_GRPC_WEB_URL, /sentry\.exchange/);
});

test('buildRfqOrderInput rejects leverage above the market margin cap', () => {
  assert.throws(() => buildRfqOrderInput({
    market: { ...market, symbol: 'DOT', initialMarginRatio: '0.083333' },
    oraclePrice: '100',
    side: 'long',
    stakeUsdt: '50',
    leverage: '25',
    slippage: 0.01,
  }), /Selected aggressiveness is too high for DOT/);
});

test('buildRfqOrderInput rejects unsnapped raw market max leverage', () => {
  assert.throws(() => buildRfqOrderInput({
    market: { ...market, symbol: 'BTC', initialMarginRatio: '0.019230769' },
    oraclePrice: '100',
    side: 'long',
    stakeUsdt: '50',
    leverage: '52',
    slippage: 0,
  }), /Selected aggressiveness is too high for BTC/);
});

test('buildRfqOrderInput allows leverage within the market margin cap', () => {
  const input = buildRfqOrderInput({
    market: { ...market, symbol: 'DOT', initialMarginRatio: '0.083333' },
    oraclePrice: '100',
    side: 'long',
    stakeUsdt: '50',
    leverage: '10',
    slippage: 0.01,
  });

  assert.deepEqual(input, {
    direction: 'long',
    margin: '50',
    quantity: '5',
    worstPrice: '101',
  });
});

test('buildRfqOrderInput caps max-leverage quantity against worst price initial margin', () => {
  const ethLikeMarket = {
    ...market,
    symbol: 'ETH',
    initialMarginRatio: '0.02',
    minPriceTickSize: '10000',
    minQuantityTickSize: '0.0001',
  };

  const input = buildRfqOrderInput({
    market: ethLikeMarket,
    oraclePrice: '1584.8',
    side: 'long',
    stakeUsdt: '10',
    leverage: '50',
    slippage: 0.01,
  });

  assert.equal(input.direction, 'long');
  assert.equal(input.margin, '10');
  assert.equal(input.worstPrice, '1600.65');
  assert.equal(input.quantity, '0.3123');
  assert.ok(
    requiredOpenMargin({
      quantity: input.quantity,
      oraclePrice: '1584.8',
      worstPrice: input.worstPrice,
      initialMarginRatio: ethLikeMarket.initialMarginRatio,
      side: 'long',
      slippage: 0.01,
    }).lte(10)
  );
});

test('buildRfqOrderInput caps short max-leverage quantity above oracle for margin safety', () => {
  const ethLikeMarket = {
    ...market,
    symbol: 'ETH',
    initialMarginRatio: '0.02',
    minPriceTickSize: '10000',
    minQuantityTickSize: '0.0001',
  };

  const input = buildRfqOrderInput({
    market: ethLikeMarket,
    oraclePrice: '100',
    side: 'short',
    stakeUsdt: '10',
    leverage: '50',
    slippage: 0.01,
  });

  assert.equal(input.direction, 'short');
  assert.equal(input.margin, '10');
  assert.equal(input.worstPrice, '99');
  assert.equal(input.quantity, '4.9504');
  assert.ok(
    requiredOpenMargin({
      quantity: input.quantity,
      oraclePrice: '100',
      worstPrice: input.worstPrice,
      initialMarginRatio: ethLikeMarket.initialMarginRatio,
      side: 'short',
      slippage: 0.01,
    }).lte(10)
  );
});

test('buildRfqCloseInput closes longs with a zero-margin short RFQ', () => {
  const input = buildRfqCloseInput({
    market,
    oraclePrice: '100',
    side: 'long',
    quantity: '5.4321',
    slippage: 0.02,
  });

  assert.deepEqual(input, {
    direction: 'short',
    margin: '0',
    quantity: '5.432',
    worstPrice: '98',
  });
});

test('buildRfqCloseInput closes shorts with a zero-margin long RFQ', () => {
  const input = buildRfqCloseInput({
    market,
    oraclePrice: '100',
    side: 'short',
    quantity: '5.4321',
    slippage: 0.02,
  });

  assert.deepEqual(input, {
    direction: 'long',
    margin: '0',
    quantity: '5.432',
    worstPrice: '102',
  });
});

test('signatureHexToBase64 converts indexer hex signatures for the contract', () => {
  assert.equal(signatureHexToBase64('0x1234'), 'EjQ=');
});

test('buildRfqGatewayPrepareRequest matches the gateway autosign payload', () => {
  const privateKey = PrivateKey.fromHex('0x' + '01'.repeat(32));
  const request = buildRfqGatewayPrepareRequest({
    session: {
      privateKeyHex: privateKey.toPrivateKeyHex(),
      granterAddress: 'inj1taker',
      granteeAddress: privateKey.toBech32(),
    },
    marketId: market.marketId,
    input: {
      direction: 'long',
      margin: '50.0000',
      quantity: '5.000',
      worstPrice: '101.0000',
    },
    clientId: 'client-1',
    cid: 'cid-1',
    accountDetails: {
      baseAccount: {
        accountNumber: 10,
        sequence: 11,
      },
    },
  });

  assert.equal(request.clientId, 'client-1');
  assert.equal(request.cid, 'cid-1');
  assert.equal(request.margin, '50');
  assert.equal(request.quantity, '5');
  assert.equal(request.worstPrice, '101');
  assert.equal(request.takerAddress, 'inj1taker');
  assert.equal(request.autosignAddress, privateKey.toBech32());
  assert.match(request.autosignPubKey, /^[0-9a-f]+$/);
  assert.equal(request.autosignAccountNumber, 10);
  assert.equal(request.autosignAccountSequence, 11);
  assert.equal(request.quotesWaitTimeMs, RFQ_COLLECT_QUOTES_MS);
});

test('normalizeRfqQuoteForContract emits the accept_quote quote shape', () => {
  assert.deepEqual(normalizeRfqQuoteForContract(quote({
    makerSubaccountNonce: 7,
    minFillQuantity: '1.5000',
  })), {
    maker: 'inj1maker',
    margin: '50',
    price: '100',
    quantity: '5',
    expiry: { ts: futureExpiryMs },
    signature: 'EjQ=',
    sign_mode: 'v2',
    evm_chain_id: RFQ_EVM_CHAIN_ID,
    maker_subaccount_nonce: 7,
    min_fill_quantity: '1.5',
  });
});

test('getPreparedQuoteExpiryReport flags prepared RFQ quotes that are already expired', () => {
  const nowMs = 1_770_000_000_000;
  const prepared = {
    tx: preparedTxWithQuotes([
      quote({ expiry: { timestamp: nowMs - 250, height: 0 }, price: '100' }),
      quote({ expiry: { timestamp: nowMs + 7_000, height: 0 }, price: '100.1' }),
    ]),
  };

  const report = getPreparedQuoteExpiryReport(prepared, {
    nowMs,
    minTtlMs: RFQ_MIN_QUOTE_TTL_MS,
  });

  assert.equal(report.ok, false);
  assert.equal(report.inspected, true);
  assert.equal(report.quoteCount, 2);
  assert.equal(report.unsafeQuotes.length, 1);
  assert.equal(report.shortestTtlMs, -250);
  assert.throws(
    () => assertPreparedQuoteFreshness(prepared, { nowMs, minTtlMs: RFQ_MIN_QUOTE_TTL_MS }),
    /RFQ quotes expire too soon \(0ms left; need 0ms\)/
  );
});

test('getPreparedQuoteExpiryReport accepts prepared RFQ quotes with standard maker TTL', () => {
  const nowMs = 1_770_000_000_000;
  const prepared = {
    tx: preparedTxWithQuotes([
      quote({ expiry: { timestamp: nowMs + 1_000, height: 0 }, price: '100' }),
      quote({ expiry: { timestamp: nowMs + 7_000, height: 0 }, price: '100.1' }),
    ]),
  };

  const report = getPreparedQuoteExpiryReport(prepared, {
    nowMs,
    minTtlMs: RFQ_MIN_QUOTE_TTL_MS,
  });

  assert.equal(report.ok, true);
  assert.equal(report.quoteCount, 2);
  assert.equal(report.unsafeQuotes.length, 0);
  assert.doesNotThrow(
    () => assertPreparedQuoteFreshness(prepared, { nowMs, minTtlMs: RFQ_MIN_QUOTE_TTL_MS })
  );
});

test('broadcastSignedRfqTxRaw submits through the fastest path, then waits for confirmation', async () => {
  const calls = [];
  let directCalls = 0;
  const result = await broadcastSignedRfqTxRaw({
    txRaw: {},
    txApiClient: {
      fetchTxPoll: async (txHash) => {
        calls.push(['fetchTxPoll', txHash]);
        return { txHash: 'confirmed-hash' };
      },
      broadcast: () => new Promise((resolve) => {
        directCalls += 1;
        setTimeout(() => resolve({ txHash: 'direct-hash' }), 20);
      }),
    },
    relayBroadcast: async () => ({ txHash: 'relay-hash' }),
  });

  assert.equal(result.txHash, 'confirmed-hash');
  assert.deepEqual(calls, [['fetchTxPoll', 'relay-hash']]);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(directCalls, 0);
});

test('broadcastSignedRfqTxRaw uses direct onBroadcast ack when the relay is unavailable', async () => {
  const calls = [];
  const result = await broadcastSignedRfqTxRaw({
    txRaw: {},
    txApiClient: {
      fetchTxPoll: async (txHash) => {
        calls.push(['fetchTxPoll', txHash]);
        return { txHash };
      },
      broadcast: (_txRaw, options) => new Promise((resolve) => {
        options.onBroadcast('direct-ack-hash');
        setTimeout(() => resolve({ txHash: 'direct-final-hash' }), 20);
      }),
    },
    relayBroadcast: async () => {
      throw new Error('relay down');
    },
  });

  assert.equal(result.txHash, 'direct-ack-hash');
  assert.deepEqual(calls, [['fetchTxPoll', 'direct-ack-hash']]);
});

test('signPreparedAutoSignTxRaw signs the autosign slot and preserves fee payer sig', async () => {
  const privateKey = PrivateKey.fromHex('0x' + '02'.repeat(32));
  const autosignPubKey = base64ToUint8Array(privateKey.toPublicKey().toBase64());
  const feePayerPubKey = new Uint8Array([10, 3, 1, 2, 3]);
  const authInfo = CosmosTxV1Beta1TxPb.AuthInfo.create({
    signerInfos: [
      {
        publicKey: {
          typeUrl: '/injective.crypto.v1beta1.ethsecp256k1.PubKey',
          value: autosignPubKey,
        },
        sequence: 4n,
      },
      {
        publicKey: {
          typeUrl: '/injective.crypto.v1beta1.ethsecp256k1.PubKey',
          value: feePayerPubKey,
        },
        sequence: 5n,
      },
    ],
  });
  const txRaw = CosmosTxV1Beta1TxPb.TxRaw.create({
    bodyBytes: new Uint8Array([1, 2, 3]),
    authInfoBytes: CosmosTxV1Beta1TxPb.AuthInfo.toBinary(authInfo),
    signatures: [],
  });
  const feePayerSig = '0x' + 'ab'.repeat(64);

  const indexes = getPreparedTxSignatureIndexes(txRaw, {
    autosignPubKeyBase64: privateKey.toPublicKey().toBase64(),
    feePayerPubKeyBase64: uint8ArrayToBase64(feePayerPubKey),
  });
  assert.deepEqual(indexes, {
    autosignIndex: 0,
    feePayerIndex: 1,
    signerCount: 2,
  });

  const signedTxRaw = await signPreparedAutoSignTxRaw({
    tx: CosmosTxV1Beta1TxPb.TxRaw.toBinary(txRaw),
    feePayerSig,
    privateKeyHex: privateKey.toPrivateKeyHex(),
    accountNumber: 123,
    feePayerPubKey: {
      type: '/injective.crypto.v1beta1.ethsecp256k1.PubKey',
      key: uint8ArrayToBase64(feePayerPubKey),
    },
    chainId: RFQ_CHAIN_ID,
  });

  assert.equal(signedTxRaw.signatures.length, 2);
  assert.ok(signedTxRaw.signatures[0].length > 0);
  assert.deepEqual([...signedTxRaw.signatures[1]], [...signatureHexToBytes(feePayerSig)]);
});

test('signPreparedAutoSignTxRaw matches protobuf Any pubkeys when fee payer is first', async () => {
  const autosignKey = PrivateKey.fromHex('0x' + '03'.repeat(32));
  const feePayerKey = PrivateKey.fromHex('0x' + '04'.repeat(32));
  const authInfo = CosmosTxV1Beta1TxPb.AuthInfo.create({
    signerInfos: [
      {
        publicKey: feePayerKey.toPublicKey().toAny(),
        sequence: 8n,
      },
      {
        publicKey: autosignKey.toPublicKey().toAny(),
        sequence: 9n,
      },
    ],
  });
  const txRaw = CosmosTxV1Beta1TxPb.TxRaw.create({
    bodyBytes: new Uint8Array([4, 5, 6]),
    authInfoBytes: CosmosTxV1Beta1TxPb.AuthInfo.toBinary(authInfo),
    signatures: [],
  });
  const feePayerSig = '0x' + 'cd'.repeat(64);

  const indexes = getPreparedTxSignatureIndexes(txRaw, {
    autosignPubKeyBase64: autosignKey.toPublicKey().toBase64(),
    feePayerPubKeyBase64: feePayerKey.toPublicKey().toBase64(),
  });
  assert.deepEqual(indexes, {
    autosignIndex: 1,
    feePayerIndex: 0,
    signerCount: 2,
  });

  const signedTxRaw = await signPreparedAutoSignTxRaw({
    tx: CosmosTxV1Beta1TxPb.TxRaw.toBinary(txRaw),
    feePayerSig,
    privateKeyHex: autosignKey.toPrivateKeyHex(),
    accountNumber: 123,
    feePayerPubKey: {
      type: '/injective.crypto.v1beta1.ethsecp256k1.PubKey',
      key: feePayerKey.toPublicKey().toBase64(),
    },
    chainId: RFQ_CHAIN_ID,
  });

  assert.equal(signedTxRaw.signatures.length, 2);
  assert.deepEqual([...signedTxRaw.signatures[0]], [...signatureHexToBytes(feePayerSig)]);
  assert.ok(signedTxRaw.signatures[1].length > 0);
});

test('selectRfqQuotesForAccept filters wrong contract and sorts by best long price', () => {
  const selected = selectRfqQuotesForAccept([
    quote({ price: '100.5' }),
    quote({ price: '99.9', maker: 'inj1better' }),
    quote({ contractAddress: 'inj1wrong', price: '98' }),
    quote({ rfqId: 13, price: '97' }),
  ], {
    rfqId: 12,
    marketId: market.marketId,
    direction: 'long',
    worstPrice: '101',
  });

  assert.equal(selected.length, 2);
  assert.equal(selected[0].maker, 'inj1better');
  assert.equal(selected[1].price, '100.5');
});

test('buildRfqQuoteResult falls back to quote rfqId when ack rfqId is zero', () => {
  const result = buildRfqQuoteResult({
    clientId: 'client-1',
    ack: { rfqId: 0, status: 'success' },
    quotes: [quote({ rfqId: 1779753077339, clientId: '' })],
    marketId: market.marketId,
    direction: 'long',
    worstPrice: '101',
  });

  assert.equal(result.ackRfqId, 0);
  assert.equal(result.rfqId, 1779753077339);
  assert.equal(result.rawQuoteCount, 1);
  assert.equal(result.quotes.length, 1);
});

test('buildRfqQuoteResult falls back to quote rfqId when ack rfqId has no matching quote', () => {
  const result = buildRfqQuoteResult({
    clientId: 'client-1',
    ack: { rfqId: 44, status: 'success' },
    quotes: [quote({ rfqId: 1779753077339, clientId: '' })],
    marketId: market.marketId,
    direction: 'long',
    worstPrice: '101',
  });

  assert.equal(result.ackRfqId, 44);
  assert.equal(result.rfqId, 1779753077339);
  assert.equal(result.rawQuoteCount, 1);
  assert.equal(result.quotes.length, 1);
});

test('buildRfqQuoteResult can select quotes when ack never arrives', () => {
  const result = buildRfqQuoteResult({
    clientId: 'client-1',
    ack: null,
    quotes: [quote({ rfqId: 1779753077339, clientId: '' })],
    marketId: market.marketId,
    direction: 'long',
    worstPrice: '101',
  });

  assert.equal(result.ackRfqId, null);
  assert.equal(result.rfqId, 1779753077339);
  assert.equal(result.quotes.length, 1);
});

test('getRfqQuoteRejectReason explains price failures', () => {
  assert.equal(
    getRfqQuoteRejectReason(quote({ price: '102' }), {
      rfqId: 12,
      marketId: market.marketId,
      direction: 'long',
      worstPrice: '101',
    }),
    'price 102 outside worst 101 for long'
  );
});

test('requestRfqQuotes resolves when a quote arrives before request ack', async () => {
  class QuoteBeforeAckSocket {
    constructor({ onResponse }) {
      this.onResponse = onResponse;
      this.disconnected = false;
    }

    async connect() {}

    sendRequest() {
      setTimeout(() => {
        this.onResponse({
          messageType: 'quote',
          quote: {
            chainId: RFQ_CHAIN_ID,
            contractAddress: RFQ_CONTRACT_ADDRESS,
            marketId: market.marketId,
            rfqId: 1779753077339n,
            takerDirection: 'long',
            margin: '50',
            quantity: '5',
            price: '100',
            expiry: { timestamp: BigInt(futureExpiryMs), height: 0n },
            maker: 'inj1maker',
            taker: 'inj1taker',
            signature: '0x1234',
            status: 'pending',
            makerSubaccountNonce: 0,
            minFillQuantity: '',
            clientId: '',
            signMode: 'v2',
            evmChainId: BigInt(RFQ_EVM_CHAIN_ID),
          },
        });
      }, 0);
    }

    disconnect() {
      this.disconnected = true;
    }
  }

  const result = await requestRfqQuotes({
    requestAddress: 'inj1taker',
    marketId: market.marketId,
    direction: 'long',
    margin: '50',
    quantity: '5',
    worstPrice: '101',
    collectMs: 0,
    requestTimeoutMs: 20,
    socketFactory: (args) => new QuoteBeforeAckSocket(args),
  });

  assert.equal(result.ackRfqId, null);
  assert.equal(result.rfqId, 1779753077339);
  assert.equal(result.rawQuoteCount, 1);
  assert.equal(result.quotes.length, 1);
});

test('buildAcceptQuoteMessage builds MsgExecuteContractCompat for RFQ contract', () => {
  const message = buildAcceptQuoteMessage({
    sender: 'inj1sender',
    rfqId: 12,
    marketId: market.marketId,
    direction: 'long',
    margin: '50',
    quantity: '5',
    worstPrice: '101',
    quotes: [quote()],
    cid: 'cid-test',
  });

  const amino = message.toAmino();
  const contractMsg = JSON.parse(amino.value.msg);

  assert.equal(amino.type, 'wasmx/MsgExecuteContractCompat');
  assert.equal(amino.value.sender, 'inj1sender');
  assert.equal(amino.value.contract, RFQ_CONTRACT_ADDRESS);
  assert.equal(contractMsg.accept_quote.rfq_id, 12);
  assert.equal(contractMsg.accept_quote.quotes[0].signature, 'EjQ=');
  assert.equal(contractMsg.accept_quote.cid, 'cid-test');
});
