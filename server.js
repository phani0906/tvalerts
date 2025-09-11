// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');


// NOTE: your files live under ./utils
const tvWebhookRouterFactory = require('./utils/tvWebhook');
const { initAlertHandler }   = require('./utils/alertHandler');
const { startMarketDataUpdater, fetchTickerData } = require('./utils/marketData');

// ------- Config (matches your tree) -------
const PORT      = Number(process.env.PORT) || 2709;
const DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, 'data');
const TV_SECRET = process.env.TV_SECRET || ''; // optional shared secret

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('[boot] created DATA_DIR:', DATA_DIR);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.set('trust proxy', 1);
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.text({ type: ['text/*','application/json'], limit: '1mb' }));

// ------- Static site from ./public -------
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// landing -> public/scanner.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'scanner.html'));
});

// ------- Alerts API (readers + test sender) -------
initAlertHandler(app, io, { dataDir: DATA_DIR });

// ------- TradingView webhook -------
app.use('/', tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// ------- Market data emitter (Price/MA20/VWAP/DayMid) -------
startMarketDataUpdater(io, { dataDir: DATA_DIR, intervalMs: 5000 });

// ------- Debug helper -------
// GET /debug/fetch?t=NVDA
app.get('/debug/fetch', async (req, res) => {
  try {
    const t = String(req.query.t || '').trim().toUpperCase();
    if (!t) return res.status(400).json({ error: 'Pass ?t=TICKER' });
    const out = await fetchTickerData(t);
    res.json({ ticker: t, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Admin cleanup endpoint ---
// POST /admin/cleanup?key=ADMIN_SECRET
// Optional JSON: { timeframe: "AI_5m" | "AI_15m" | "AI_1h" } to wipe just one
const fsPromises = require('fs').promises;
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

app.post('/admin/cleanup', async (req, res) => {
  try {
    if (!ADMIN_SECRET) return res.status(500).json({ error: 'ADMIN_SECRET not set' });
    const key = req.query.key || req.headers['x-admin-key'];
    if (key !== ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    const tf = (req.body && req.body.timeframe) || null;

    const files = {
      AI_5m:  path.join(DATA_DIR, 'alerts_5m.json'),
      AI_15m: path.join(DATA_DIR, 'alerts_15m.json'),
      AI_1h:  path.join(DATA_DIR, 'alerts_1h.json')
    };

    const toClear = tf ? { [tf]: files[tf] } : files;

    // wipe files (write empty array)
    const ops = [];
    for (const [k, file] of Object.entries(toClear)) {
      if (!file) continue;
      ops.push(fsPromises.writeFile(file, '[]'));
    }
    await Promise.all(ops);

    // notify clients to clear tables
    if (!tf || tf === 'AI_5m')  io.emit('alertsUpdate:AI_5m',  []);
    if (!tf || tf === 'AI_15m') io.emit('alertsUpdate:AI_15m', []);
    if (!tf || tf === 'AI_1h')  io.emit('alertsUpdate:AI_1h',  []);

    // optional: clear price panel (not required, but tidy)
    io.emit('priceUpdate', {});

    return res.json({ ok: true, cleared: Object.keys(toClear) });
  } catch (e) {
    console.error('[cleanup] error:', e);
    return res.status(500).json({ error: e.message });
  }
});


// optional socket logs
io.on('connection', s => {
  console.log('[socket] connected', s.id);
  s.on('disconnect', () => console.log('[socket] disconnected', s.id));
});

server.listen(PORT, () => {
  console.log(`[boot] http://localhost:${PORT}  DATA_DIR=${DATA_DIR}`);
  if (TV_SECRET) console.log('[boot] TV webhook requires ?key=***');
});
