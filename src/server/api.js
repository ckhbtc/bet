/**
 * Server API surface — minimal. Trade keys stay in-browser. The server only
 * handles operations that do not require custody: faucet, CCTP relay, and
 * RFQ signed-tx broadcast relay.
 */

import express from 'express';
import { initAccount } from './faucet.js';
import { relayMint } from './relayMint.js';
import { relayRfqBroadcast } from './rfqBroadcast.js';

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

router.post('/relay-mint', async (req, res) => {
  try {
    const { message, attestation } = req.body || {};
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const txHash = await relayMint({ message, attestation }, ip);
    res.json({ ok: true, txHash });
  } catch (err) {
    const code = /Rate limit|Invalid|Message dst/.test(err.message) ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

router.post('/rfq-broadcast', async (req, res) => {
  try {
    const { txBytes } = req.body || {};
    const result = await relayRfqBroadcast({ txBytes });
    res.json({ ok: true, txHash: result.txHash, relayMs: result.relayMs });
  } catch (err) {
    const code = /Invalid/.test(err.message) ? 400 : 502;
    res.status(code).json({ error: err.message });
  }
});

router.post('/rfq-timing', (req, res) => {
  const body = req.body || {};
  const safe = {
    receivedAt: new Date().toISOString(),
    id: String(body.id || '').slice(0, 80),
    flow: String(body.flow || '').slice(0, 40),
    status: String(body.status || '').slice(0, 40),
    marketId: String(body.marketId || '').slice(0, 90),
    side: String(body.side || '').slice(0, 12),
    direction: String(body.direction || '').slice(0, 12),
    totalMs: Number.isFinite(Number(body.totalMs)) ? Number(body.totalMs) : null,
    details: body.details || null,
    marks: Array.isArray(body.marks) ? body.marks.slice(0, 40) : [],
  };
  console.info('[RFQ-TIMING] client', JSON.stringify(safe));
  res.json({ ok: true });
});

export default router;
