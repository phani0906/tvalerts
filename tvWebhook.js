// server/tvWebhook.js
const fs = require('fs');
const path = require('path');

module.exports = (io, opts = {}) => {
  const express = require('express');
  const router = express.Router();

  const tvSecret = opts.tvSecret || '';
  const dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
  const alertsFilePath = path.join(dataDir, 'alerts.json');

  // In-memory dedupe (avoid floods)
  const recent = new Map(); // key => ts

  function readAlerts() {
    try {
      if (!fs.existsSync(alertsFilePath)) return [];
      const raw = fs.readFileSync(alertsFilePath, 'utf8').trim();
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('tvWebhook readAlerts error:', e);
      return [];
    }
  }

  function writeAlerts(alerts) {
    try {
      fs.writeFileSync(alertsFilePath, JSON.stringify(alerts, null, 2));
    } catch (e) {
      console.error('tvWebhook writeAlerts error:', e);
    }
  }

  function toHHMM(val) {
    const d = /^\d+$/.test(String(val)) ? new Date(Number(val)) : new Date(val);
    if (isNaN(d.getTime())) return String(val ?? '');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  router.post('/tv-webhook', express.json(), (req, res) => {
    try {
      // 1) shared secret
      if (!tvSecret || req.query.key !== tvSecret) {
        return res.sendStatus(403);
      }

      const body = req.body || {};
      // TV sends exactly what you put in "Message" — we accept both camel and lower keys
      const alert = {
        Ticker:     String(body.Ticker || body.ticker || '').toUpperCase(),
        Timeframe:  String(body.Timeframe || body.timeframe || ''),
        Alert:      (body.Alert || body.alert) === 'Sell' ? 'Sell' : 'Buy',
        Time:       toHHMM(body.Time || body.time || body.timenow || Date.now()),
      };

      if (!alert.Ticker || !alert.Timeframe || !alert.Alert || !alert.Time) {
        console.warn('TV webhook: missing fields', body);
        return res.status(400).send('Bad alert payload');
      }

      alert.Zone = alert.Alert === 'Buy' ? 'green' : 'red';

      // 2) dedupe: same Ticker/TF/Alert within 5s
      const key = `${alert.Ticker}|${alert.Timeframe}|${alert.Alert}`;
      const now = Date.now();
      const last = recent.get(key) || 0;
      if (now - last < 5000) return res.sendStatus(200);
      recent.set(key, now);

      // 3) merge into alerts.json like /sendAlert does
      const alerts = readAlerts();
      const i = alerts.findIndex(a => a.Ticker === alert.Ticker);

      if (i !== -1) {
        const row = alerts[i];
        if (alert.Timeframe === 'AI_5m') {
          row.AI_5m = alert.Alert;
          row.Time = alert.Time;
          row.Zone = alert.Zone;
        } else if (alert.Timeframe === 'AI_15m') {
          row.AI_15m = alert.Alert;
          if (!row.AI_5m) row.Zone = row.Zone || alert.Zone;
        } else if (alert.Timeframe === 'AI_1h') {
          row.AI_1h = alert.Alert;
          if (!row.AI_5m) row.Zone = row.Zone || alert.Zone;
        }
      } else {
        alerts.push({
          Ticker: alert.Ticker,
          Time: alert.Timeframe === 'AI_5m' ? alert.Time : '',
          AI_5m: alert.Timeframe === 'AI_5m' ? alert.Alert : '',
          AI_15m: alert.Timeframe === 'AI_15m' ? alert.Alert : '',
          AI_1h: alert.Timeframe === 'AI_1h' ? alert.Alert : '',
          Zone: alert.Zone
        });
      }

      writeAlerts(alerts);
      io.emit('alertsUpdate', alerts);
      res.sendStatus(200);
    } catch (e) {
      console.error('tv-webhook error:', e);
      res.sendStatus(500);
    }
  });

  return router;
};
