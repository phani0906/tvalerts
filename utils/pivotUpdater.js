// utils/pivotUpdater.js
// Calculates CPR + Camarilla pivots (PivotBoss style) and emits 'pivotUpdate' rows.
// Ticker source: ENV ONLY (PIVOT_TICKERS or TICKERS), no alerts fallback.

const yahooFinance = require('yahoo-finance2').default;

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/* =========================
   Tickers (from ENV)
   ========================= */
function loadTickersFromEnv() {
  const raw = (process.env.PIVOT_TICKERS || process.env.TICKERS || '').trim();
  if (!raw) return [];
  return raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
}

/* =========================
   CPR + Relationships
   ========================= */
function computeCPRFromHLC(high, low, close) {
  if (![high, low, close].every(isNum)) return null;
  const P  = (high + low + close) / 3;
  const BC = (high + low) / 2;
  const TC = 2 * P - BC;                   // ensure TC >= BC when interpreted
  return { P, BC, TC, width: Math.abs(TC - BC) };
}

const roughlyEq = (a, b, tol) => Math.abs(a - b) <= tol;

function cprRelationship(today, yest, tol = 0.05) {
  if (!today || !yest) return 'Unknown';
  const { BC: tBC, TC: tTC, P: tP } = today;
  const { BC: yBC, TC: yTC, P: yP } = yest;

  if (roughlyEq(tP,yP,tol) && roughlyEq(tBC,yBC,tol) && roughlyEq(tTC,yTC,tol)) return 'No change';

  const disjointAbove = tBC > yTC + tol;
  const disjointBelow = tTC < yBC - tol;
  if (disjointAbove) return 'Higher Value';
  if (disjointBelow) return 'Lower Value';

  const strictlyInside  = tTC <= yTC - tol && tBC >= yBC + tol;
  const strictlyOutside = tTC >= yTC + tol && tBC <= yBC - tol;

  if (!strictlyInside && !strictlyOutside) {
    if (tP > yP + tol) return 'Overlapping Higher Value';
    if (tP < yP - tol) return 'Overlapping Lower Value';
    return 'No change';
  }
  if (strictlyInside)  return 'Inner Value';
  if (strictlyOutside) return 'Outside Value';

  if (tP > yP + tol) return 'Overlapping Higher Value';
  if (tP < yP - tol) return 'Overlapping Lower Value';
  return 'No change';
}

function classifyTrendByRules(relationship, price, todayCPR, tol = 0.05) {
  if (!todayCPR || !isNum(price)) return 'Developing';
  const onOrAbove = price >= (todayCPR.BC - tol);
  const onOrBelow = price <= (todayCPR.TC + tol);
  const below     = price <  (todayCPR.BC - tol);
  const above     = price >  (todayCPR.TC + tol);
  const isHV = relationship === 'Higher Value' || relationship === 'Overlapping Higher Value';
  const isLV = relationship === 'Lower Value'  || relationship === 'Overlapping Lower Value';
  if (isHV && onOrAbove) return 'Bullish Continuation';
  if (isLV && onOrBelow) return 'Bearish Continuation';
  if (isHV && below)     return 'Bearish Trend Reversal';
  if (isLV && above)     return 'Bullish Trend Reversal';
  return 'Developing';
}

/* =========================
   CPR Width Classification
   - Keep last 10 widths per ticker
   - Narrow = lowest ~30%
   - Wide   = highest ~30%
   ========================= */
const WIDTH_HISTORY = new Map(); // ticker -> number[]

function pushWidth(ticker, width) {
  const arr = WIDTH_HISTORY.get(ticker) || [];
  arr.push(Number(width));
  while (arr.length > 10) arr.shift();
  WIDTH_HISTORY.set(ticker, arr);
  return arr;
}

function classifyCPRByHistory(widths, todayWidth) {
  const arr = (widths || []).slice(-10);
  if (!arr.length || !isNum(todayWidth)) return { cprClass: 'normal', rank: null, pct: null };
  const sorted = [...arr].sort((a,b) => a-b);
  const rank   = sorted.indexOf(todayWidth) + 1;            // 1..N (N<=10)
  const pct    = (rank - 0.5) / sorted.length;              // mid-rank percentile 0..1

  let cprClass = 'normal';
  if (sorted.length >= 6) { // only classify with some history
    const lowCut  = Math.max(2, Math.floor(sorted.length * 0.3));               // ~lowest 30%
    const highCut = sorted.length - Math.max(1, Math.floor(sorted.length * 0.3)) + 1; // ~highest 30%
    if (rank <= lowCut)        cprClass = 'narrow';
    else if (rank >= highCut)  cprClass = 'wide';
  }
  return { cprClass, rank, pct };
}

/* =========================
   Camarilla (PivotBoss factor 1.1)
   ========================= */
