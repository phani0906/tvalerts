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
const { startMarketDataUpdater, fetchPriceOnly } = require('./utils/marketData'); // dual-cadence updater
const { startPivotUpdater, getPivotSnapshot } = require('./utils/pivotUpdater');
const { getQuoteCached } = require('./utils/quoteService');

// ================== Config ==================
const PORT          = Number(process.env.PORT) || 2709;
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const TV_SECRET     = process.env.TV_SECRET || '';    // shared secret for /tv-webhook
const ADMIN_SECRET  = process.env.ADMIN_SECRET || ''; // shared secret for /admin/cleanup
const PIVOT_MS      = Number(process.env.PIVOT_CADENCE_MS) || 120000;

// Make sure DATA_DIR exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ================== App/Server/IO ==================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*'},
});

// -------- Middlewares --------
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static files (landing, scanner, css, client js)
app.use(express.static(path.join(__dirname, 'public')));

// ================== Health ==================
app.get('/health', (_req, res) => res.json({ ok: true }));

// ================== Quotes banner (top message) ==================
app.get('/quote', async (_req, res) => {
  try {
    const q = await getQuoteCached();
    res.json(q);
  } catch (e) {
    res.status(500).json({ error: 'quote_fetch_failed', details: String(e?.message || e) });
  }
});

// ================== Tolerance config for client ==================
const TOL = {
  pivot_mid: Number(process.env.TOL_PIVOT_MID || 1.0), // example tolerance used by UI hover/compare
};
app.get('/tolerance', (_req, res) => res.json(TOL));

// ================== Pivot snapshot (client can hydrate once) ==================
app.get('/pivot-snapshot', (_req, res) => {
  res.json(getPivotSnapshot());
});

// ================== TradingView Webhook ==================
/**
 * Factory expects:
 *   tvWebhookRouterFactory({ io, secret, dataDir })
 * Router:
 *   POST /tv-webhook?key=<secret>
 * Body:
 *   { Ticker, Timeframe, Alert, Time, ... }
 * It should append to alerts files in DATA_DIR and emit over socket as needed.
 */
app.use('/tv-webhook', tvWebhookRouterFactory({ io, secret: TV_SECRET, dataDir: DATA_DIR }));

// ================== Admin: Cleanup alert files ==================
/**
 * Truncates the three alert files under DATA_DIR:
 *   alerts_5m.json, alerts_15m.json, alerts_1h.json
 * Use:
 *   curl -X POST "https://<host>/admin/cleanup?key=<ADMIN_SECRET>"
 */
app.post('/admin/cleanup', async (req, res) => {
  try {
    const key = (req.query.key || '').trim();
    if (!ADMIN_SECRET) {
      return res.status(400).json({ error: 'ADMIN_SECRET not set' });
    }
    if (!key || key !== ADMIN_SECRET) {
      return res.status(403).json({ error: 'forbidden' });
    }

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

// ================== Simple routes for pages ==================
// Landing page (public/index.html) served by static middleware.
// Scanner page explicit path if you want a clean route:
app.get('/scanner', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scanner.html'));
});

// ================== Socket wiring ==================
io.on('connection', (socket) => {
  // Optionally send an initial quote on connect
  getQuoteCached().then(q => {
    socket.emit('quote', q);
  }).catch(() => { /* ignore */ });

  // You could also push an initial pivot snapshot here if desired:
  const snap = getPivotSnapshot();
  if (Array.isArray(snap) && snap.length) {
    socket.emit('pivotUpdate', snap);
  }
});

// ---- Start market data updater (pushes price/ma20/vwap/dayMid etc.) ----
// Your marketData util should internally emit to io as it refreshes.
// If it needs a callback, wire it here; otherwise just start with io.
startMarketDataUpdater(io, {
  // optional overrides via env:
  // fastMs: Number(process.env.MD_FAST_MS) || 10_000,
  // slowMs: Number(process.env.MD_SLOW_MS) || 60_000,
});

// ---- Start pivot updater (now emits PDH as well) ----
startPivotUpdater(io, { cadenceMs: PIVOT_MS });

// ================== Start server ==================
server.listen(PORT, () => {
  console.log(`TVScanner listening on http://localhost:${PORT}`);
  console.log(`DATA_DIR: ${DATA_DIR}`);
});
