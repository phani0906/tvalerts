// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ---------- Crash guards ----------
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

// ---------- App / IO ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

// ---------- Config ----------
const PORT = process.env.PORT || 2709;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TV_SECRET = process.env.TV_SECRET || ''; // optional for /tv-webhook

// Ensure data dir
fs.mkdirSync(DATA_DIR, { recursive: true });
console.log('[boot] DATA_DIR:', DATA_DIR);

// File paths per timeframe
const FILES = {
  'AI_5m':  path.join(DATA_DIR, 'alerts_5m.json'),
  'AI_15m': path.join(DATA_DIR, 'alerts_15m.json'),
  'AI_1h':  path.join(DATA_DIR, 'alerts_1h.json'),
};

// ---------- Middleware ----------
app.use(express.json({ limit: '1mb' }));
// TradingView often sends text/plain
app.use(express.text({ type: '*/*', limit: '1mb' }));

// ---------- Static ----------
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'scanner.html')));

// ---------- Health ----------
app.get('/health', (_req, res) => res.status(200).send({ ok: true, time: new Date().toISOString() }));

// ---------- Socket logging ----------
io.on('connection', s => {
  console.log('[socket] connected', s.id);
  s.on('disconnect', () => console.log('[socket] disconnected', s.id));
});

// ---------- Helpers ----------
async function readJsonSafe(file) {
  try {
    const txt = await fsp.readFile(file, 'utf8');
    if (!txt.trim()) return [];
    return JSON.parse(txt);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    console.warn('[readJsonSafe] error', file, e.message);
    return [];
  }
}

async function writeJsonSafe(file, data) {
  try {
    await fsp.writeFile(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[writeJsonSafe] error', file, e);
  }
}

function normalizeAlert(raw) {
  // Accept either object or JSON string
  let a = raw;
  if (typeof a === 'string') {
    try { a = JSON.parse(a); } catch { a = {}; }
  }
  // Expected fields
  const out = {
    Ticker: String(a.Ticker || a.ticker || '').toUpperCase(),
    Timeframe: a.Timeframe || a.timeframe || '',
    Alert: a.Alert || a.alert || '',
    Time: a.Time || a.time || '',
    ReceivedAt: new Date().toISOString(),
  };
  // auto zone
  out.Zone = (/buy/i.test(out.Alert) ? 'green' : 'red');
  return out;
}

function timeframeToFile(tf) {
  if (tf === 'AI_5m') return FILES['AI_5m'];
  if (tf === 'AI_15m') return FILES['AI_15m'];
  if (tf === 'AI_1h') return FILES['AI_1h'];
  return null;
}

function timeframeToChannel(tf) {
  return `alertsUpdate:${tf}`;
}

async function appendAlert(alert) {
  const file = timeframeToFile(alert.Timeframe);
  if (!file) throw new Error('Unsupported timeframe: ' + alert.Timeframe);

  const list = await readJsonSafe(file);
  list.push(alert);

  // optional: dedupe by Ticker keeping latest
  const map = new Map();
  list.forEach(r => {
    const prev = map.get(r.Ticker);
    if (!prev) { map.set(r.Ticker, r); return; }
    const tNew = r.ReceivedAt ? Date.parse(r.ReceivedAt) : 0;
    const tOld = prev.ReceivedAt ? Date.parse(prev.ReceivedAt) : 0;
    if (tNew >= tOld) map.set(r.Ticker, r);
  });
  const deduped = Array.from(map.values());

  await writeJsonSafe(file, deduped);
  io.emit(timeframeToChannel(alert.Timeframe), deduped);
  return deduped;
}

// ---------- Manual test endpoint ----------
app.post('/sendAlert', async (req, res) => {
  try {
    // body might be object (json) or string (text)
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!payload || !payload.Ticker || !payload.Timeframe || !payload.Alert) {
      return res.status(400).send({ error: 'Invalid alert format' });
    }
    const alert = normalizeAlert(payload);
    const data = await appendAlert(alert);
    return res.status(200).send({ success: true, storedCount: data.length });
  } catch (e) {
    console.error('[sendAlert] error', e);
    return res.status(500).send({ error: 'Server error' });
  }
});

// ---------- TradingView webhook ----------
app.post('/tv-webhook', async (req, res) => {
  try {
    // Optional secret gate via query param ?key=
    if (TV_SECRET && req.query.key !== TV_SECRET) {
      return res.status(401).send({ error: 'Unauthorized' });
    }
    // TradingView sends text/plain JSON
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!payload || !payload.Ticker || !payload.Timeframe || !payload.Alert) {
      return res.status(400).send({ error: 'Invalid TradingView alert payload' });
    }
    const alert = normalizeAlert(payload);
    const data = await appendAlert(alert);
    return res.status(200).send({ ok: true, storedCount: data.length });
  } catch (e) {
    console.error('[tv-webhook] error', e);
    return res.status(500).send({ error: 'Server error' });
  }
});

// ---------- Read endpoints for each timeframe ----------
app.get('/alerts/5m', async (_req, res) => {
  const data = await readJsonSafe(FILES['AI_5m']);
  res.status(200).json(data);
});
app.get('/alerts/15m', async (_req, res) => {
  const data = await readJsonSafe(FILES['AI_15m']);
  res.status(200).json(data);
});
app.get('/alerts/1h', async (_req, res) => {
  const data = await readJsonSafe(FILES['AI_1h']);
  res.status(200).json(data);
});

// ---------- Start ----------
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  if (TV_SECRET) console.log('TradingView Webhook: POST /tv-webhook?key=***');
  else console.log('TradingView Webhook: POST /tv-webhook (no secret)');
});
