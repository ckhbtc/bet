import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHZ_MSG_TYPES,
  ORDERBOOK_AUTHZ_MSG_TYPES,
  RFQ_CONTRACT_AUTHZ_MSG_TYPES,
  GRANT_EXPIRATION_S,
  buildGrantMessages,
  buildRevokeMessages,
} from '../src/services/authzMessages.js';
import { RFQ_CONTRACT_ADDRESS } from '../src/services/rfqConstants.js';

test('buildGrantMessages scopes app and RFQ contract message types', () => {
  const messages = buildGrantMessages({
    granter: 'inj1granter',
    grantee: 'inj1grantee',
    expiration: GRANT_EXPIRATION_S,
  });

  assert.equal(messages.length, AUTHZ_MSG_TYPES.length + RFQ_CONTRACT_AUTHZ_MSG_TYPES.length);
  for (const [index, message] of messages.slice(0, AUTHZ_MSG_TYPES.length).entries()) {
    const amino = message.toAmino();
    assert.equal(amino.type, 'cosmos-sdk/MsgGrant');
    assert.equal(amino.value.granter, 'inj1granter');
    assert.equal(amino.value.grantee, 'inj1grantee');
    assert.equal(amino.value.grant.authorization.value.msg, AUTHZ_MSG_TYPES[index]);
  }

  for (const [index, message] of messages.slice(AUTHZ_MSG_TYPES.length).entries()) {
    const amino = message.toAmino();
    assert.equal(amino.type, 'cosmos-sdk/MsgGrant');
    assert.equal(amino.value.granter, 'inj1granter');
    assert.equal(amino.value.grantee, RFQ_CONTRACT_ADDRESS);
    assert.equal(amino.value.grant.authorization.value.msg, RFQ_CONTRACT_AUTHZ_MSG_TYPES[index]);
  }
});

test('buildGrantMessages can build the legacy orderbook-only scope', () => {
  const messages = buildGrantMessages({
    granter: 'inj1granter',
    grantee: 'inj1grantee',
    expiration: GRANT_EXPIRATION_S,
    includeRfq: false,
  });

  assert.equal(messages.length, ORDERBOOK_AUTHZ_MSG_TYPES.length);
  for (const [index, message] of messages.entries()) {
    const amino = message.toAmino();
    assert.equal(amino.value.grantee, 'inj1grantee');
    assert.equal(amino.value.grant.authorization.value.msg, ORDERBOOK_AUTHZ_MSG_TYPES[index]);
  }
});

test('buildRevokeMessages uses the SDK messageType field for each current grant', () => {
  const messages = buildRevokeMessages({
    granter: 'inj1granter',
    grantee: 'inj1grantee',
  });

  assert.equal(messages.length, AUTHZ_MSG_TYPES.length + RFQ_CONTRACT_AUTHZ_MSG_TYPES.length);
  for (const [index, message] of messages.slice(0, AUTHZ_MSG_TYPES.length).entries()) {
    const amino = message.toAmino();
    assert.equal(amino.type, 'cosmos-sdk/MsgRevoke');
    assert.equal(amino.value.granter, 'inj1granter');
    assert.equal(amino.value.grantee, 'inj1grantee');
    assert.equal(amino.value.msg_type_url, AUTHZ_MSG_TYPES[index]);
  }

  for (const [index, message] of messages.slice(AUTHZ_MSG_TYPES.length).entries()) {
    const amino = message.toAmino();
    assert.equal(amino.type, 'cosmos-sdk/MsgRevoke');
    assert.equal(amino.value.granter, 'inj1granter');
    assert.equal(amino.value.grantee, RFQ_CONTRACT_ADDRESS);
    assert.equal(amino.value.msg_type_url, RFQ_CONTRACT_AUTHZ_MSG_TYPES[index]);
  }
});

test('buildRevokeMessages can revoke the legacy orderbook-only scope', () => {
  const messages = buildRevokeMessages({
    granter: 'inj1granter',
    grantee: 'inj1grantee',
    includeRfq: false,
  });

  assert.equal(messages.length, ORDERBOOK_AUTHZ_MSG_TYPES.length);
  for (const [index, message] of messages.entries()) {
    const amino = message.toAmino();
    assert.equal(amino.value.grantee, 'inj1grantee');
    assert.equal(amino.value.msg_type_url, ORDERBOOK_AUTHZ_MSG_TYPES[index]);
  }
});
