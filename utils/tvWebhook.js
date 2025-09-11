// utils/tvWebhook.js
const express = require('express');
const path = require('path');
const fs = require('fs').promises;

function fileForTF(dir, timeframe) {
  if (timeframe === 'AI_5m')  return path.join(dir, 'alerts_5m.json');
  if (timeframe === 'AI_15m') return path.join(dir, 'alerts_15m.json');
  if (timeframe === 'AI_1h')  return path.join(dir, 'alerts_1h.json');
  return path.join(dir, 'alerts.json');
}

async function readJsonSafe(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

module.exports = function tvWebhookRouterFactory(io, { tvSecret, dataDir }) {
  const router = express.Router();

  router.post('/tv-webhook', async (req, res) => {
    if (tvSecret) {
      const key = req.query.key || req.headers['x-tv-key'];
      if (key !== tvSecret) return res.status(401).send({ error: 'Unauthorized' });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }

    const { Ticker, Timeframe, Alert, Time } = body || {};
    if (!Ticker || !Timeframe || !Alert || !Time) {
      return res.status(400).send({ error: 'Invalid payload' });
    }

    const row = {
      Time, Ticker, Alert,
      Zone: (Alert || '').toLowerCase() === 'buy' ? 'green' : 'red',
      Timeframe,
      ReceivedAt: new Date().toISOString()
    };

    const file = fileForTF(dataDir, Timeframe);
    const prev = await readJsonSafe(file);
    const next = [...prev, row].slice(-500);
    await fs.writeFile(file, JSON.stringify(next, null, 2));

    io.emit(`alertsUpdate:${Timeframe}`, next);
    io.emit('alertsUpdate', next);

    console.log(`[tv] ${Timeframe} ${Ticker} ${Alert} -> ${path.basename(file)} (count=${next.length})`);

    res.send({ ok: true });
  });

  return router;
};
