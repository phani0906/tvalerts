// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');

// ---- utils ----
const tvWebhookRouterFactory = require('./utils/tvWebhook');
const { initAlertHandler }   = require('./utils/alertHandler');
const { startMarketDataUpdater, fetchPriceOnly } = require('./utils/marketData'); // dual-cadence updater

// ================== Config ==================
const PORT          = Number(process.env.PORT) || 2709;
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const TV_SECRET     = process.env.TV_SECRET || '';    // shared secret for /tv-webhook?key=
const ADMIN_SECRET  = process.env.ADMIN_SECRET || ''; // admin key for /admin/cleanup

// Symbols & timeframes (used only for health/debug logs)
const SYMBOLS = (process.env.SYMBOLS || 'AFRM,MP,AMAT,FIVE,MU,AMD,NVDA,PLTR,HOOD,HIMS,MRVL,ANET')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const TFS = (process.env.TFS || '5m,15m,1h')
  .split(',').map(s => s.trim()).filter(Boolean);

// Poll cadences (fast price, slow metrics)
const FAST_PRICE_MS  = Number(process.env.MD_FAST_MS || 5000);    // ~5s
const SLOW_METRIC_MS = Number(process.env.MD_SLOW_MS || 60000);   // ~60s

// Ensure data dir is writable
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('[boot] created DATA_DIR:', DATA_DIR);
}

// ================== App/Server ==================
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.set('trust proxy', 1);
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.text({ type: ['text/*','application/json'], limit: '1mb' }));

// Static site
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// Landing → scanner.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'scanner.html'));
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    symbols: SYMBOLS.length,
    tfs: TFS,
    fastMs: FAST_PRICE_MS,
    slowMs: SLOW_METRIC_MS
  });
});

// ================== Alerts (readers + test sender) ==================
initAlertHandler(app, io, { dataDir: DATA_DIR });

// ================== TradingView webhook ==================
app.use('/', tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// ================== Market Data (dual cadence) ==================
// Emits full snapshot objects on every pass (fast price, slow metrics).
startMarketDataUpdater(io, { dataDir: DATA_DIR, fastMs: FAST_PRICE_MS, slowMs: SLOW_METRIC_MS });

// ================== Debug helper ==================
// GET /debug/price?t=NVDA
app.get('/debug/price', async (req, res) => {
  try {
    const t = String(req.query.t || '').trim().toUpperCase();
    if (!t) return res.status(400).json({ error: 'Pass ?t=TICKER' });
    const price = await fetchPriceOnly(t);
    res.json({ ticker: t, price });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ================== Admin cleanup ==================
// POST /admin/cleanup?key=ADMIN_SECRET
// Optional JSON: { timeframe: "AI_5m" | "AI_15m" | "AI_1h" }
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

    await Promise.all(
      Object.values(toClear).filter(Boolean).map(f => fsPromises.writeFile(f, '[]'))
    );

    if (!tf || tf === 'AI_5m')  io.emit('alertsUpdate:AI_5m',  []);
    if (!tf || tf === 'AI_15m') io.emit('alertsUpdate:AI_15m', []);
    if (!tf || tf === 'AI_1h')  io.emit('alertsUpdate:AI_1h',  []);

    io.emit('priceUpdate', {}); // harmless nudge; updater will repopulate
    return res.json({ ok: true, cleared: Object.keys(toClear) });
  } catch (e) {
    console.error('[cleanup] error:', e);
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ================== Sockets ==================
io.on('connection', s => {
  console.log('[socket] connected', s.id);
  s.on('disconnect', () => console.log('[socket] disconnected', s.id));
});

// ================== Start ==================
server.listen(PORT, () => {
  console.log(`[boot] http://localhost:${PORT}  DATA_DIR=${DATA_DIR}`);
  console.log(`[boot] symbols=${SYMBOLS.join(', ')}  tfs=${TFS.join(', ')}`);
  console.log(`[boot] price every ${FAST_PRICE_MS}ms, metrics every ${SLOW_METRIC_MS}ms`);
  if (TV_SECRET) console.log('[boot] TV webhook requires ?key=***');
});
