// utils/alertHandler.js
const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch {}
}

function safeLoad(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('[alertHandler] load failed:', e.message);
    return [];
  }
}

function safeSave(file, obj) {
  try {
    ensureDir(file);
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.warn('[alertHandler] save skipped (non-fatal):', e.message);
  }
}

function computeZone(a) {
  const hint = (a.Alert || a.AI_5m || a.AI_15m || a.AI_1h || '').toString().toLowerCase();
  if (a.Zone) return a.Zone;
  if (hint.includes('sell')) return 'red';
  if (hint.includes('buy'))  return 'green';
  return 'green';
}

function normalizeAlert(a) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  return {
    Time: a.Time || `${hh}:${mm}`,
    Ticker: (a.Ticker || a.symbol || a.ticker || 'UNKNOWN').toUpperCase(),
    Alert: a.Alert ?? a.alert,
    AI_5m: a.AI_5m ?? a.AI5m ?? a.signal5m,
    AI_15m: a.AI_15m ?? a.AI15m ?? a.signal15m,
    AI_1h: a.AI_1h ?? a.AI1h ?? a.signal1h,
    NCPR: a.NCPR ?? a.ncpr,
    Pivot: a.Pivot ?? a.pivot,
    Zone: computeZone(a),
    ...a
  };
}

function initAlertHandler(app, io, { dataDir }) {
  const file = path.join(dataDir || path.join(__dirname, '..', 'data'), 'alerts.json');
  let alerts = safeLoad(file);

  // For quick inspection
  app.get('/alerts', (_req, res) => res.json(alerts));

  // Accept single alert object or array of alerts
  app.post('/sendAlert', (req, res) => {
    try {
      const incoming = Array.isArray(req.body) ? req.body : [req.body];
      const normalized = incoming.map(normalizeAlert);

      // Prepend newest; cap list
      alerts = [...normalized, ...alerts].slice(0, 500);

      // Persist + notify UI
      safeSave(file, alerts);
      io.emit('alertsUpdate', alerts);
      console.log('[emit] alertsUpdate ->', alerts.length);

      return res.json({ ok: true, added: normalized.length });
    } catch (e) {
      console.error('sendAlert error:', e);
      return res.status(400).json({ ok: false, error: e.message });
    }
  });

  // Emit current alerts shortly after boot so the UI fills on first connect
  setTimeout(() => {
    io.emit('alertsUpdate', alerts);
    console.log('[emit] initial alertsUpdate ->', alerts.length);
  }, 300);

  return {
    getAlerts: () => alerts,
    setAlerts: (arr) => {
      alerts = Array.isArray(arr) ? arr : [];
      safeSave(file, alerts);
      io.emit('alertsUpdate', alerts);
    }
  };
}

module.exports = { initAlertHandler };
