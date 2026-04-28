import {
  MsgGrant,
  MsgRevoke,
  getGenericAuthorizationFromMessageType,
} from '@injectivelabs/sdk-ts';

export const AUTHZ_MSG_TYPES = [
  '/injective.exchange.v1beta1.MsgCreateDerivativeMarketOrder',
  '/injective.exchange.v1beta1.MsgCreateDerivativeLimitOrder',
  '/injective.exchange.v1beta1.MsgCancelDerivativeOrder',
  '/injective.exchange.v1beta1.MsgBatchUpdateOrders',
  '/injective.exchange.v1beta1.MsgIncreasePositionMargin',
];

// "Indefinite" grant: year 2099 in seconds-since-epoch.
// Revoke remains available and should be used before clearing local state.
export const GRANT_EXPIRATION_S = 4_070_908_800; // 2099-01-01T00:00:00Z

export function buildGrantMessages({ granter, grantee, expiration = GRANT_EXPIRATION_S }) {
  return AUTHZ_MSG_TYPES.map(messageType =>
    MsgGrant.fromJSON({
      grantee,
      granter,
      authorization: getGenericAuthorizationFromMessageType(messageType),
      expiration,
    })
  );
}

export function buildRevokeMessages({ granter, grantee }) {
  return AUTHZ_MSG_TYPES.map(messageType =>
    MsgRevoke.fromJSON({
      granter,
      grantee,
      messageType,
    })
  );
}
