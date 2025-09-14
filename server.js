// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const { getQuoteCached } = require('./utils/quoteService');

// ---- utils ----
const tvWebhookRouterFactory = require('./utils/tvWebhook');
const { initAlertHandler }   = require('./utils/alertHandler');
const { startMarketDataUpdater, fetchPriceOnly } = require('./utils/marketData'); // dual-cadence updater
const { startPivotUpdater, getPivotSnapshot } = require('./utils/pivotUpdater');

// ================== Config ==================
const PORT          = Number(process.env.PORT) || 2709;
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const TV_SECRET     = process.env.TV_SECRET || '';    // shared secret for /tv-webhook?key=
const ADMIN_SECRET  = process.env.ADMIN_SECRET || ''; // admin key for /admin/cleanup

// Web auth (set these in env)
const BASIC_USER   = process.env.BASIC_USER || '';
const BASIC_PASS   = process.env.BASIC_PASS || '';
const BASIC_TOKEN  = process.env.BASIC_TOKEN || ''; // optional single-password mode

// Symbols & timeframes (used only for health/debug logs)
const SYMBOLS = (process.env.SYMBOLS || 'AFRM,MP,AMAT,FIVE,MU,AMD,NVDA,PLTR,HOOD,HIMS,MRVL,ANET')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const TFS = (process.env.TFS || '5m,15m,1h')
  .split(',').map(s => s.trim()).filter(Boolean);

// Pivot/CPR fixed ticker list (for the top summary table)
const PIVOT_TICKERS = (process.env.PIVOT_TICKERS || 'NVDA,AMD,TSLA,AAPL,MSFT')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

// Poll cadences (fast price, slow metrics)
const FAST_PRICE_MS  = Number(process.env.MD_FAST_MS || 5000);    // ~5s
const SLOW_METRIC_MS = Number(process.env.MD_SLOW_MS || 60000);   // ~60s

// ===== Blink tolerances exposed to the client (configure these in Render) =====
const TOLERANCE = {
  // 5m
  ma20_5m:    Number(process.env.TOL_MA20_5M    || 0.5),
  vwap_5m:    Number(process.env.TOL_VWAP_5M    || 0.5),
  daymid_5m:  Number(process.env.TOL_DAYMID_5M  || 1.0),
  // 15m
  ma20_15m:   Number(process.env.TOL_MA20_15M   || 1.0),
  vwap_15m:   Number(process.env.TOL_VWAP_15M   || 1.0),
  daymid_15m: Number(process.env.TOL_DAYMID_15M || 1.0),
  // 1h
  ma20_1h:    Number(process.env.TOL_MA20_1H    || 2.0),
  vwap_1h:    Number(process.env.TOL_VWAP_1H    || 2.0),
  daymid_1h:  Number(process.env.TOL_DAYMID_1H  || 1.0),
  // Pivot panel midpoint tolerance
  pivot_mid:  Number(process.env.TOL_PIVOT_MID  || 1.0)
};

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

// ================== Basic Auth (UI protection) ==================
function needsAuth(req) {
  // Open (unauthenticated) endpoints — adjust to your taste
  const openExact = new Set([
    '/',              // public landing page (index.html)
    '/health',
    '/logout',        // returns 401 to clear creds; keep open
  ]);
  const openPrefixes = [
    '/tv-webhook',    // TradingView webhook receiver
    '/alerts',        // JSON alerts feed (leave open if you want)
    '/admin/cleanup', // gated by ADMIN_SECRET; can also be removed here to require Basic
  ];

  if (openExact.has(req.path)) return false;
  if (openPrefixes.some(p => req.path.startsWith(p))) return false;

  // Everything else (UI pages like /scanner.html, /pivot/*, /tolerance, /quote, static assets) requires auth
  return true;
}

function parseBasic(headerVal) {
  try {
    const b64 = (headerVal.split(' ')[1] || '').trim();
    const raw = Buffer.from(b64, 'base64').toString('utf8');
    const idx = raw.indexOf(':');
    if (idx === -1) return { user: '', pass: '' };
    return { user: raw.slice(0, idx), pass: raw.slice(idx + 1) };
  } catch { return { user: '', pass: '' }; }
}

