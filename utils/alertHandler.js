// utils/alertHandler.js
const fs = require('fs');
const path = require('path');

function safeSave(file, obj){
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.warn('[alertHandler] save skipped:', e.message);
  }
}

function safeLoad(file){
  try {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn('[alertHandler] load failed:', e.message);
    return [];
  }
}

function computeZone(a){
  const hint = (a.Alert || a.AI_5m || a.AI_15m || a.AI_1h || '').toString().toLowerCase();
  if (a.Zone) return a.Zone;
  if (hint.includes('sell')) return 'red';
  if (hint.includes('buy'))  return 'green';
  return 'green';
}

function normalizeAlert(a){
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  return {
    Time: a.Time || `${hh}:${mm}`,
    Ticker: a.Ticker || a.symbol || a.ticker || 'UNKNOWN',
    Alert: a.Alert ?? a.alert,
    Zone: computeZone(a),
    ...a
  };
}

function initAlertHandler(app, io, { dataDir }) {
  const file = path.join(dataDir, 'alerts.json');
  let alerts = safeLoad(file);

  app.get('/alerts', (_req, res) => res.json(alerts));

  app.post('/sendAlert', (req, res) => {
    try {
      const incoming = Array.isArray(req.body) ? req.body : [req.body];
      const normalized = incoming.map(normalizeAlert);
      alerts = [...normalized, ...alerts].slice(0, 500);

      safeSave(file, alerts);       // persist to disk
      io.emit('alertsUpdate', alerts); // always notify UI

      return res.json({ ok: true, added: normalized.length });
    } catch (e) {
      console.error('sendAlert error:', e);
      return res.status(400).json({ ok: false, error: e.message });
    }
  });

  setTimeout(() => io.emit('alertsUpdate', alerts), 300);
}

module.exports = { initAlertHandler };
