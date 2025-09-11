// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Crash guards
process.on('uncaughtException', e => console.error('[uncaughtException]', e && e.stack || e));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e && e.stack || e));

// Helpers
const { initAlertHandler } = require('./utils/alertHandler');
const tvWebhookRouterFactory = require('./utils/tvWebhook');

let startMarketDataUpdater = null;
try {
  ({ startMarketDataUpdater } = require('./utils/marketData'));
  console.log('[boot] marketData module loaded');
} catch (e) {
  console.warn('[boot] marketData module NOT loaded:', e.message);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

// Config
const PORT = process.env.PORT || 2709;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TV_SECRET = process.env.TV_SECRET || '';

// Ensure data dir
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('[boot] DATA_DIR ready:', DATA_DIR);
} catch (e) {
  console.warn('[boot] could not ensure DATA_DIR:', DATA_DIR, e.message);
}

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: '*/*', limit: '1mb' })); // TradingView can send text/plain

// Static
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'scanner.html')));

// Health
app.get('/health', (_req, res) => res.status(200).send({ ok: true, time: new Date().toISOString() }));

// Socket log
io.on('connection', socket => {
  console.log('[socket] connected:', socket.id);
  socket.on('disconnect', () => console.log('[socket] disconnected:', socket.id));
});

// Alerts endpoints (/sendAlert + /alerts/*)
initAlertHandler(app, io, { dataDir: DATA_DIR });

// TradingView webhook (optional secret)
app.use(tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// Market data updater (emits priceUpdate)
if (startMarketDataUpdater && process.env.DISABLE_MARKET !== '1') {
  console.log('[boot] starting market data updater');
  startMarketDataUpdater(io, {
    dataDir: DATA_DIR,
    intervalMs: 5000,
    includeExtraTF: true  // we need MA/VWAP for 5m/15m/1h tables
  });
} else {
  console.warn('[boot] market data updater DISABLED (missing module or DISABLE_MARKET=1)');
}

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`DATA_DIR: ${DATA_DIR}`);
  if (TV_SECRET) console.log('TradingView webhook: POST /tv-webhook?key=***');
  else console.warn('TV_SECRET not set — /tv-webhook is OPEN (ok for local).');
});
