// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const cors = require('cors');

// ---- utils ----
const tvWebhookRouterFactory = require('./utils/tvWebhook');
const { initAlertHandler }   = require('./utils/alertHandler');
const { startMarketDataUpdater, fetchPriceOnly } = require('./utils/marketData');
const { startPivotUpdater, getLatestPivotRows }  = require('./utils/pivotUpdater');
const { getQuoteCached }     = require('./utils/quoteService');

// ================== Config ==================
const PORT          = Number(process.env.PORT) || 2709;
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const TV_SECRET     = process.env.TV_SECRET || '';    // shared secret for /tv-webhook
const ADMIN_SECRET  = process.env.ADMIN_SECRET || ''; // shared secret for /admin/cleanup
const PIVOT_MS      = Number(process.env.PIVOT_CADENCE_MS) || 120000;

// Ensure DATA_DIR
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ================== App/Server/IO ==================
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// -------- Middlewares --------
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static (index.html, scanner.html, css/js/images)
app.use(express.static(path.join(__dirname, 'public')));

// ================== Health ==================
app.get('/health', (_req, res) => res.json({ ok: true }));

// ================== Quotes ==================
app.get('/quote', async (_req, res) => {
  try {
    const q = await getQuoteCached();
    res.json(q);
  } catch (e) {
    res.status(500).json({ error: 'quote_fetch_failed', details: String(e?.message || e) });
  }
});

// ================== Tolerance for pivotPanel ==================
const TOL = { pivot_mid: Number(process.env.TOL_PIVOT_MID || 1.0) };
app.get('/tolerance', (_req, res) => res.json(TOL));

// ================== Pivot snapshot (pivotPanel boot) ==================
app.get('/pivot/latest', (_req, res) => {
  res.json(getLatestPivotRows());
});

// ================== Alerts REST + Socket wiring ==================
initAlertHandler(app, io, { dataDir: DATA_DIR });

// ================== TradingView Webhook ==================
// FIX: tvWebhook expects (io, { tvSecret, dataDir }) and defines route '/tv-webhook' internally.
// Mount at root so final endpoint is POST /tv-webhook?key=SECRET
app.use('/', tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// ================== Admin: Cleanup alert files ==================
app.post('/admin/cleanup', async (req, res) => {
  try {
    const key = (req.query.key || '').trim();
    if (!ADMIN_SECRET) return res.status(400).json({ error: 'ADMIN_SECRET not set' });
    if (key !== ADMIN_SECRET) return res.status(403).json({ error: 'forbidden' });

    const files = ['alerts_5m.json', 'alerts_15m.json', 'alerts_1h.json'];
    await Promise.all(files.map(async f => {
      const fp = path.join(DATA_DIR, f);
      await fsPromises.writeFile(fp, '[]', 'utf8'); // reset to empty array
    }));

    res.json({ ok: true, cleared: files });
  } catch (e) {
    res.status(500).json({ error: 'cleanup_failed', details: String(e?.message || e) });
  }
});

// Nice route to load scanner directly (also served by static)
app.get('/scanner', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scanner.html'));
});

app.get('/bullishContinuation', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'bullishContinuation.html'));
});


// ================== Socket.io ==================
io.on('connection', (socket) => {
  // push a quote and the latest pivots on connect
  getQuoteCached().then(q => socket.emit('quote', q)).catch(() => {});
  const snap = getLatestPivotRows();
  if (Array.isArray(snap) && snap.length) socket.emit('pivotUpdate', snap);
});

// ================== Updaters ==================
// Prices/MA/VWAP/DayMid snapshots
startMarketDataUpdater(io, {
  dataDir: DATA_DIR,                // IMPORTANT: pass dataDir so it can read tickers
  // fastMs: Number(process.env.MD_FAST_MS) || 5000,
  // slowMs: Number(process.env.MD_SLOW_MS) || 60000,
});

// Pivots (includes PDH via utils/pivotUpdater.js)
startPivotUpdater(io, { intervalMs: PIVOT_MS });

// ================== Start ==================
server.listen(PORT, () => {
  console.log(`TVScanner on http://localhost:${PORT}`);
  console.log(`DATA_DIR: ${DATA_DIR}`);
});
