const DEFAULT_LCD_URLS = ['https://sentry.lcd.injective.network'];
const DEFAULT_RPC_URLS = ['https://sentry.tm.injective.network'];
const TX_BYTES_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const RFQ_TIMING_PREFIX = '[RFQ-TIMING]';

function configuredUrls(envKey, defaults) {
  const configured = (process.env[envKey] || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  return configured.length ? configured : defaults;
}

function lcdBroadcastUrls() {
  const bases = configuredUrls('RFQ_BROADCAST_LCD_URLS', DEFAULT_LCD_URLS);
  return bases.map((url) => {
    const trimmed = url.replace(/\/+$/, '');
    return trimmed.endsWith('/cosmos/tx/v1beta1/txs')
      ? trimmed
      : `${trimmed}/cosmos/tx/v1beta1/txs`;
  });
}

function rpcBroadcastUrls() {
  return configuredUrls('RFQ_BROADCAST_RPC_URLS', DEFAULT_RPC_URLS)
    .map((url) => url.replace(/\/+$/, ''));
}

function validateTxBytes(txBytes) {
  if (typeof txBytes !== 'string' || txBytes.length < 16 || txBytes.length > 64_000) {
    throw new Error('Invalid tx bytes');
  }
  if (!TX_BYTES_RE.test(txBytes)) {
    throw new Error('Invalid tx bytes');
  }
}

async function postBroadcast(url, txBytes) {
  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_bytes: txBytes,
      mode: 'BROADCAST_MODE_SYNC',
    }),
  });
  const body = await response.json().catch(() => ({}));
  const txResponse = body?.tx_response;
  if (!response.ok || !txResponse) {
    throw new Error(body?.message || body?.error || `LCD broadcast failed (${response.status})`);
  }
  if (Number(txResponse.code || 0) !== 0) {
    throw new Error(txResponse.raw_log || `LCD broadcast failed (code ${txResponse.code})`);
  }
  return {
    txHash: txResponse.txhash,
    relayMs: Date.now() - started,
    endpoint: url,
  };
}

async function postRpcBroadcast(url, txBytes) {
  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `rfq-${Date.now()}`,
      method: 'broadcast_tx_sync',
      params: { tx: txBytes },
    }),
  });
  const body = await response.json().catch(() => ({}));
  const result = body?.result;
  if (!response.ok || body?.error || !result) {
    throw new Error(body?.error?.message || `RPC broadcast failed (${response.status})`);
  }
  if (Number(result.code || 0) !== 0) {
    throw new Error(result.log || `RPC broadcast failed (code ${result.code})`);
  }
  return {
    txHash: result.hash,
    relayMs: Date.now() - started,
    endpoint: url,
  };
}

export async function relayRfqBroadcast({ txBytes }) {
  validateTxBytes(txBytes);
  const started = Date.now();
  const attempts = [
    ...rpcBroadcastUrls().map((url) => postRpcBroadcast(url, txBytes)),
    ...lcdBroadcastUrls().map((url) => postBroadcast(url, txBytes)),
  ];
  try {
    const result = await Promise.any(attempts);
    console.info(`${RFQ_TIMING_PREFIX} relay.accepted`, JSON.stringify({
      at: new Date().toISOString(),
      txHash: result.txHash,
      endpoint: result.endpoint,
      relayMs: result.relayMs,
      totalMs: Date.now() - started,
    }));
    return result;
  } catch (err) {
    const messages = err?.errors?.map((error) => error.message).filter(Boolean) || [];
    console.info(`${RFQ_TIMING_PREFIX} relay.error`, JSON.stringify({
      at: new Date().toISOString(),
      totalMs: Date.now() - started,
      errors: messages,
    }));
    throw new Error(messages.join('; ') || err.message || 'RFQ relay broadcast failed');
  }
}
