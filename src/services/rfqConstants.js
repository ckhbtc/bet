export const RFQ_CONTRACT_ADDRESS = 'inj1e0u9nl50gzhmrmhwx3v9vf535vkhwzpwku6mtk';
export const RFQ_WS_URL = 'wss://rfq.ws.injective.network';
export const RFQ_GRPC_WEB_URL = 'https://rfq.grpc-web.injective.network';
export const RFQ_GATEWAY_URL = 'https://rfq.gateway.grpc-web.injective.network/';
export const RFQ_CHAIN_ID = 'injective-1';
export const RFQ_EVM_CHAIN_ID = 1776;
export const RFQ_COLLECT_QUOTES_MS = 250;
export const RFQ_REQUEST_TIMEOUT_MS = 15_000;
export const RFQ_MIN_QUOTE_TTL_MS = 4_000;
export const RFQ_PREPARE_MAX_ATTEMPTS = 3;
export const RFQ_PREPARE_RETRY_DELAY_MS = 75;
export const RFQ_TPSL_SIGNED_INTENT_VERSION = 1;
export const RFQ_TPSL_SUBACCOUNT_NONCE = 0;
export const RFQ_TPSL_DEADLINE_MS = 21 * 24 * 60 * 60 * 1000;
export const RFQ_TPSL_NONCE_WINDOW_MS = 60_000;
export const RFQ_TPSL_SLIPPAGE = 0.005;
export const RFQ_TPSL_MIN_FILL_RATIO = 0.1;

export const RFQ_TPSL_TRIGGER = {
  MARK_PRICE_GTE: 'mark_price_gte',
  MARK_PRICE_LTE: 'mark_price_lte',
};
