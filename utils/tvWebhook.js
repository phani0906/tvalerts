// utils/tvWebhook.js
const fs = require('fs');
const path = require('path');
const express = require('express');

module.exports = function tvWebhookRouterFactory(io, { tvSecret = '', dataDir }) {
  const router = express.Router();
  const alertsFilePath = path.join(dataDir || path.join(__dirname, '..', 'data'), 'alerts.json');

  // ---------- helpers ----------
  function ensureDir(p) {
    try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch {}
  }

  function safeLoad(file) {
    try {
      if (!fs.existsSync(file)) return [];
      const raw = fs.readFileSync(file, 'utf8').trim();
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('[tvWebhook] load failed:', e.message);
      return [];
    }
  }

  function safeSave(file, obj) {
    try {
      ensureDir(file);
      fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      console.warn('[tvWebhook] save failed (non-fatal):', e.message);
    }
  }

  function toHHMM(val) {
    if (val == null || val === '') {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    // epoch?
    const s = String(val);
    const d = /^\d+$/.test(s) ? new Date(Number(s)) : new Date(s);
    if (isNaN(d.getTime())) return s;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function parseBody(reqBody) {
    // TradingView sometimes sends { message: "<json string>" }
    let payload = reqBody;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch {}
    }
    if (payload && typeof payload.message === 'string') {
      try { payload = JSON.parse(payload.message); } catch {}
    }
    return payload || {};
  }

  function normalizeAlert(b) {
    const Ticker    = String(b.Ticker || b.ticker || '').toUpperCase();
    const Timeframe = String(b.Timeframe || b.timeframe || '');
    const Alert     = /sell/i.test(String(b.Alert || b.alert)) ? 'Sell' : 'Buy';
    const Time      = toHHMM(b.Time || b.time || b.timenow || Date.now());
    const Zone      = Alert === 'Buy' ? 'green' : 'red';
    return { Ticker, Timeframe, Alert, Time, Zone };
  }

  // In-memory dedupe (avoid floods)
  const recent = new Map(); // key => ts

  // ---------- route ----------
  router.post('/tv-webhook', express.json({ limit: '1mb' }), (req, res) => {
    try {
      // 1) shared secret (required if tvSecret is set)
      if (tvSecret && req.query.key !== tvSecret) {
        return res.status(403).json({ ok: false, error: 'Forbidden: bad key' });
      }

      // 2) parse & normalize
      const body  = parseBody(req.body);
      const alert = normalizeAlert(body);

      if (!alert.Ticker || !alert.Timeframe || !alert.Alert || !alert.Time) {
        console.warn('[tvWebhook] missing fields in payload:', body);
        return res.status(400).json({ ok: false, error: 'Bad alert payload' });
      }

      // 3) dedupe: same Ticker/TF/Alert within 5s
      const key = `${alert.Ticker}|${alert.Timeframe}|${alert.Alert}`;
      const now = Date.now();
      const last = recent.get(key) || 0;
      if (now - last < 5000) return res.json({ ok: true, deduped: true });
      recent.set(key, now);

      // 4) merge into alerts list (latest-first, cap 500)
      const alerts = safeLoad(alertsFilePath);

      // row per Ticker (you can change to per (Ticker,TF) if you prefer)
      let i = alerts.findIndex(a => a.Ticker === alert.Ticker);
      if (i !== -1) {
        const row = alerts[i];
        if (alert.Timeframe === 'AI_5m') {
          row.AI_5m = alert.Alert;
          row.Time  = alert.Time;        // show latest 5m time
          row.Zone  = alert.Zone;        // drive zone by 5m
        } else if (alert.Timeframe === 'AI_15m') {
          row.AI_15m = alert.Alert;
          if (!row.AI_5m) row.Zone = row.Zone || alert.Zone;
        } else if (alert.Timeframe === 'AI_1h') {
          row.AI_1h = alert.Alert;
          if (!row.AI_5m) row.Zone = row.Zone || alert.Zone;
        } else {
          // unknown tf: store generically
          row[alert.Timeframe] = alert.Alert;
        }
        // move updated row to top
        alerts.splice(i, 1);
        alerts.unshift(row);
      } else {
        alerts.unshift({
          Ticker:  alert.Ticker,
          Time:    alert.Timeframe === 'AI_5m' ? alert.Time : '',
          AI_5m:   alert.Timeframe === 'AI_5m'  ? alert.Alert : '',
          AI_15m:  alert.Timeframe === 'AI_15m' ? alert.Alert : '',
          AI_1h:   alert.Timeframe === 'AI_1h'  ? alert.Alert : '',
          Zone:    alert.Zone
        });
      }

      while (alerts.length > 500) alerts.pop();

      // 5) persist + notify UI
      safeSave(alertsFilePath, alerts);
      io.emit('alertsUpdate', alerts);

      return res.json({ ok: true, accepted: 1 });
    } catch (e) {
      console.error('[tvWebhook] error:', e);
      return res.status(500).json({ ok: false, error: 'Internal error' });
    }
  });

  return router;
};
