// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ---- Modules you already have ----
const { initAlertHandler } = require('./server/alertHandler'); // your code pasted earlier
const { startMarketDataUpdater } = require('./server/marketData'); // your market data poller

// ---- (New) TradingView webhook router ----
const tvWebhookRouterFactory = require('./server/tvWebhook'); // see file contents below

// ---- App + Server + IO ----
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // loosen if your UI is on a different origin
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ---- Config ----
const PORT = process.env.PORT || 2709;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TV_SECRET = process.env.TV_SECRET || ''; // set in .env for webhook protection

// ---- Ensure data dir exists (for alerts.json) ----
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error('Failed to ensure data dir:', DATA_DIR, e);
}

// ---- Middlewares ----
app.use(express.json({ limit: '1mb' })); // parse JSON bodies
// If your UI runs on a different host/port, uncomment CORS:
// const cors = require('cors'); app.use(cors({ origin: '*' }));

// ---- Static files (your scanner: index/scanner.html, scanner.js, scanner.css, etc.) ----
app.use(express.static(PUBLIC_DIR));

// ---- Health check ----
app.get('/health', (req, res) => {
  res.status(200).send({ ok: true, time: new Date().toISOString() });
});

// ---- Socket.IO basic logging (optional) ----
io.on('connection', socket => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ---- Initialize your /sendAlert handler (from your file) ----
initAlertHandler(app, io);

// ---- Mount TradingView webhook route (/tv-webhook?key=TV_SECRET) ----
app.use(tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// ---- Start market data updater (emits priceUpdate) ----
startMarketDataUpdater(io);

// ---- Start server ----
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (TV_SECRET) {
    console.log('TradingView webhook enabled at:  POST /tv-webhook?key=***');
  } else {
    console.warn('TV_SECRET is NOT set. Set it in .env to secure /tv-webhook.');
  }
});
