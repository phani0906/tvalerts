// utils/pivotUpdater.js
// Emits rows for the Pivot/CPR summary table (socket event: 'pivotUpdate').
// Ticker source priority:
// 1) options.symbols (array)  2) env PIVOT_TICKERS (CSV)
// 3) options.symbolsFile (newline list)  4) fallback: alert files

const path = require('path');
const fs = require('fs');
const yahooFinance = require('yahoo-finance2').default;

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num   = v => (isNum(v) ? v : NaN);

let _latestPivotRows = [];

// ---------- safe loaders ----------
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
  if (Array.isArray(obj)) return obj;                 // legacy array
  if (obj && Array.isArray(obj.rows)) return obj.rows;
  return [];
}

// ---------- ticker resolution ----------
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

// ---------- CPR math ----------
function computeCPRFromHLC(high, low, close) {
  if (![high, low, close].every(isNum)) return null;
  const P  = (high + low + close) / 3;
  const BC = (high + low) / 2;
  const TC = 2 * P - BC;
  return { P, BC, TC, width: Math.abs(TC - BC) };
}
function roughlyEq(a, b, tol) { return Math.abs(a - b) <= tol; }

// Relationship categories (unchanged)
function cprRelationship(today, yest, tol = 0.05) {
  if (!today || !yest) return 'Unknown';

  const tBC = today.BC, tTC = today.TC, tP = today.P;
  const yBC = yest.BC,  yTC = yest.TC,  yP = yest.P;

  // No change
  if (roughlyEq(tP,  yP,  tol) && roughlyEq(tBC, yBC, tol) && roughlyEq(tTC, yTC, tol)) {
    return 'No change';
  }

  // Disjoint
  const disjointAbove = tBC > yTC + tol;
  const disjointBelow = tTC < yBC - tol;
  if (disjointAbove) return 'Higher Value';
  if (disjointBelow) return 'Lower Value';

  // Overlap
  const strictlyInside  = tTC <= yTC - tol && tBC >= yBC + tol;
  const strictlyOutside = tTC >= yTC + tol && tBC <= yBC - tol;

  if (!strictlyInside && !strictlyOutside) {
    if (tP > yP + tol) return 'Overlapping Higher Value';
    if (tP < yP - tol) return 'Overlapping Lower Value';
    return 'No change';
  }
  if (strictlyInside)  return 'Inner Value';
  if (strictlyOutside) return 'Outside Value';

  // Fallback
  if (tP > yP + tol) return 'Overlapping Higher Value';
  if (tP < yP - tol) return 'Overlapping Lower Value';
  return 'No change';
}

// ---------- Trend classification (your rules) ----------
function classifyTrendByRules(relationship, price, todayCPR, tol = 0.05) {
  if (!todayCPR || !isNum(price)) return 'Developing';

  const onOrAboveToday = price >= (todayCPR.BC - tol); // inside or above band
  const onOrBelowToday = price <= (todayCPR.TC + tol); // inside or below band
  const belowToday     = price <  (todayCPR.BC - tol);
  const aboveToday     = price >  (todayCPR.TC + tol);

  const isHV  = relationship === 'Higher Value' || relationship === 'Overlapping Higher Value';
  const isLV  = relationship === 'Lower Value'  || relationship === 'Overlapping Lower Value';

  // Continuations
  if (isHV && onOrAboveToday) return 'Bullish Continuation';
  if (isLV && onOrBelowToday) return 'Bearish Continuation';

  // Reversals
  if (isHV && belowToday)     return 'Bearish Trend Reversal';
  if (isLV && aboveToday)     return 'Bullish Trend Reversal';

  // Otherwise developing/neutral
  return 'Developing';
}

// ---------- Additional Pivot Suite ----------
// Camarilla S/R (S3/S4/S5, R3/R4/R5) using factor 1.1 (PivotBoss convention).
function computeCamarilla(yHigh, yLow, yClose, factor = 1.1) {
  if (![yHigh, yLow, yClose].every(isNum)) return null;
  const range = yHigh - yLow;
  const k = (factor * range);
  const R3 = yClose + (k / 4);
  const R4 = yClose + (k / 2);
  const R5 = yClose + (k * 1.0);
  const S3 = yClose - (k / 4);
  const S4 = yClose - (k / 2);
  const S5 = yClose - (k * 1.0);
  return { R3, R4, R5, S3, S4, S5 };
}

