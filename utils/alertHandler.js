// server/alertHandler.js
const fs = require('fs').promises;
const path = require('path');

const alertsFilePath = path.join(__dirname, '..', 'data', 'alerts.json');

function cleanString(v) {
  return typeof v === 'string' ? v.trim() : v;
}

function normalizeAlert(incoming) {
  const Ticker = String(cleanString(incoming.Ticker || incoming.ticker || '')).toUpperCase();
  const Timeframe = String(cleanString(incoming.Timeframe || incoming.timeframe || ''));
  const Alert = String(cleanString(incoming.Alert || incoming.alert || '')).toLowerCase() === 'sell' ? 'Sell' : 'Buy';
  const Time = String(cleanString(incoming.Time || incoming.time || '') || '');

  return { Ticker, Timeframe, Alert, Time, Zone: Alert === 'Buy' ? 'green' : 'red' };
}

async function readAlerts() {
  try {
    const data = await fs.readFile(alertsFilePath, 'utf8');
    if (!data) return [];
    return JSON.parse(data);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Error reading alerts.json:', err);
    return [];
  }
}

async function writeAlerts(arr) {
  try {
    await fs.writeFile(alertsFilePath, JSON.stringify(arr, null, 2));
  } catch (err) {
    console.error('Error writing alerts.json:', err);
  }
}

function applyAlertToRow(row, alert) {
  // Ensure fields exist
  row.Ticker = row.Ticker || alert.Ticker;
  row.Time = alert.Time || row.Time || '';
  row.AI_5m = row.AI_5m || '';
  row.AI_15m = row.AI_15m || '';
  row.AI_1h = row.AI_1h || '';

  // Update the correct signal column
  if (alert.Timeframe === 'AI_5m') row.AI_5m = alert.Alert;
  else if (alert.Timeframe === 'AI_15m') row.AI_15m = alert.Alert;
  else if (alert.Timeframe === 'AI_1h') row.AI_1h = alert.Alert;

  // Always set the latest time + zone from the newest alert
  if (alert.Time) row.Time = alert.Time;
  row.Zone = alert.Zone;

  return row;
}

function dedupeByTickerKeepLatest(list) {
  // Keep only one row per Ticker; put the most recently updated first.
  const seen = new Map();
  for (const r of list) {
    seen.set(r.Ticker, r);
  }
  // newest-first is: just take map values; but better: keep the incoming order with latest updates unshifted
  return Array.from(seen.values());
}

function initAlertHandler(app, io) {
  app.post('/sendAlert', async (req, res) => {
    try {
      const base = normalizeAlert(req.body || {});

      if (!base.Ticker || !base.Timeframe || !base.Alert || !base.Time) {
        return res.status(400).send({ error: 'Invalid alert format' });
      }

      console.log('Received alert:', base);

      // Load existing
      let alerts = await readAlerts();

      // Build an index by ticker
      const byTicker = new Map(alerts.map(a => [a.Ticker, a]));

      // Update existing row or create new
      const existing = byTicker.get(base.Ticker) || {
        Ticker: base.Ticker,
        Time: '',
        AI_5m: '',
        AI_15m: '',
        AI_1h: '',
        Zone: base.Zone
      };

      const updated = applyAlertToRow(existing, base);
      byTicker.set(base.Ticker, updated);

      // Rebuild list: put the updated ticker at the TOP, then the rest (without duplicates)
      const rest = alerts.filter(a => a.Ticker !== base.Ticker);
      alerts = [updated, ...rest];

      // Final safety: ensure 1 per ticker
      alerts = dedupeByTickerKeepLatest(alerts);

      await writeAlerts(alerts);

      // Broadcast de-duped alerts
      io.emit('alertsUpdate', alerts);

      res.status(200).send({ success: true });
    } catch (e) {
      console.error('sendAlert error:', e);
      res.status(500).send({ error: 'Internal error' });
    }
  });
}

module.exports = { initAlertHandler };
