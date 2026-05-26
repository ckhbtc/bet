import {
  MsgGrant,
  MsgRevoke,
  getGenericAuthorizationFromMessageType,
} from '@injectivelabs/sdk-ts';
import { RFQ_CONTRACT_ADDRESS } from './rfqConstants.js';

export const AUTHZ_SCOPE_VERSION = 2;

export const ORDERBOOK_AUTHZ_MSG_TYPES = [
  '/injective.exchange.v1beta1.MsgCreateDerivativeMarketOrder',
  '/injective.exchange.v1beta1.MsgCreateDerivativeLimitOrder',
  '/injective.exchange.v1beta1.MsgCancelDerivativeOrder',
  '/injective.exchange.v1beta1.MsgBatchUpdateOrders',
  '/injective.exchange.v1beta1.MsgIncreasePositionMargin',
];

export const APP_RFQ_AUTHZ_MSG_TYPES = [
  '/injective.wasmx.v1.MsgExecuteContractCompat',
];

export const AUTHZ_MSG_TYPES = [
  ...ORDERBOOK_AUTHZ_MSG_TYPES,
  ...APP_RFQ_AUTHZ_MSG_TYPES,
];

export const RFQ_CONTRACT_AUTHZ_MSG_TYPES = [
  '/injective.exchange.v2.MsgPrivilegedExecuteContract',
  '/injective.exchange.v2.MsgBatchUpdateOrders',
  '/cosmos.bank.v1beta1.MsgSend',
];

// "Indefinite" grant: year 2099 in seconds-since-epoch.
// Revoke remains available and should be used before clearing local state.
export const GRANT_EXPIRATION_S = 4_070_908_800; // 2099-01-01T00:00:00Z

function buildGenericGrantMessages({ granter, grantee, msgTypes, expiration }) {
  return msgTypes.map(messageType =>
    MsgGrant.fromJSON({
      grantee,
      granter,
      authorization: getGenericAuthorizationFromMessageType(messageType),
      expiration,
    })
  );
}

function buildGenericRevokeMessages({ granter, grantee, msgTypes }) {
  return msgTypes.map(messageType =>
    MsgRevoke.fromJSON({
      granter,
      grantee,
      messageType,
    })
  );
}

export function buildGrantMessages({
  granter,
  grantee,
  expiration = GRANT_EXPIRATION_S,
  includeRfq = true,
}) {
  const messages = buildGenericGrantMessages({
    granter,
    grantee,
    msgTypes: includeRfq ? AUTHZ_MSG_TYPES : ORDERBOOK_AUTHZ_MSG_TYPES,
    expiration,
  });

  if (!includeRfq) return messages;

  return [
    ...messages,
    ...buildGenericGrantMessages({
      granter,
      grantee: RFQ_CONTRACT_ADDRESS,
      msgTypes: RFQ_CONTRACT_AUTHZ_MSG_TYPES,
      expiration,
    }),
  ];
}

export function buildRevokeMessages({ granter, grantee, includeRfq = true }) {
  const messages = buildGenericRevokeMessages({
    granter,
    grantee,
    msgTypes: includeRfq ? AUTHZ_MSG_TYPES : ORDERBOOK_AUTHZ_MSG_TYPES,
  });

  if (!includeRfq) return messages;

  return [
    ...messages,
    ...buildGenericRevokeMessages({
      granter,
      grantee: RFQ_CONTRACT_ADDRESS,
      msgTypes: RFQ_CONTRACT_AUTHZ_MSG_TYPES,
    }),
  ];
}