function buildPivotSuite(yHigh, yLow, yClose) {
  const cpr = computeCPRFromHLC(yHigh, yLow, yClose);   // { P, BC, TC, width }
  const cam = computeCamarilla(yHigh, yLow, yClose);    // { R3,R4,R5,S3,S4,S5 }
  if (!cpr || !cam) return null;

  const P  = Number(cpr.P.toFixed(2));
  const BC = Number(cpr.BC.toFixed(2));
  const TC = Number(cpr.TC.toFixed(2));

  const R3 = Number(cam.R3.toFixed(2));
  const R4 = Number(cam.R4.toFixed(2));
  const R5 = Number(cam.R5.toFixed(2));
  const S3 = Number(cam.S3.toFixed(2));
  const S4 = Number(cam.S4.toFixed(2));
  const S5 = Number(cam.S5.toFixed(2));

  const prevHigh = Number(yHigh.toFixed(2));
  const prevLow  = Number(yLow.toFixed(2));

  // Text in descending order R5→S5 including previous day H/L
  const text = [
    `R5 ${R5}`, `R4 ${R4}`, `R3 ${R3}`,
    `PrevHigh ${prevHigh}`,
    `TC ${TC}`, `P ${P}`, `BC ${BC}`,
    `PrevLow ${prevLow}`,
    `S3 ${S3}`, `S4 ${S4}`, `S5 ${S5}`
  ].join(' | ');

  return {
    P, BC, TC, R3, R4, R5, S3, S4, S5, prevHigh, prevLow,
    text
  };
}

// ---------- fetchers ----------
async function fetchPrev3DailyBars(ticker) {
  const period2 = new Date();
  const period1 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const rows = await yahooFinance.historical(ticker, { period1, period2, interval: '1d' });
  if (!Array.isArray(rows) || rows.length < 3) return null;
  const n = rows.length;
  return { day2: rows[n - 3], day1: rows[n - 2], day0: rows[n - 1] };
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
function priorDayMid(prevHigh, prevLow) {
  if (isNum(prevHigh) && isNum(prevLow)) return Number(((prevHigh + prevLow) / 2).toFixed(2));
  return null;
}

// ---------- rows ----------
async function buildRows(tickers, relTol, trendTol) {
  const ts = new Date().toISOString();
  const rows = [];
  for (const t of tickers) {
    // eslint-disable-next-line no-await-in-loop
    const [dailies, live] = await Promise.all([fetchPrev3DailyBars(t), fetchLivePriceOpen(t)]);

    let relationship = 'Unknown';
    let midPoint = null;
    let trend = 'Developing';
    let todayCpr = null;
    let pivotSuite = null;

    if (dailies?.day1 && dailies?.day2) {
      // Today CPR from yesterday; Yesterday CPR from day-2 (per PivotBoss)
      todayCpr       = computeCPRFromHLC(dailies.day1.high, dailies.day1.low, dailies.day1.close);
      const yestCpr  = computeCPRFromHLC(dailies.day2.high, dailies.day2.low, dailies.day2.close);
      relationship   = cprRelationship(todayCpr, yestCpr, relTol);
      midPoint       = priorDayMid(dailies.day1.high, dailies.day1.low);
      trend          = classifyTrendByRules(relationship, live.price, todayCpr, trendTol);
      pivotSuite     = buildPivotSuite(dailies.day1.high, dailies.day1.low, dailies.day1.close);
    }

    rows.push({
      ts,
      ticker: t,
      pivotRelationship: relationship,
      trend,
      midPoint,                 // prior-day midpoint
      openPrice: live.open,
      currentPrice: live.price,
      pivotLevels: pivotSuite,                    // structured numbers
      pivotLevelsText: pivotSuite ? pivotSuite.text : '' // printable string
    });
  }
  return rows;
}

// ---------- scheduler ----------
function startPivotUpdater(
  io,
  {
    dataDir,
    intervalMs = 60_000,
    symbols = null,
    symbolsFile = null,
    relationshipTolerance = 0.05,
    trendTolerance = 0.05,
  }
) {
  const tickers = resolveTickers({ dataDir, symbols, symbolsFile });
  if (!tickers.length) {
    console.warn('[pivot] No tickers resolved; pivot updater idle.');
    _latestPivotRows = [];
    return;
  }

  async function tick() {
    try {
      const rows = await buildRows(tickers, relationshipTolerance, trendTolerance);
      _latestPivotRows = rows;
      io.emit('pivotUpdate', rows);
    } catch (e) {
      console.warn('[pivot] update failed:', e.message);
    }
  }

  // Initial run immediately, then schedule
  tick();
  setInterval(tick, intervalMs);
}

function getLatestPivotRows() {
  return _latestPivotRows;
}

module.exports = {
  startPivotUpdater,
  getLatestPivotRows,
};
