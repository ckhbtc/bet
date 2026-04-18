import express from 'express';
import {
  activateSession,
  deactivateSession,
  getSessionByToken,
  getSessionStatus,
  executeOpen,
  executeClose,
} from './executor.js';
import { initAccount } from './faucet.js';

const router = express.Router();
router.use(express.json({ limit: '64kb' }));

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function requireSession(req, res, next) {
  const token = bearer(req);
  const session = token ? getSessionByToken(token) : null;
  if (!session) return res.status(401).json({ error: 'No active session' });
  // Defense in depth: if the client tells us which wallet it thinks is active,
  // reject mismatches. Stops a stale token in localStorage from running trades
  // on a previous wallet after the user swapped MetaMask accounts.
  const asserted = req.body?.granterAddress || req.headers['x-granter-address'];
  if (asserted && asserted !== session.granterAddress) {
    return res.status(403).json({ error: 'Session wallet mismatch — please re-authorize' });
  }
  req.session = session;
  next();
}

router.post('/activate', (req, res) => {
  try {
    const { privateKeyHex, injectiveAddress, granterAddress, ethAddress, evmChainId, expiration } = req.body;
    if (!privateKeyHex || !injectiveAddress || !granterAddress || !ethAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const result = activateSession({
      privateKeyHex,
      granteeAddress: injectiveAddress,
      granterAddress,
      ethAddress,
      evmChainId,
      expiration,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/init-account', async (req, res) => {
  try {
    const { wallet } = req.body || {};
    if (!wallet || !/^inj1[a-z0-9]{38}$/.test(wallet)) {
      return res.status(400).json({ error: 'Valid inj1... wallet required' });
    }
    const txHash = await initAccount(wallet);
    res.json({ ok: true, txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/session/check', (req, res) => {
  const token = bearer(req);
  if (!token) return res.json({ active: false });
  const session = getSessionByToken(token);
  if (!session) return res.json({ active: false });
  res.json({ active: true, expiration: session.expiration, granterAddress: session.granterAddress });
});

router.get('/session/status/:granter', (req, res) => {
  res.json(getSessionStatus(req.params.granter));
});

router.post('/session/deactivate', requireSession, (req, res) => {
  deactivateSession(req.session.granterAddress);
  res.json({ ok: true });
});

router.post('/trade/open', requireSession, async (req, res) => {
  try {
    const { marketId, side, stakeUsdt, leverage, slippage, tpPrice } = req.body;
    if (!marketId || !side || !stakeUsdt || !leverage) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const result = await executeOpen({
      session: req.session, marketId, side, stakeUsdt, leverage, slippage, tpPrice,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/trade/close', requireSession, async (req, res) => {
  try {
    const { marketId, side, quantity, slippage } = req.body;
    if (!marketId || !side || !quantity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const result = await executeClose({
      session: req.session, marketId, side, quantity, slippage,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
