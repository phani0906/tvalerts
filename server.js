// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ---------- Crash guards: log everything ----------
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e && e.stack || e);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e && e.stack || e);
});

// ---------- Helpers (in ./utils) ----------
const { initAlertHandler } = require('./utils/alertHandler');
const tvWebhookRouterFactory = require('./utils/tvWebhook');

// Market data is optional at boot so the app still serves even if deps are missing
let startMarketDataUpdater = null;
try {
  ({ startMarketDataUpdater } = require('./utils/marketData'));
  console.log('[boot] marketData module loaded');
} catch (e) {
  console.warn('[boot] marketData module NOT loaded:', e.message);
}

// ---------- App + Server + IO ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

// ---------- Config ----------
const PORT = process.env.PORT || 2709;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data'); // e.g. /persist/tvalerts on Render
const TV_SECRET = process.env.TV_SECRET || ''; // optional

// Ensure DATA_DIR exists (works with local folder or mounted disk)
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('[boot] DATA_DIR ready:', DATA_DIR);
} catch (e) {
  console.warn('[boot] could not ensure DATA_DIR:', DATA_DIR, e.message);
}

// ---------- Middleware ----------
app.use(express.json({ limit: '1mb' }));

// ---------- Static files ----------
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'scanner.html')));

// ---------- Health ----------
app.get('/health', (_req, res) => res.status(200).send({ ok: true, time: new Date().toISOString() }));

// ---------- Socket.IO logging ----------
io.on('connection', socket => {
  console.log('[socket] connected:', socket.id);
  socket.on('disconnect', () => console.log('[socket] disconnected:', socket.id));
});

// ---------- Alerts endpoint (/sendAlert) ----------
initAlertHandler(app, io, { dataDir: DATA_DIR });

// ---------- TradingView webhook (/tv-webhook?key=TV_SECRET) ----------
app.use(tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// ---------- Price updater (emits priceUpdate) ----------
if (startMarketDataUpdater && process.env.DISABLE_MARKET !== '1') {
  console.log('[boot] starting market data updater');
  startMarketDataUpdater(io, { dataDir: DATA_DIR, intervalMs: 5000 /* , includeExtraTF: true */ });
} else {
  console.warn('[boot] market data updater DISABLED (missing module or DISABLE_MARKET=1)');
}

// ---------- Start server ----------
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`DATA_DIR: ${DATA_DIR}`);
  if (TV_SECRET) console.log('TradingView webhook: POST /tv-webhook?key=***');
  else console.warn('TV_SECRET not set — /tv-webhook is unsecured (ok for local).');
});
