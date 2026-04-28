import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHZ_MSG_TYPES,
  GRANT_EXPIRATION_S,
  buildGrantMessages,
  buildRevokeMessages,
} from '../src/services/authzMessages.js';

test('buildGrantMessages scopes every allowed trading message type', () => {
  const messages = buildGrantMessages({
    granter: 'inj1granter',
    grantee: 'inj1grantee',
    expiration: GRANT_EXPIRATION_S,
  });

  assert.equal(messages.length, AUTHZ_MSG_TYPES.length);
  for (const [index, message] of messages.entries()) {
    const amino = message.toAmino();
    assert.equal(amino.type, 'cosmos-sdk/MsgGrant');
    assert.equal(amino.value.granter, 'inj1granter');
    assert.equal(amino.value.grantee, 'inj1grantee');
    assert.equal(amino.value.grant.authorization.value.msg, AUTHZ_MSG_TYPES[index]);
  }
});

test('buildRevokeMessages uses the SDK messageType field for each grant', () => {
  const messages = buildRevokeMessages({
    granter: 'inj1granter',
    grantee: 'inj1grantee',
  });

  assert.equal(messages.length, AUTHZ_MSG_TYPES.length);
  for (const [index, message] of messages.entries()) {
    const amino = message.toAmino();
    assert.equal(amino.type, 'cosmos-sdk/MsgRevoke');
    assert.equal(amino.value.granter, 'inj1granter');
    assert.equal(amino.value.grantee, 'inj1grantee');
    assert.equal(amino.value.msg_type_url, AUTHZ_MSG_TYPES[index]);
  }
});
