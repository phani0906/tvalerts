// utils/alertHandler.js
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
  return v.includes('sell') ? 'Sell' : 'Buy';
}
function normTF(tf) {
  const v = String(tf || '').trim().toUpperCase();
  if (v === 'AI_5M') return 'AI_5m';
  if (v === 'AI_15M') return 'AI_15m';
  if (v === 'AI_1H' || v === 'AI_60M') return 'AI_1h';
  return v;
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
    if (e.code !== 'ENOENT') console.error('[sendAlert] read error:', e);
    return [];
  }
}
async function save(file, arr) {
  try {
    await fs.writeFile(file, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('[sendAlert] write error:', e);
  }
}

function initAlertHandler(app, io, { dataDir }) {
  app.post('/sendAlert', async (req, res) => {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const Ticker    = normTicker(body.Ticker || body.ticker);
      const Timeframe = normTF(body.Timeframe || body.timeframe);
      const Alert     = normAlert(body.Alert || body.alert);
      const Time      = String(body.Time || body.time || '').trim();

      if (!Ticker || !Timeframe || !Alert || !Time) {
        return res.status(400).json({ error: 'Invalid alert format' });
      }

      const Zone = Alert === 'Buy' ? 'green' : 'red';
      const ReceivedAt = new Date().toISOString();
      const file = fileForTF(dataDir, Timeframe);

      let arr = await load(file);
      const idx = arr.findIndex(a => a.Ticker === Ticker);
      const row = { Time, Ticker, Alert, Zone, Timeframe, ReceivedAt };

      if (idx !== -1) arr[idx] = row; else arr.unshift(row);
      await save(file, arr);

      console.log('Received alert:', JSON.stringify(row));

      io.emit(`alertsUpdate:${Timeframe}`, arr);
      io.emit('alertsUpdate', { timeframe: Timeframe, data: arr });

      res.json({ success: true });
    } catch (err) {
      console.error('sendAlert error:', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });
}

module.exports = { initAlertHandler };
