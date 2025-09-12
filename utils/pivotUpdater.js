// utils/pivotUpdater.js
// Emits rows for the Pivot/CPR summary table. Ticker source priority:
// 1) options.symbols (array)
// 2) env PIVOT_TICKERS (CSV)
// 3) options.symbolsFile (newline list)
// 4) fallback: read tickers from alert files (legacy)
//
// Socket event: io.emit('pivotUpdate', rows)

const path = require('path');
const fs = require('fs');
const yahooFinance = require('yahoo-finance2').default;

// ---------- helpers ----------
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num = v => (isNum(v) ? v : NaN);

function safeJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function safeLoadAlerts(file) {
  const obj = safeJson(file);
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;                 // v0 legacy
  if (obj && Array.isArray(obj.rows)) return obj.rows;
  return [];
}

function loadTickersFromAlerts(dataDir) {
  const f5  = path.join(dataDir, 'alerts_5m.json');
  const f15 = path.join(dataDir, 'alerts_15m.json');
  const f1h = path.join(dataDir, 'alerts_1h.json');
  const a5  = safeLoadAlerts(f5);
  const a15 = safeLoadAlerts(f15);
  const a1h = safeLoadAlerts(f1h);
  return [...new Set([...a5, ...a15, ...a1h].map(a => a?.Ticker).filter(Boolean))]
    .map(s => String(s).toUpperCase());
}

function loadTickersFromEnv() {
  const s = (process.env.PIVOT_TICKERS || '').trim();
  if (!s) return [];
  return s.split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
}

function loadTickersFromFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split(/\r?\n/).map(x => x.trim().toUpperCase()).filter(Boolean);
  } catch {
    return [];
  }
}

function resolveTickers({ dataDir, symbols, symbolsFile }) {
  if (Array.isArray(symbols) && symbols.length) {
    return symbols.map(s => String(s).toUpperCase());
  }
  const fromEnv = loadTickersFromEnv();
  if (fromEnv.length) return fromEnv;

  if (symbolsFile) {
    const fromFile = loadTickersFromFile(symbolsFile);
    if (fromFile.length) return fromFile;
  }
  // last resort: legacy behavior
  return loadTickersFromAlerts(dataDir);
}

// Classic floor pivot + CPR from previous day
function computePivots(prevH, prevL, prevC) {
  if (![prevH, prevL, prevC].every(isNum)) return null;
  const P  = (prevH + prevL + prevC) / 3;   // pivot
  const BC = (prevH + prevL) / 2;           // CPR bottom
  const TC = 2 * P - BC;                    // CPR top
  return { P, BC, TC };
}

function pivotRelationship(price, P, tol = 0.5) {
  const p = num(price), pv = num(P);
  if (!isNum(p) || !isNum(pv)) return 'Unknown';
  const d = p - pv;
  if (Math.abs(d) <= tol) return 'Near Pivot';
  return d > 0 ? 'Above Pivot' : 'Below Pivot';
}

// Simple trend: Price vs MA20(5m) if provided; fallback vs Pivot
function trendFrom(price, ma20_5m, pivot, tol = 0.05) {
  const p = num(price);
  if (!isNum(p)) return 'Unknown';
  if (isNum(ma20_5m)) {
    const d = p - ma20_5m;
    if (Math.abs(d) <= tol) return 'At MA20';
    return d > 0 ? 'Up (Above MA20)' : 'Down (Below MA20)';
  }
  const pv = num(pivot);
  if (!isNum(pv)) return 'Unknown';
  return p >= pv ? 'Up (>= Pivot)' : 'Down (< Pivot)';
}

// ---------- fetchers ----------
async function fetchPrevDailyOHLC(ticker) {
  const period2 = new Date();
  const period1 = new Date(Date.now() - 21 * 24 * 3600 * 1000);
  const rows = await yahooFinance.historical(ticker, { period1, period2, interval: '1d' });
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const prev = rows[rows.length - 2];
  const cur  = rows[rows.length - 1]; // may be today (partial)
  return {
    prevHigh: prev?.high, prevLow: prev?.low, prevClose: prev?.close,
    curHigh: cur?.high, curLow: cur?.low, curClose: cur?.close
  };
}

async function fetchLivePriceOpen(ticker) {
  const out = { price: null, open: null };
  try {
    const q = await yahooFinance.quoteSummary(ticker, { modules: ['price'] });
    const p = q?.price?.regularMarketPrice;
    const o = q?.price?.regularMarketOpen;
    out.price = isNum(p) ? Number(p.toFixed(2)) : null;
    out.open  = isNum(o) ? Number(o.toFixed(2)) : null;
  } catch {}
  return out;
}

// If you later want to use MA20(5m) directly here, you can plumb it in;
// for now we keep the module independent and rely on pivot fallback.

// ---------- row builder ----------
async function buildRows(tickers) {
  const ts = new Date().toISOString();
  const rows = [];

  for (const t of tickers) {
    // eslint-disable-next-line no-await-in-loop
    const [daily, live] = await Promise.all([
      fetchPrevDailyOHLC(t),
      fetchLivePriceOpen(t),
    ]);

    const piv = computePivots(daily?.prevHigh, daily?.prevLow, daily?.prevClose);
    const prevMid = (isNum(daily?.prevHigh) && isNum(daily?.prevLow))
      ? Number(((daily.prevHigh + daily.prevLow) / 2).toFixed(2))
      : null;

    const rel = piv ? pivotRelationship(live.price, piv.P) : 'Unknown';
    const trn = trendFrom(live.price, /* ma20_5m */ null, piv?.P);

    rows.push({
      ts,                    // ISO; client formats CST
      ticker: t,
      pivotRelationship: rel,
      trend: trn,
      midPoint: prevMid,     // previous-day midpoint
      openPrice: live.open,
    });
  }
  return rows;
}

// ---------- scheduler ----------
function startPivotUpdater(io, { dataDir, intervalMs = 60_000, symbols = null, symbolsFile = null }) {
  const tickers = resolveTickers({ dataDir, symbols, symbolsFile });
  if (!tickers.length) {
    console.warn('[pivot] No tickers resolved. Set PIVOT_TICKERS or pass options.symbols.');
  } else {
    console.log('[pivot] tracking tickers:', tickers.join(', '));
  }

  const emit = async () => {
    try {
      const rows = await buildRows(tickers);
      io.emit('pivotUpdate', rows);
    } catch (e) {
      console.warn('[pivot] update error:', e.message || e);
    }
  };

  emit(); // first tick
  setInterval(emit, intervalMs);
}

module.exports = { startPivotUpdater };