function authMiddleware(req, res, next) {
  if (!needsAuth(req)) return next();

  // No credentials configured → skip (acts as "public mode")
  if (!(BASIC_TOKEN || (BASIC_USER && BASIC_PASS))) return next();

  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="tvscanner"');
    return res.status(401).send('Authentication required');
  }

  const { user, pass } = parseBasic(h);

  const ok =
    (BASIC_TOKEN && pass === BASIC_TOKEN) ||      // token mode: username empty, password = token
    (BASIC_USER && BASIC_PASS && user === BASIC_USER && pass === BASIC_PASS);

  if (!ok) {
    res.set('WWW-Authenticate', 'Basic realm="tvscanner"');
    return res.status(401).send('Invalid credentials');
  }
  return next();
}

// Attach BEFORE static + routes (so protected endpoints challenge properly)
app.use(authMiddleware);

// Simple logout to clear cached Basic creds in browser
app.get('/logout', (req, res) => {
  res.set('WWW-Authenticate', 'Basic realm="tvscanner"');
  res.status(401).send('Logged out');
});

// ================== Static site ==================
const PUBLIC_DIR = path.join(__dirname, 'public');

// Public landing page (index.html)
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Everything else under /public requires auth (because of global authMiddleware)
app.use(express.static(PUBLIC_DIR));

// ================== Pivot snapshot & config (auth-protected) ==================
app.get('/pivot/latest', (_req, res) => {
  try {
    res.json(getPivotSnapshot() || []);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});
app.get('/tolerance', (_req, res) => res.json(TOLERANCE));

// ================== Health (public) ==================
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    symbols: SYMBOLS.length,
    tfs: TFS,
    fastMs: FAST_PRICE_MS,
    slowMs: SLOW_METRIC_MS,
    pivotTickers: PIVOT_TICKERS
  });
});

// ================== Alerts (readers + test sender) ==================
initAlertHandler(app, io, { dataDir: DATA_DIR });

// ================== TradingView webhook (public) ==================
app.use('/', tvWebhookRouterFactory(io, { tvSecret: TV_SECRET, dataDir: DATA_DIR }));

// ================== Market Data (dual cadence) ==================
// Emits full snapshot objects on every pass (fast price, slow metrics).
// Stagger start so pivot paints first.
setTimeout(() => {
  startMarketDataUpdater(io, { dataDir: DATA_DIR, fastMs: FAST_PRICE_MS, slowMs: SLOW_METRIC_MS });
}, Number(process.env.MD_STAGGER_MS || 1500));

// ================== Pivot/CPR Updater (fixed tickers) ==================
// Emits: io.emit('pivotUpdate', rows) consumed by public/pivotPanel.js
startPivotUpdater(io, {
  dataDir: DATA_DIR,
  intervalMs: Number(process.env.PIVOT_MS || 60000),
  symbols: (process.env.PIVOT_TICKERS || 'NVDA,AMD,TSLA,AAPL,MSFT')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean),
  // symbolsFile: path.join(__dirname, 'config', 'pivot-tickers.txt'), // optional
});

// ================== Debug helper (auth-protected) ==================
// GET /debug/price?t=NVDA
app.get('/debug/price', async (req, res) => {
  try {
    const t = String(req.query.t || '').trim().toUpperCase();
    if (!t) return res.status(400).json({ error: 'Pass ?t=TICKER' });
    const price = await fetchPriceOnly(t);
    res.json({ ticker: t, price });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ================== Quote (auth-protected; used by UI) ==================
app.get('/quote', async (_req, res) => {
  try {
    const q = await getQuoteCached();
    res.json(q);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ================== Admin cleanup (public but gated by secret) ==================
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

    await Promise.all(
      Object.values(toClear).filter(Boolean).map(f => fsPromises.writeFile(f, '[]'))
    );

    if (!tf || tf === 'AI_5m')  io.emit('alertsUpdate:AI_5m',  []);
    if (!tf || tf === 'AI_15m') io.emit('alertsUpdate:AI_15m', []);
    if (!tf || tf === 'AI_1h')  io.emit('alertsUpdate:AI_1h',  []);

    io.emit('priceUpdate', {}); // harmless nudge; updater will repopulate
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
  console.log(`[boot] symbols=${SYMBOLS.join(', ')}  tfs=${TFS.join(', ')}`);
  console.log(`[boot] price every ${FAST_PRICE_MS}ms, metrics every ${SLOW_METRIC_MS}ms`);
  console.log(`[boot] pivot tickers = ${PIVOT_TICKERS.join(', ')}`);
  if (TV_SECRET) console.log('[boot] TV webhook requires ?key=***');
  if (BASIC_TOKEN || (BASIC_USER && BASIC_PASS)) {
    console.log('[boot] Basic Auth enabled for UI endpoints');
  } else {
    console.log('[boot] Basic Auth disabled (no BASIC_* envs set)');
  }
});
