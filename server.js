// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ---------- Crash guards ----------
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e?.stack || e);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e?.stack || e);
});

// ---------- Helpers ----------
const { initAlertHandler } = require('./utils/alertHandler');
const tvWebhookRouterFactory = require('./utils/tvWebhook');

let startMarketDataUpdater = null;
try {
  ({ startMarketDataUpdater } = require('./utils/marketData'));
  console.log('[boot] marketData module loaded');
} catch (e) {
  console.warn('[boot] marketData module NOT loaded:', e.message);
}

// ---------- Config ----------
const PORT      = process.env.PORT || 2709;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, 'data'); // e.g. /data on Render disk
const TV_SECRET  = process.env.TV_SECRET || ''; // optional but recommended

// Ensure DATA_DIR exists
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('[boot] DATA_DIR ready:', DATA_DIR);
} catch (e) {
  console.warn('[boot] could not ensure DATA_DIR:', DATA_DIR, e.message);
}

// ---------- App + Server + IO ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ---------- Middleware ----------
app.use(express.json({ limit: '1mb' }));
// TV can post text/plain; keep this to accept both JSON and text
app.use(express.text({ type: '*/*', limit: '1mb' }));

// ---------- Static ----------
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'scanner.html')));

// ---------- Health ----------
app.get('/health', (_req, res) => res.status(200).send({ ok: true, time: new Date().toISOString() }));

// ---------- Socket.IO logging ----------
io.on('connection', socket => {
  console.log('[socket] connected:', socket.id);
  socket.on('disconnect', () => console.log('[socket] disconnected:', socket.id));
});

// ---------- Alerts endpoints (read-only JSON for each TF) ----------
const f5  = path.join(DATA_DIR, 'alerts_5m.json');
const f15 = path.join(DATA_DIR, 'alerts_15m.json');
const f1h = path.join(DATA_DIR, 'alerts_1h.json');

// Serve the files directly so the browser can fetch them on load/refresh
app.get('/alerts/5m',  (_req, res) => res.sendFile(f5,  { headers: { 'Cache-Control': 'no-store' } }));
app.get('/alerts/15m', (_req, res) => res.sendFile(f15, { headers: { 'Cache-Control': 'no-store' } }));
app.get('/alerts/1h',  (_req, res) => res.sendFile(f1h, { headers: { 'Cache-Control': 'no-store' } }));

// ---------- Alert ingestion endpoints ----------
// 1) Internal simple POST used by your sendTestAlerts.js (writes + emits)
initAlertHandler(app, io, { dataDir: DATA_DIR });

// 2) TradingView webhook: POST /tv-webhook?key=TV_SECRET (if set)
//    This router will write to the per-timeframe files and emit:
//    - alertsUpdate:AI_5m
//    - alertsUpdate:AI_15m
//    - alertsUpdate:AI_1h
app.use(tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// ---------- Market data updater (emits priceUpdate) ----------
if (startMarketDataUpdater && process.env.DISABLE_MARKET !== '1') {
  console.log('[boot] starting market data updater');
  // includeExtraTF: true -> fetch MA/VWAP for 15m & 1h also
  startMarketDataUpdater(io, { dataDir: DATA_DIR, intervalMs: 5000, includeExtraTF: true });
} else {
  console.warn('[boot] market data updater DISABLED (missing module or DISABLE_MARKET=1)');
}

// ---------- Start ----------
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`DATA_DIR: ${DATA_DIR}`);
  if (TV_SECRET) {
    console.log('TradingView webhook enabled: POST /tv-webhook?key=***');
  } else {
    console.warn('TV_SECRET not set — /tv-webhook is unsecured (OK for local, not for prod).');
  }
});
