// utils/marketData.js
// Computes MA20 + session VWAP per timeframe and emits priceUpdate.
// DayMid = (yesterday's high + yesterday's low) / 2
// VWAP (per timeframe) = session-only vwap using typicalPrice=(H+L+C)/3

const fs = require('fs');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;

// Optional: silence Yahoo survey banner
yahooFinance.suppressNotices?.(['yahooSurvey']);

// -------------------- small helpers --------------------
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num = v => (isNum(v) ? v : NaN);

// Unwrap YahooNumber like { raw: 123.45 } → 123.45
const yNum = (v) => {
  if (v && typeof v === 'object' && v.raw != null) return Number(v.raw);
  return (typeof v === 'number') ? v : NaN;
};

function sma(values, length = 20) {
  const last = values.slice(-length);
  if (last.length < length) return null;
  let sum = 0;
  for (let i = 0; i < last.length; i++) sum += last[i];
  return sum / length;
}

// Build a local "day key" using the exchange gmtoffset (seconds)
function dayKeyWithOffset(dateObj, gmtoffsetSec) {
  if (!(dateObj instanceof Date)) return null;
  const epochSec = Math.floor(dateObj.getTime() / 1000);
  const shifted = new Date((epochSec + (gmtoffsetSec || 0)) * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Compute session-only VWAP from bars using typical price
function sessionVWAP(bars, gmtoffsetSec) {
  if (!Array.isArray(bars) || bars.length === 0) return null;

  const lastBar = bars[bars.length - 1];
  const lastKey = dayKeyWithOffset(lastBar.date, gmtoffsetSec);
  if (!lastKey) return null;

  let pv = 0, vol = 0;
  for (const b of bars) {
    const key = dayKeyWithOffset(b.date, gmtoffsetSec);
    if (key !== lastKey) continue; // only bars from today's session

    const h = num(b.high), l = num(b.low), c = num(b.close), v = num(b.volume);
    if (!isNum(v) || v <= 0) continue;

    const tp = isNum(h) && isNum(l) && isNum(c) ? (h + l + c) / 3 :
               isNum(c) ? c : NaN;
    if (!isNum(tp)) continue;

    pv += tp * v;
    vol += v;
  }
  if (vol <= 0) return null;
  return pv / vol;
}

// -------------------- caching --------------------
/**
 * cache[ticker][key] = { ts, closes, bars, gmtoffsetSec }
 * key: '5m' | '15m' | '1h'
 */
const cache = {};
const TTL = { '5m': 60_000, '15m': 120_000, '1h': 300_000 }; // 1m / 2m / 5m
const LOOKBACK_MS = { '5m': 5*86400000, '15m': 30*86400000, '1h': 90*86400000 };
const INTERVAL = { '5m': '5m', '15m': '15m', '1h': '1h' };

// Robust intraday fetch: try UNIX seconds (period1/2), fall back to range
async function fetchIntradaySeries(ticker, key /* '5m'|'15m'|'1h' */) {
  const nowMs = Date.now();
  const c = cache[ticker]?.[key];
  if (c && (nowMs - c.ts) < TTL[key]) return c;

  const interval = INTERVAL[key];

  const tryUnix = async () => {
    const period2 = Math.floor(nowMs / 1000);
    const period1 = Math.floor((nowMs - LOOKBACK_MS[key]) / 1000);
    return yahooFinance.chart(ticker, {
      interval,
      period1,
      period2,
      includePrePost: false
    });
  };
  const tryRange = async () => {
    const range = key === '1h' ? '3mo' : key === '15m' ? '1mo' : '5d';
    return yahooFinance.chart(ticker, {
      interval,
      range,
      includePrePost: false
    });
  };

  let result;
  try {
    result = await tryUnix();
  } catch (e) {
    const msg = (e && (e.message || String(e))) || '';
    if (msg.includes('/period1') || msg.includes('Expected required property')) {
      result = await tryRange();
    } else {
      throw e;
    }
  }

  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
  const gmtoffsetSec = Number(result?.meta?.gmtoffset) || 0;

  const closes = [];
  const bars = [];
  for (const q of quotes) {
    if (isNum(q?.close)) closes.push(q.close);
    let d = q?.date instanceof Date ? q.date : null;
    if (!d && typeof q?.timestamp === 'number') d = new Date(q.timestamp * 1000);
    bars.push({
      date: d || new Date(),
      open: q?.open,
      high: q?.high,
      low: q?.low,
      close: q?.close,
      volume: q?.volume
    });
  }

  const packed = { ts: nowMs, closes, bars, gmtoffsetSec };
  cache[ticker] = cache[ticker] || {};
  cache[ticker][key] = packed;
  return packed;
}

async function fetchMA20(ticker, key) {
  try {
    const { closes } = await fetchIntradaySeries(ticker, key);
    const avg = closes.length >= 20 ? sma(closes, 20) : null;
    return (avg != null && isNum(avg)) ? Number(avg.toFixed(2)) : 'N/A';
  } catch (err) {
    console.error(`MA20 fetch error ${ticker} [${key}]:`, err.message);
    return 'Error';
  }
}

async function fetchVWAP(ticker, key) {
  try {
    const { bars, gmtoffsetSec } = await fetchIntradaySeries(ticker, key);
    const v = sessionVWAP(bars, gmtoffsetSec);
    return (v != null && isNum(v)) ? Number(v.toFixed(2)) : 'N/A';
  } catch (err) {
    console.error(`VWAP fetch error ${ticker} [${key}]:`, err.message);
    return 'Error';
  }
}

// -------------------- DayMid (previous day) + Price --------------------
async function fetchQuoteAndPrevDayMid(ticker) {
  try {
    // Current price (unwrap YahooNumber safely)
    const qs = await yahooFinance.quoteSummary(ticker, { modules: ['price'] });
    const PriceRaw = qs?.price?.regularMarketPrice;
    const PriceNum = yNum(PriceRaw);
    const Price = Number.isFinite(PriceNum) ? Number(PriceNum.toFixed(2)) : 'N/A';

    // Previous day's H/L via historical; include today + previous so we can detect “yesterday”
    const today = new Date();
    const start = new Date(today.getTime() - 3 * 86400000); // 3 days back for safety
    const hist = await yahooFinance.historical(ticker, {
      period1: start,
      period2: today,
      interval: '1d'
    });

    // Sort by date asc, pick the last complete day prior to today
    const days = (hist || []).filter(d => d && d.date instanceof Date)
                             .sort((a, b) => a.date - b.date);

    let prevDay = null;
    if (days.length >= 2) {
      // last entry may be today's partial; choose the previous one
      prevDay = days[days.length - 2];
    } else if (days.length === 1) {
      prevDay = days[0]; // fallback
    }

    let DayMid = 'N/A';
    if (prevDay && isNum(prevDay.high) && isNum(prevDay.low)) {
      DayMid = Number(((prevDay.high + prevDay.low) / 2).toFixed(2));
    }

    return { Price, DayMid };
  } catch (err) {
    console.error(`quote/prevDayMid error ${ticker}:`, err.message);
    return { Price: 'Error', DayMid: 'Error' };
  }
}

// -------------------- top-level fetchers --------------------
async function fetchTickerData(ticker, opts = {}) {
  const { includeExtraTF = false } = opts;

  if (!includeExtraTF) {
    // minimal set (current table needs 5m + prevDayMid + Price)
    const [summary, ma5, vw5] = await Promise.all([
      fetchQuoteAndPrevDayMid(ticker),
      fetchMA20(ticker, '5m'),
      fetchVWAP(ticker, '5m'),
    ]);
    return {
      Price: summary.Price,
      DayMid: summary.DayMid,   // previous day's mid
      MA20_5m: ma5,
      VWAP_5m: vw5,
    };
  }

  // full set when 15m/1h are in use
  const [summary, ma5, vw5, ma15, vw15, mah, vwh] = await Promise.all([
    fetchQuoteAndPrevDayMid(ticker),
    fetchMA20(ticker, '5m'),  fetchVWAP(ticker, '5m'),
    fetchMA20(ticker, '15m'), fetchVWAP(ticker, '15m'),
    fetchMA20(ticker, '1h'),  fetchVWAP(ticker, '1h'),
  ]);
  return {
    Price: summary.Price,
    DayMid: summary.DayMid,    // previous day's mid
    MA20_5m: ma5,   VWAP_5m: vw5,
    MA20_15m: ma15, VWAP_15m: vw15,
    MA20_1h: mah,  VWAP_1h: vwh,
  };
}

// -------------------- alerts loader --------------------
function safeLoadAlerts(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('[marketData] Invalid alerts file:', e.message);
    return [];
  }
}

// -------------------- updater loop --------------------
/**
 * startMarketDataUpdater(io, { dataDir, intervalMs, includeExtraTF })
 *  - dataDir: required (server passes DATA_DIR)
 *  - intervalMs: default 5000
 *  - includeExtraTF: false by default (only 5m metrics)
 */
function startMarketDataUpdater(io, opts = {}) {
  const {
    dataDir,
    intervalMs = 5000,
    includeExtraTF = false,
  } = opts;

  const alertsFilePath = path.join(dataDir || path.join(__dirname, '..', 'data'), 'alerts.json');

  setInterval(async () => {
    try {
      const alerts = safeLoadAlerts(alertsFilePath);
      const tickers = [...new Set(alerts.map(a => a.Ticker).filter(Boolean))];
      if (tickers.length === 0) return;

      const entries = await Promise.all(
        tickers.map(async t => [t, await fetchTickerData(t, { includeExtraTF })])
      );

      const priceUpdates = Object.fromEntries(entries);
      // console.log('[marketData] emit priceUpdate for', Object.keys(priceUpdates).length, 'tickers');
      io.emit('priceUpdate', priceUpdates);
    } catch (e) {
      console.error('[marketData] updater error:', e.message);
    }
  }, intervalMs);

  // small initial emit (empty) so UI wiring is live
  setTimeout(() => io.emit('priceUpdate', {}), 1000);
}

module.exports = { startMarketDataUpdater };