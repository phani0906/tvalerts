// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ---- Helpers (in utils/) ----
const { initAlertHandler } = require('./utils/alertHandler');
const { startMarketDataUpdater } = require('./utils/marketData');
const tvWebhookRouterFactory = require('./utils/tvWebhook');

// ---- App + Server + IO ----
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ---- Config ----
const PORT = process.env.PORT || 2709;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data'); // Render: /persist/tvalerts
const TV_SECRET = process.env.TV_SECRET || ''; // optional: protects /tv-webhook

// Ensure DATA_DIR exists (disk mount on Render or local ./data)
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.warn('[init] could not ensure DATA_DIR:', DATA_DIR, e.message);
}

// ---- Middleware ----
app.use(express.json({ limit: '1mb' }));
// If your UI is hosted elsewhere, you can enable CORS:
// const cors = require('cors');
// app.use(cors({ origin: '*', methods: ['GET','POST'] }));

// ---- Static files ----
app.use(express.static(PUBLIC_DIR));

// Serve scanner at root
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'scanner.html'));
});

// ---- Health ----
app.get('/health', (_req, res) => {
  res.status(200).send({ ok: true, time: new Date().toISOString() });
});

// ---- Socket.IO logging (optional) ----
io.on('connection', socket => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ---- Alerts endpoint (/sendAlert) ----
initAlertHandler(app, io, { dataDir: DATA_DIR });

// ---- TradingView webhook (/tv-webhook?key=TV_SECRET) ----
app.use(tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// ---- Price updater (emits priceUpdate) ----
startMarketDataUpdater(io, { dataDir: DATA_DIR, intervalMs: 5000 /* , includeExtraTF: true */ });

// ---- Start server ----
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`DATA_DIR: ${DATA_DIR}`);
  if (TV_SECRET) {
    console.log('TradingView webhook enabled at:  POST /tv-webhook?key=***');
  } else {
    console.warn('TV_SECRET is NOT set. /tv-webhook is unsecured (use only for local testing).');
  }
});
