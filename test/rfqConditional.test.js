import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEthereumAddress } from '@injectivelabs/sdk-ts';
import {
  buildSignedTakerIntentTypedData,
  buildTpSlConditionalOrder,
  fetchTakerIntentState,
} from '../src/services/rfqConditional.js';
import {
  RFQ_CONTRACT_ADDRESS,
  RFQ_EVM_CHAIN_ID,
  RFQ_TPSL_NONCE_WINDOW_MS,
  RFQ_TPSL_SIGNED_INTENT_VERSION,
  RFQ_TPSL_SUBACCOUNT_NONCE,
  RFQ_TPSL_TRIGGER,
} from '../src/services/rfqConstants.js';

const market = {
  marketId: '0xmarket',
  minPriceTickSize: '10000',
  minQuantityTickSize: '0.001',
};

test('buildTpSlConditionalOrder builds a long take-profit signed intent body', () => {
  const order = buildTpSlConditionalOrder({
    market,
    side: 'long',
    quantity: '5.4321',
    triggerPrice: '110.0000',
    kind: 'take_profit',
    slippage: 0.005,
    rfqId: 123,
  });

  assert.deepEqual(order, {
    rfqId: 123,
    margin: '0',
    marketId: market.marketId,
    quantity: '5.432',
    direction: 'short',
    worstPrice: '109.45',
    triggerPrice: '110',
    triggerType: RFQ_TPSL_TRIGGER.MARK_PRICE_GTE,
    minTotalFillQuantity: '0.543',
  });
});

test('buildTpSlConditionalOrder builds a short take-profit signed intent body', () => {
  const order = buildTpSlConditionalOrder({
    market,
    side: 'short',
    quantity: '5.4321',
    triggerPrice: '90.0000',
    kind: 'take_profit',
    slippage: 0.005,
    rfqId: 124,
  });

  assert.equal(order.direction, 'long');
  assert.equal(order.triggerType, RFQ_TPSL_TRIGGER.MARK_PRICE_LTE);
  assert.equal(order.triggerPrice, '90');
  assert.equal(order.worstPrice, '90.45');
  assert.equal(order.margin, '0');
});

test('buildSignedTakerIntentTypedData matches RFQ conditional order EIP-712 shape', () => {
  const typedData = buildSignedTakerIntentTypedData({
    cid: 'cid-1',
    rfqId: 123,
    epoch: 4,
    margin: '0',
    version: RFQ_TPSL_SIGNED_INTENT_VERSION,
    quantity: '5',
    marketId: market.marketId,
    direction: 'short',
    worstPrice: '109.45',
    deadlineMs: 1770000000000,
    laneVersion: 7,
    triggerPrice: '110',
    allowedRelayer: '',
    takerEthAddress: '0x1111111111111111111111111111111111111111',
    subaccountNonce: RFQ_TPSL_SUBACCOUNT_NONCE,
    triggerType: RFQ_TPSL_TRIGGER.MARK_PRICE_GTE,
    minTotalFillQuantity: '0.5',
    takerNonceTimeWindowMs: RFQ_TPSL_NONCE_WINDOW_MS,
  });

  assert.equal(typedData.primaryType, 'SignedTakerIntent');
  assert.equal(typedData.domain.name, 'RFQ');
  assert.equal(typedData.domain.chainId, RFQ_EVM_CHAIN_ID);
  assert.equal(typedData.domain.verifyingContract, getEthereumAddress(RFQ_CONTRACT_ADDRESS));
  assert.equal(typedData.message.direction, 1);
  assert.equal(typedData.message.triggerKind, 1);
  assert.equal(typedData.message.allowedRelayer, '0x0000000000000000000000000000000000000000');
  assert.equal(typedData.message.epoch, '4');
  assert.equal(typedData.message.laneVersion, '7');
});

test('fetchTakerIntentState parses contract lane counters', async () => {
  const state = await fetchTakerIntentState({
    taker: 'inj1taker',
    marketId: market.marketId,
    wasmApiClient: {
      async fetchSmartContractState(contract, query) {
        assert.equal(contract, RFQ_CONTRACT_ADDRESS);
        assert.deepEqual(query.taker_intent_state, {
          taker: 'inj1taker',
          market_id: market.marketId,
          subaccount_nonce: RFQ_TPSL_SUBACCOUNT_NONCE,
        });
        return {
          data: new TextEncoder().encode(JSON.stringify({
            epoch: '4',
            lane_version: '7',
          })),
        };
      },
    },
  });

  assert.deepEqual(state, { epoch: 4, laneVersion: 7 });
});
