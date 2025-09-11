// utils/alertHandler.js
const fs = require('fs').promises;
const path = require('path');

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
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[alertHandler] read fail', p, e.message);
    return [];
  }
}

async function writeJsonSafe(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2));
}

function initAlertHandler(app, io, { dataDir }) {
  app.post('/sendAlert', async (req, res) => {
    const alert = req.body;
    if (!alert || !alert.Ticker || !alert.Timeframe || !alert.Alert || !alert.Time) {
      return res.status(400).send({ error: 'Invalid alert format' });
    }

    const row = {
      Time: alert.Time,
      Ticker: alert.Ticker,
      Alert: alert.Alert,
      Zone: (alert.Alert || '').toLowerCase() === 'buy' ? 'green' : 'red',
      Timeframe: alert.Timeframe,
      ReceivedAt: new Date().toISOString()
    };

    const file = fileForTF(dataDir, row.Timeframe);
    let rows = await readJsonSafe(file);
    rows.push(row);
    if (rows.length > 500) rows = rows.slice(-500);
    await writeJsonSafe(file, rows);

    io.emit(`alertsUpdate:${row.Timeframe}`, rows);
    io.emit('alertsUpdate', rows);

    console.log(`[alerts] ${row.Timeframe} ${row.Ticker} ${row.Alert} -> ${path.basename(file)} (count=${rows.length})`);
    res.send({ ok: true });
  });

  // initial-load endpoints
  app.get('/alerts/5m', async (_req, res) => res.send(await readJsonSafe(path.join(dataDir, 'alerts_5m.json'))));
  app.get('/alerts/15m', async (_req, res) => res.send(await readJsonSafe(path.join(dataDir, 'alerts_15m.json'))));
  app.get('/alerts/1h', async (_req, res) => res.send(await readJsonSafe(path.join(dataDir, 'alerts_1h.json'))));
}

module.exports = { initAlertHandler };
