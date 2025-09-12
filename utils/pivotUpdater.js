// utils/pivotUpdater.js
// Emits rows for the Pivot/CPR summary table (socket event: 'pivotUpdate').
// Ticker source priority:
// 1) options.symbols (array)  2) env PIVOT_TICKERS (CSV)
// 3) options.symbolsFile (newline list)  4) fallback: alert files
//
// "Pivot Relationship" uses CPR value area relationship between
// today's CPR (computed from prev day's H/L/C) and yesterday's CPR
// (computed from day-2 H/L/C):
// - Higher Value, Overlapping Higher Value, Lower Value,
//   Overlapping Lower Value, Inner Value, Outside Value, No change

const path = require('path');
const fs = require('fs');
const yahooFinance = require('yahoo-finance2').default;

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num   = v => (isNum(v) ? v : NaN);

// ===== ticker resolution =====
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
  if (Array.isArray(obj)) return obj;                 // legacy
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
  return loadTickersFromAlerts(dataDir); // last resort
}

// ===== CPR / Pivot math =====
function computeCPRFromHLC(high, low, close) {
  if (![high, low, close].every(isNum)) return null;
  const P  = (high + low + close) / 3; // central pivot
  const BC = (high + low) / 2;         // bottom central
  const TC = 2 * P - BC;               // top central
  const width = Math.abs(TC - BC);
  return { P, BC, TC, width };
}

// tolerant comparisons
function roughlyEq(a, b, tol) { return Math.abs(a - b) <= tol; }
function gt(a, b, tol) { return a - b >  tol; }
function lt(a, b, tol) { return b - a >  tol; }
function ge(a, b, tol) { return a > b || roughlyEq(a, b, tol); }
function le(a, b, tol) { return a < b || roughlyEq(a, b, tol); }

// CPR value relationship between "today" and "yesterday" CPR
function cprRelationship(today, yest, tol = 0.05) {
  // tol default ~5 cents; override via env PIVOT_REL_TOL
  if (!today || !yest) return 'Unknown';

  // 1) No change (all nearly equal)
  if (
    roughlyEq(today.P,  yest.P,  tol) &&
    roughlyEq(today.BC, yest.BC, tol) &&
    roughlyEq(today.TC, yest.TC, tol)
  ) return 'No change';

  // 2) Higher / Lower Value (no overlap)
  if (gt(today.BC, yest.TC, tol)) return 'Higher Value';
  if (lt(today.TC, yest.BC, tol)) return 'Lower Value';

  // overlap test
  const overlaps = ge(today.TC, yest.BC, tol) && le(today.BC, yest.TC, tol);

  // 3) Inside (today fully within yesterday)
  if (le(today.TC, yest.TC, tol) && ge(today.BC, yest.BC, tol)) return 'Inner Value';

  // 4) Outside (today fully covers yesterday)
  if (ge(today.TC, yest.TC, tol) && le(today.BC, yest.BC, tol)) return 'Outside Value';

  // 5) Overlapping Higher/Lower Value (partial overlap, shifted)
  if (overlaps) {
    if (gt(today.P, yest.P, tol)) return 'Overlapping Higher Value';
    if (lt(today.P, yest.P, tol)) return 'Overlapping Lower Value';
    return 'No change';
  }

  // Fallback (shouldn’t hit often)
  return (today.P > yest.P) ? 'Overlapping Higher Value' : 'Overlapping Lower Value';
}

// ===== fetchers =====
async function fetchPrev3DailyBars(ticker) {
  // Need at least last 3 daily bars: day-2, day-1, day0 (or latest)
  const period2 = new Date();
  const period1 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const rows = await yahooFinance.historical(ticker, { period1, period2, interval: '1d' });
  if (!Array.isArray(rows) || rows.length < 3) return null;
  const n = rows.length;
  return {
    day2: rows[n - 3], // two sessions ago
    day1: rows[n - 2], // yesterday (prev session)
    day0: rows[n - 1], // today (may be partial during session)
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

// ===== row builder =====
function priorDayMid(prevHigh, prevLow) {
  if (isNum(prevHigh) && isNum(prevLow)) {
    return Number(((prevHigh + prevLow) / 2).toFixed(2));
  }
  return null;
}

async function buildRows(tickers, relTol) {
  const ts = new Date().toISOString();
  const rows = [];

  for (const t of tickers) {
    // eslint-disable-next-line no-await-in-loop
    const [dailies, live] = await Promise.all([
      fetchPrev3DailyBars(t),
      fetchLivePriceOpen(t),
    ]);

    let relationship = 'Unknown';
    let midPoint = null;

    if (dailies?.day1 && dailies?.day2) {
      // Today’s CPR = computed from day-1 (yesterday’s H/L/C)
      const todayCpr = computeCPRFromHLC(dailies.day1.high, dailies.day1.low, dailies.day1.close);
      // Yesterday’s CPR = computed from day-2 (prior day’s H/L/C)
      const yestCpr  = computeCPRFromHLC(dailies.day2.high, dailies.day2.low, dailies.day2.close);
      relationship   = cprRelationship(todayCpr, yestCpr, relTol);
      midPoint       = priorDayMid(dailies.day1.high, dailies.day1.low);
    }

    rows.push({
      ts,                          // ISO; client formats CST
      ticker: t,
      pivotRelationship: relationship,
      trend: (live.price != null) ? (live.price >= (midPoint ?? live.price) ? 'Up' : 'Down') : 'Unknown',
      midPoint,                    // previous-day midpoint (for display)
      openPrice: live.open,
    });
  }

  return rows;
}

// ===== scheduler =====
function startPivotUpdater(io, { dataDir, intervalMs = 60_000, symbols = null, symbolsFile = null }) {
  const tickers = resolveTickers({ dataDir, symbols, symbolsFile });
  if (!tickers.length) {
    console.warn('[pivot] No tickers resolved. Set PIVOT_TICKERS or pass options.symbols.');
  } else {
    console.log('[pivot] tracking tickers:', tickers.join(', '));
  }

  const relTol = Number(process.env.PIVOT_REL_TOL || 0.05); // price tolerance (default 5 cents)

  const emit = async () => {
    try {
      const rows = await buildRows(tickers, relTol);
      io.emit('pivotUpdate', rows);
    } catch (e) {
      console.warn('[pivot] update error:', e.message || e);
    }
  };

  emit(); // first tick
  setInterval(emit, intervalMs);
}

module.exports = { startPivotUpdater };
