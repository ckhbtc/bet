const TOKEN_KEY = 'bet-session-token';

export function getSessionToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setSessionToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

async function call(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getSessionToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // Read the currently-connected wallet from the store lazily to avoid a
    // circular import; attach it so the server can reject token-vs-wallet drift.
    try {
      const { default: useWalletStore } = await import('../stores/walletStore');
      const inj = useWalletStore.getState().injAddress;
      if (inj) headers['X-Granter-Address'] = inj;
    } catch { /* ignore */ }
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  activate: (payload) => call('/activate', { method: 'POST', body: payload }),
  sessionCheck: () => call('/session/check', { auth: true }),
  sessionDeactivate: () => call('/session/deactivate', { method: 'POST', auth: true }),
  tradeOpen: (payload) => call('/trade/open', { method: 'POST', body: payload, auth: true }),
  tradeClose: (payload) => call('/trade/close', { method: 'POST', body: payload, auth: true }),
  initAccount: (wallet) => call('/init-account', { method: 'POST', body: { wallet } }),
};
