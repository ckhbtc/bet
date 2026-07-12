// Trade keys and signing stay in-browser. These wrappers only call the
// account faucet and permissionless CCTP mint relay.

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Invalid response from ${path}`);
  }
  if (!res.ok) {
    const message = typeof data.error === 'string' && data.error
      ? data.error
      : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

async function callForTx(path, options) {
  const data = await call(path, options);
  if (data.ok !== true || typeof data.txHash !== 'string' || !data.txHash.trim()) {
    throw new Error(`Invalid response from ${path}`);
  }
  return data;
}

export const api = {
  initAccount: (wallet) => callForTx('/init-account', { method: 'POST', body: { wallet } }),
  relayMint: (message, attestation) =>
    callForTx('/relay-mint', { method: 'POST', body: { message, attestation } }),
};
