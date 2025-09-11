const fsp = require('fs').promises;
const path = require('path');

function ensureDir(p) { return fsp.mkdir(p, { recursive: true }); }

async function readJsonArray(file) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeJsonArray(file, arr) {
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, JSON.stringify(arr, null, 2));
}

function initAlertHandler(app, io, { dataDir }) {
  const f5  = path.join(dataDir, 'alerts_5m.json');
  const f15 = path.join(dataDir, 'alerts_15m.json');
  const f1h = path.join(dataDir, 'alerts_1h.json');

  app.get('/alerts/5m',  async (_req, res) => res.json(await readJsonArray(f5)));
  app.get('/alerts/15m', async (_req, res) => res.json(await readJsonArray(f15)));
  app.get('/alerts/1h',  async (_req, res) => res.json(await readJsonArray(f1h)));

  app.post('/sendAlert', async (req, res) => {
    const a = req.body || {};
    if (!a.Ticker || !a.Timeframe || !a.Alert || !a.Time) {
      return res.status(400).json({ error: 'Invalid alert format' });
    }

    const file =
      a.Timeframe === 'AI_5m'  ? f5  :
      a.Timeframe === 'AI_15m' ? f15 :
      a.Timeframe === 'AI_1h'  ? f1h : null;

    if (!file) return res.status(400).json({ error: 'Unsupported timeframe' });

    const rows = await readJsonArray(file);
    rows.push({ ...a, Zone: a.Alert === 'Buy' ? 'green' : 'red', ReceivedAt: new Date().toISOString() });
    await writeJsonArray(file, rows);

    io.emit(`alertsUpdate:${a.Timeframe}`, rows);
    res.json({ ok: true });
  });
}

module.exports = { initAlertHandler };
