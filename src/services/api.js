/**
 * Server API surface — kept small. The only thing the server still owns
 * is the faucet (FAUCET_PRIVATE_KEY can't safely live in the browser).
 * AuthZ session keys, trade signing, and broadcast all happen in-browser
 * now via services/grantee.js + services/trade.js.
 */

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  initAccount: (wallet) => call('/init-account', { method: 'POST', body: { wallet } }),
};