function computeCamarilla(yHigh, yLow, yClose, factor = 1.1) {
  if (![yHigh, yLow, yClose].every(isNum)) return null;
  const k = factor * (yHigh - yLow);
  return {
    R3: yClose + (k / 4),
    R4: yClose + (k / 2),
    R5: yClose + (k * 1.0),
    S3: yClose - (k / 4),
    S4: yClose - (k / 2),
    S5: yClose - (k * 1.0),
  };
}

function buildPivotSuite(yHigh, yLow, yClose) {
  const cpr = computeCPRFromHLC(yHigh, yLow, yClose);
  const cam = computeCamarilla(yHigh, yLow, yClose);
  if (!cpr || !cam) return null;

  const P  = +cpr.P.toFixed(2),  BC = +cpr.BC.toFixed(2), TC = +cpr.TC.toFixed(2);
  const R3 = +cam.R3.toFixed(2), R4 = +cam.R4.toFixed(2), R5 = +cam.R5.toFixed(2);
  const S3 = +cam.S3.toFixed(2), S4 = +cam.S4.toFixed(2), S5 = +cam.S5.toFixed(2);
  const prevHigh = +yHigh.toFixed(2), prevLow = +yLow.toFixed(2);

  const text = [
    `R5 ${R5}`, `R4 ${R4}`, `R3 ${R3}`,
    `PrevHigh ${prevHigh}`,
    `TC ${TC}`, `P ${P}`, `BC ${BC}`,
    `PrevLow ${prevLow}`,
    `S3 ${S3}`, `S4 ${S4}`, `S5 ${S5}`
  ].join(' | ');

  return { P, BC, TC, R3, R4, R5, S3, S4, S5, prevHigh, prevLow, text };
}

/* =========================
   Data fetch (Yahoo)
   ========================= */
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
    out.price = isNum(p) ? +p.toFixed(2) : null;
    out.open  = isNum(o) ? +o.toFixed(2) : null;
  } catch {}
  return out;
}

const priorDayMid = (H, L) => (isNum(H) && isNum(L)) ? +(((H + L) / 2).toFixed(2)) : null;

/* =========================
   Main loop
   ========================= */
let _latestPivotRows = [];
const REL_TOL   = Number(process.env.PIVOT_REL_TOL  || 0.05);
const TREND_TOL = Number(process.env.TREND_TOL      || 0.05);

async function buildRows(tickers) {
  const ts = new Date().toISOString();
  const rows = [];

  for (const t of tickers) {
    // eslint-disable-next-line no-await-in-loop
    const [dailies, live] = await Promise.all([fetchPrev3DailyBars(t), fetchLivePriceOpen(t)]);

    let relationship = 'Unknown';
    let midPoint = null;
    let trend = 'Developing';
    let pivotSuite = null;

    // CPR (today = built from "yesterday" H/L/C; yest = day before yesterday)
    let cprToday = null;
    if (dailies?.day1 && dailies?.day2) {
      cprToday       = computeCPRFromHLC(dailies.day1.high, dailies.day1.low, dailies.day1.close);
      const cprYest  = computeCPRFromHLC(dailies.day2.high, dailies.day2.low, dailies.day2.close);
      relationship   = cprRelationship(cprToday, cprYest, REL_TOL);
      midPoint       = priorDayMid(dailies.day1.high, dailies.day1.low);
      trend          = classifyTrendByRules(relationship, live.price, cprToday, TREND_TOL);
      pivotSuite     = buildPivotSuite(dailies.day1.high, dailies.day1.low, dailies.day1.close);
    }

    // CPR width classification (history-based)
    let cprWidth = null, cprRank = null, cprPercentile = null, cprClass = 'normal';
    if (cprToday && isNum(cprToday.width)) {
      cprWidth = +cprToday.width.toFixed(2);
      const hist = pushWidth(t, cprWidth);
      const cls  = classifyCPRByHistory(hist, cprWidth);
      cprClass       = cls.cprClass;
      cprRank        = cls.rank;
      cprPercentile  = cls.pct;
    }

    rows.push({
      ts,
      ticker: t,
      pivotRelationship: relationship,
      trend,
      midPoint,
      openPrice: live.open,
      currentPrice: live.price,
      pivotLevels: pivotSuite,
      pivotLevelsText: pivotSuite ? pivotSuite.text : '',
      // New CPR fields for UI badges/tooltips
      cprWidth,
      cprRank,
      cprPercentile,
      cprClass
    });
  }

  return rows;
}

function startPivotUpdater(io, { intervalMs = 60_000 } = {}) {
  const tickers = loadTickersFromEnv();
  if (!tickers.length) {
    console.warn('[pivot] No tickers found in ENV (set PIVOT_TICKERS or TICKERS). Pivot loop idle.');
    _latestPivotRows = [];
    return;
  }

  async function tick() {
    try {
      const rows = await buildRows(tickers);
      _latestPivotRows = rows;
      io.emit('pivotUpdate', rows);
    } catch (e) {
      console.warn('[pivot] update failed:', e.message);
    }
  }

  tick();
  setInterval(tick, intervalMs);
}

function getLatestPivotRows() { return _latestPivotRows; }

module.exports = { startPivotUpdater, getLatestPivotRows };
