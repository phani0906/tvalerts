// utils/tvWebhook.js
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

function normTicker(t) {
  if (!t) return '';
  return String(t).toUpperCase().split(':').pop().trim();
}
function normAlert(a) {
  const v = String(a || '').trim().toLowerCase();
  if (v === 'sell') return 'Sell';
  if (v === 'buy') return 'Buy';
  // Accept strategy.order.action like "buy"/"sell"
  return v.includes('sell') ? 'Sell' : 'Buy';
}
function normTF(tf) {
  const v = String(tf || '').trim().toUpperCase();
  if (v === 'AI_5M') return 'AI_5m';
  if (v === 'AI_15M') return 'AI_15m';
  if (v === 'AI_1H' || v === 'AI_60M') return 'AI_1h';
  return v; // unknown stays as-is
}
function fileForTF(baseDir, tf) {
  switch (tf) {
    case 'AI_5m':  return path.join(baseDir, 'alerts_5m.json');
    case 'AI_15m': return path.join(baseDir, 'alerts_15m.json');
    case 'AI_1h':  return path.join(baseDir, 'alerts_1h.json');
    default:       return path.join(baseDir, 'alerts_other.json');
  }
}
async function load(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[tv-webhook] read error:', e);
    return [];
  }
}
async function save(file, arr) {
  try {
    await fs.writeFile(file, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('[tv-webhook] write error:', e);
  }
}

module.exports = function tvWebhookRouterFactory(io, { tvSecret = '', dataDir }) {
  const router = express.Router();

  router.post('/tv-webhook', async (req, res) => {
    try {
      // Optional shared secret
      if (tvSecret && (req.query.key || '') !== tvSecret) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const rawLog = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      console.log('[tv-webhook] raw body:', rawLog);

      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const Ticker    = normTicker(body.Ticker || body.ticker);
      const Timeframe = normTF(body.Timeframe || body.timeframe);
      const Alert     = normAlert(body.Alert || body.alert);
      const Time      = String(body.Time || body.time || body.timenow || '').trim();

      if (!Ticker || !Timeframe || !Alert || !Time) {
        console.log('[tv-webhook] ignored (missing fields):', { Ticker, Timeframe, Alert, Time });
        return res.status(204).end();
      }

      const Zone = Alert === 'Buy' ? 'green' : 'red';
      const ReceivedAt = new Date().toISOString();

      const file = fileForTF(dataDir, Timeframe);
      let arr = await load(file);

      // Upsert by ticker per timeframe
      const idx = arr.findIndex(r => r.Ticker === Ticker);
      const row = { Time, Ticker, Alert, Zone, Timeframe, ReceivedAt };

      if (idx !== -1) arr[idx] = row; else arr.unshift(row);
      await save(file, arr);

      console.log('[tv-webhook] stored:', JSON.stringify(row));

      // Emit per-timeframe and generic (if your front end still listens to generic)
      io.emit(`alertsUpdate:${Timeframe}`, arr);
      io.emit('alertsUpdate', { timeframe: Timeframe, data: arr });

      res.json({ ok: true });
    } catch (err) {
      console.error('[tv-webhook] error:', err);
      // Return 200 so TradingView doesn't endlessly retry (you already logged the error)
      res.status(200).send('ok');
    }
  });

  return router;
};
