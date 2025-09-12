// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');

// ---- utils (your paths) ----
const tvWebhookRouterFactory = require('./utils/tvWebhook');
const { initAlertHandler }   = require('./utils/alertHandler');
const marketData             = require('./utils/marketData'); // exposes pollAndEmit + _internals

// ================== Config ==================
const PORT          = Number(process.env.PORT) || 2709;
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const TV_SECRET     = process.env.TV_SECRET || '';    // shared secret for /tv-webhook?key=
const ADMIN_SECRET  = process.env.ADMIN_SECRET || ''; // admin key for /admin/cleanup

// Symbols & timeframes (comma-separated env supported)
const SYMBOLS = (process.env.SYMBOLS || 'AFRM,MP,AMAT,FIVE,MU,AMD,NVDA,PLTR,HOOD,HIMS,MRVL,ANET')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const TFS = (process.env.TFS || '5m,15m,1h')
  .split(',').map(s => s.trim()).filter(Boolean);

// Poll cadence (marketData has its own caching/backoff)
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);

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
  res.json({ ok: true, ts: new Date().toISOString(), symbols: SYMBOLS.length, tfs: TFS });
});

// ================== Alerts (readers + test sender) ==================
initAlertHandler(app, io, { dataDir: DATA_DIR });

// ================== TradingView webhook ==================
app.use('/', tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// ================== Market Data (Price/MA20/VWAP/DayMid) ==================
// IMPORTANT: the client expects a TICKER→metrics MAP on `priceUpdate`,
// not a single-ticker payload. We keep a process-wide snapshot and emit it.
const priceSnapshot = {}; // { TICKER: { Price, DayMid, MA20_5m, VWAP_5m, MA20_15m, VWAP_15m, MA20_1h, VWAP_1h } }

function ensureRow(ticker) {
  if (!priceSnapshot[ticker]) {
    priceSnapshot[ticker] = {
      Price: null,
      DayMid: null,
      MA20_5m: null,  VWAP_5m: null,
      MA20_15m: null, VWAP_15m: null,
      MA20_1h: null,  VWAP_1h: null
    };
  }
  return priceSnapshot[ticker];
}

let pollRunning = false;
async function runPollOnce() {
  if (pollRunning) return;
  pollRunning = true;
  try {
    await marketData.pollAndEmit({
      symbols: SYMBOLS,
      tfs: TFS,
      onUpdate: ({ ticker, timeframe, price, ma20, vwap, dayMid /*, stale */ }) => {
        const T = String(ticker || '').toUpperCase();
        const row = ensureRow(T);

        if (price != null)  row.Price  = price;
        if (dayMid != null) row.DayMid = dayMid;

        if (timeframe === '5m')  { row.MA20_5m  = ma20; row.VWAP_5m  = vwap; }
        if (timeframe === '15m') { row.MA20_15m = ma20; row.VWAP_15m = vwap; }
        if (timeframe === '1h')  { row.MA20_1h  = ma20; row.VWAP_1h  = vwap; }

        // Emit the WHOLE snapshot (what the browser expects)
        io.emit('priceUpdate', priceSnapshot);
      }
    });
  } catch (e) {
    console.warn('[marketData] poll error:', e.message || e);
  } finally {
    pollRunning = false;
  }
}

function schedulePolling() {
  runPollOnce().finally(() => setTimeout(schedulePolling, POLL_INTERVAL_MS));
}
schedulePolling();

// ================== Debug helper ==================
// GET /debug/fetch?t=NVDA&tf=15m
app.get('/debug/fetch', async (req, res) => {
  try {
    const t = String(req.query.t || '').trim().toUpperCase();
    const tf = String(req.query.tf || '15m').trim();
    if (!t) return res.status(400).json({ error: 'Pass ?t=TICKER [&tf=5m|15m|1h]' });

    const calcFor = marketData._internals?.calcFor;
    if (typeof calcFor !== 'function') {
      return res.status(500).json({ error: 'calcFor not available' });
    }
    const row = await calcFor(t, tf);
    res.json(row);
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

    // wipe files (write empty array)
    await Promise.all(
      Object.values(toClear).filter(Boolean).map(f => fsPromises.writeFile(f, '[]'))
    );

    // notify clients to clear tables
    if (!tf || tf === 'AI_5m')  io.emit('alertsUpdate:AI_5m',  []);
    if (!tf || tf === 'AI_15m') io.emit('alertsUpdate:AI_15m', []);
    if (!tf || tf === 'AI_1h')  io.emit('alertsUpdate:AI_1h',  []);

    // Optionally clear price snapshot too (so UI blanks until next poll)
    // Object.keys(priceSnapshot).forEach(k => delete priceSnapshot[k]);
    io.emit('priceUpdate', priceSnapshot);

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
  console.log(`[boot] symbols=${SYMBOLS.join(', ')}  tfs=${TFS.join(', ')}  poll=${POLL_INTERVAL_MS}ms`);
  if (TV_SECRET) console.log('[boot] TV webhook requires ?key=***');
});
