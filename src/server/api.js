/**
 * Server API surface — minimal. The frontend signs and broadcasts trades
 * itself using the locally-stored grantee key, so this route file only
 * holds the faucet (which needs FAUCET_PRIVATE_KEY in .env and can't
 * safely run in the browser).
 */

import express from 'express';
import { initAccount } from './faucet.js';

const router = express.Router();
router.use(express.json({ limit: '64kb' }));

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

export default router;
