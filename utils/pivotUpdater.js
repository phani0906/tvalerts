// utils/pivotUpdater.js
// Calculates CPR/Camarilla + adds PDH (Previous Day High) from yesterday’s daily bar.
// Emits rows via `pivotUpdate`. ENV tickers: PIVOT_TICKERS (fallback TICKERS)

const yahooFinance = require('yahoo-finance2').default;

const isNum = v => typeof v === 'number' && Number.isFinite(v);

// ---------- tickers (ENV only) ----------
function loadTickersFromEnv() {
  const raw = (process.env.PIVOT_TICKERS || process.env.TICKERS || '').trim();
  if (!raw) return [];
  return raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
}

// ---------- math helpers ----------
function safeFixed(n, d = 2) {
  if (!isNum(n)) return '';
  return Number(n.toFixed(d));
}

// CPR basics from yesterday
function computeCPR(yHigh, yLow, yClose) {
  const pivot = (yHigh + yLow + yClose) / 3;
  const bc = (yHigh + yLow) / 2;
  const tc = pivot + (pivot - bc);
  return { pivot, bc, tc };
}

// Optional: simple Camarilla set (not required for PDH but many UIs expect these)
function computeCamarilla(yHigh, yLow, yClose) {
  const range = yHigh - yLow;
  const r = v => yClose + v * range;
  const s = v => yClose - v * range;

  return {
    H1: r(1.1/12), H2: r(1.1/6), H3: r(1.1/4), H4: r(1.1/2),
    L1: s(1.1/12), L2: s(1.1/6), L3: s(1.1/4), L4: s(1.1/2)
  };
}

// ---------- fetch yesterday OHLC ----------
async function fetchYesterdayDailyBar(ticker) {
  // ask for ~7 trading days to be safe across holidays/weekends
  const query = { period1: undefined, period2: undefined, interval: '1d', range: '10d' };
  const hist = await yahooFinance.historical(ticker, query).catch(() => []);
  if (!Array.isArray(hist) || hist.length < 2) return null;

  // Sort by date (ascending), then take last 2 (yesterday = second last)
  hist.sort((a, b) => new Date(a.date) - new Date(b.date));
  const y = hist[hist.length - 2]; // yesterday
  if (!y || !isNum(y.open) || !isNum(y.high) || !isNum(y.low) || !isNum(y.close)) return null;

  return { yOpen: y.open, yHigh: y.high, yLow: y.low, yClose: y.close, yDate: y.date };
}

// ---------- cache & loop ----------
let _rowsCache = [];
let _timer = null;

async function buildRows(tickers) {
  const out = [];
  for (const t of tickers) {
    try {
      const daily = await fetchYesterdayDailyBar(t);
      if (!daily) continue;

      const { yHigh, yLow, yClose } = daily;
      const pdh = yHigh;                         // <-- PDH (Previous Day High)
      const midPoint = (yHigh + yLow) / 2;       // Mid-point of the prior day
      const cpr = computeCPR(yHigh, yLow, yClose);
      const cama = computeCamarilla(yHigh, yLow, yClose);

      out.push({
        ticker: t,
        // display fields (rounded)
        midPoint: safeFixed(midPoint),
        pdh: safeFixed(pdh),                     // <-- New field
        // CPR (rounded)
        cpr_pivot: safeFixed(cpr.pivot),
        cpr_bc: safeFixed(cpr.bc),
        cpr_tc: safeFixed(cpr.tc),
        // Camarilla (rounded)
        H1: safeFixed(cama.H1), H2: safeFixed(cama.H2),
        H3: safeFixed(cama.H3), H4: safeFixed(cama.H4),
        L1: safeFixed(cama.L1), L2: safeFixed(cama.L2),
        L3: safeFixed(cama.L3), L4: safeFixed(cama.L4),
      });
    } catch (e) {
      // continue on a single-ticker failure
    }
  }
  return out;
}

function startPivotUpdater(io, { cadenceMs = 120_000 } = {}) {
  const tickers = loadTickersFromEnv();
  if (!tickers.length) {
    console.warn('[pivotUpdater] No tickers in PIVOT_TICKERS/TICKERS');
  }

  const run = async () => {
    try {
      const rows = await buildRows(tickers);
      if (rows && rows.length) {
        _rowsCache = rows;
        io.emit('pivotUpdate', rows);
      }
    } catch (e) {
      console.error('[pivotUpdater] update failed:', e.message || e);
    }
  };

  // first run immediately
  run();
  // schedule
  clearInterval(_timer);
  _timer = setInterval(run, cadenceMs);
}

function getPivotSnapshot() {
  return _rowsCache.slice();
}

module.exports = {
  startPivotUpdater,
  getPivotSnapshot,
};
