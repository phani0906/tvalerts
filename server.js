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

// ---------- Helpers (in ./utils) ----------
const { initAlertHandler } = require('./utils/alertHandler');
const tvWebhookRouterFactory = require('./utils/tvWebhook');

// Optional market data
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
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data'); // persistent dir on Render
const TV_SECRET = process.env.TV_SECRET || ''; // optional

// Ensure DATA_DIR exists
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('[boot] DATA_DIR ready:', DATA_DIR);
} catch (e) {
  console.warn('[boot] could not ensure DATA_DIR:', DATA_DIR, e.message);
}

// Path to alerts store
const alertsFilePath = path.join(DATA_DIR, 'alerts.json');

// Small helper to read the current snapshot safely
function readAlertsSnapshot() {
  try {
    if (!fs.existsSync(alertsFilePath)) return [];
    const raw = fs.readFileSync(alertsFilePath, 'utf8').trim();
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('readAlertsSnapshot error:', e);
    return [];
  }
}

// ---------- Middleware ----------
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: '*/*', limit: '1mb' })); // handles text/plain from TradingView

// ---------- Static ----------
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'scanner.html')));

// ---------- Health ----------
app.get('/health', (_req, res) => res.status(200).send({ ok: true, time: new Date().toISOString() }));

// ---------- Snapshot API (debug / page bootstrap) ----------
// Add/replace your /alerts route in server.js
app.get('/alerts', (req, res) => {
  try {
    const tf = (req.query.tf || 'AI_5m').toUpperCase();
    const tfNorm = tf === 'AI_5M' ? 'AI_5m' : tf === 'AI_15M' ? 'AI_15m' : tf === 'AI_1H' ? 'AI_1h' : tf;
    const fileMap = {
      'AI_5m':  path.join(DATA_DIR, 'alerts_5m.json'),
      'AI_15m': path.join(DATA_DIR, 'alerts_15m.json'),
      'AI_1h':  path.join(DATA_DIR, 'alerts_1h.json'),
    };
    const file = fileMap[tfNorm] || path.join(DATA_DIR, 'alerts_other.json');

    if (!fs.existsSync(file)) return res.json([]);
    const raw = fs.readFileSync(file, 'utf8').trim();
    const data = raw ? JSON.parse(raw) : [];
    res.json(data);
  } catch (e) {
    console.error('Error reading alerts:', e);
    res.status(500).json({ error: 'Failed to read alerts' });
  }
});


app.get('/alerts/5m', (req, res) => {
  const file = path.join(DATA_DIR, 'alerts_5m.json');
  fs.readFile(file, 'utf8', (err, data) => {
    if (err) {
      return res.status(404).send({ error: 'No alerts_5m.json yet' });
    }
    try {
      res.json(JSON.parse(data));
    } catch (e) {
      res.status(500).send({ error: 'Invalid JSON' });
    }
  });
});



// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  console.log('[socket] connected:', socket.id);

  // Immediately send the latest snapshot so the UI has data even
  // when no new alerts are firing.
  socket.emit('alertsUpdate', readAlertsSnapshot());

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
