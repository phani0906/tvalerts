// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ---------- Helpers (in ./utils) ----------
const { initAlertHandler } = require('./utils/alertHandler');
const tvWebhookRouterFactory = require('./utils/tvWebhook');

// Market data is optional at boot so the app still serves if that module fails
let startMarketDataUpdater = null;
try {
  ({ startMarketDataUpdater } = require('./utils/marketData'));
} catch (e) {
  console.warn('[boot] marketData module not loaded (will skip updater):', e.message);
}

// ---------- App + Server + IO ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ---------- Config ----------
const PORT = process.env.PORT || 2709;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data'); // e.g. Render disk: /persist/tvalerts
const TV_SECRET = process.env.TV_SECRET || ''; // optional secret for /tv-webhook

// Ensure DATA_DIR exists (works for local ./data or mounted disk path)
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.warn('[init] could not ensure DATA_DIR:', DATA_DIR, e.message);
}

// ---------- Middleware ----------
app.use(express.json({ limit: '1mb' }));
// If your UI is on a different origin, you can enable CORS globally:
// const cors = require('cors');
// app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));

// ---------- Static files ----------
app.use(express.static(PUBLIC_DIR));

// Serve scanner at root
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'scanner.html'));
});

// Health check
app.get('/health', (_req, res) => {
  res.status(200).send({ ok: true, time: new Date().toISOString() });
});

// ---------- Socket.IO logging (optional) ----------
io.on('connection', socket => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ---------- Alerts endpoint (/sendAlert) ----------
initAlertHandler(app, io, { dataDir: DATA_DIR });

// ---------- TradingView webhook (/tv-webhook?key=TV_SECRET) ----------
app.use(tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// ---------- Price updater (emits priceUpdate) ----------
if (startMarketDataUpdater && process.env.DISABLE_MARKET !== '1') {
  startMarketDataUpdater(io, { dataDir: DATA_DIR, intervalMs: 5000 /* , includeExtraTF: true */ });
} else {
  console.warn('[boot] market data updater disabled');
}

// ---------- Start server ----------
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`DATA_DIR: ${DATA_DIR}`);
  if (TV_SECRET) {
    console.log('TradingView webhook enabled at:  POST /tv-webhook?key=***');
  } else {
    console.warn('TV_SECRET is NOT set. /tv-webhook is unsecured (use only for local testing).');
  }
});
