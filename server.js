// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ---------- Crash guards ----------
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e && e.stack || e);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e && e.stack || e);
});

// ---------- Helpers ----------
const { initAlertHandler } = require('./utils/alertHandler');
const tvWebhookRouterFactory = require('./utils/tvWebhook');

// Market data is optional at boot so the app still serves even if deps are missing
let startMarketDataUpdater = null;
let marketDataModule = null;
try {
  marketDataModule = require('./utils/marketData');
  startMarketDataUpdater = marketDataModule.startMarketDataUpdater;
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
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data'); // e.g. /data on Render
const TV_SECRET = process.env.TV_SECRET || ''; // optional

// Ensure DATA_DIR exists
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('[boot] DATA_DIR ready:', DATA_DIR);
} catch (e) {
  console.warn('[boot] could not ensure DATA_DIR:', DATA_DIR, e.message);
}

// ---------- Middleware ----------
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: '*/*', limit: '1mb' })); // handles text/plain from TV

// ---------- Static ----------
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'scanner.html')));

// ---------- Health ----------
app.get('/health', (_req, res) =>
  res.status(200).send({ ok: true, time: new Date().toISOString() })
);

// ---------- Socket.IO logging ----------
io.on('connection', socket => {
  console.log('[socket] connected:', socket.id);
  socket.on('disconnect', () => console.log('[socket] disconnected:', socket.id));
});

// ---------- Alerts endpoint (/sendAlert) ----------
initAlertHandler(app, io, { dataDir: DATA_DIR });

// ---------- TradingView webhook (/tv-webhook?key=TV_SECRET) ----------
app.use(tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// ---------- Debug endpoints (safe to keep in prod) ----------
app.get('/debug/tickers', (req, res) => {
  try {
    const load = name => {
      const p = path.join(DATA_DIR, name);
      if (!fs.existsSync(p)) return [];
      const raw = fs.readFileSync(p, 'utf8').trim();
      return raw ? JSON.parse(raw) : [];
    };
    const a5  = load('alerts_5m.json');
    const a15 = load('alerts_15m.json');
    const a1h = load('alerts_1h.json');
    const tickers = [...new Set([...a5, ...a15, ...a1h].map(a => a.Ticker).filter(Boolean))];

    res.json({
      dataDir: DATA_DIR,
      counts: { '5m': a5.length, '15m': a15.length, '1h': a1h.length },
      tickers
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Single-ticker on-demand fetch to verify Yahoo access from Render
app.get('/debug/fetch', async (req, res) => {
  try {
    if (!marketDataModule?.fetchTickerData) {
      return res.status(500).json({ error: 'marketData not loaded' });
    }
    const t = String(req.query.t || 'AAPL').toUpperCase();
    const data = await marketDataModule.fetchTickerData(t);
    res.json({ ticker: t, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Price updater ----------
if (startMarketDataUpdater && process.env.DISABLE_MARKET !== '1') {
  console.log('[boot] starting market data updater');
  startMarketDataUpdater(io, { dataDir: DATA_DIR, intervalMs: 5000 });
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
