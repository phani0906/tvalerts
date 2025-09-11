// utils/marketData.js
const fs = require('fs');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;

// Optional: silence Yahoo survey banner
yahooFinance.suppressNotices?.(['yahooSurvey']);

// -------------------- helpers --------------------
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num = v => (isNum(v) ? v : NaN);

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
    if (key !== lastKey) continue; // only today's session
    const h = num(b.high), l = num(b.low), c = num(b.close), v = num(b.volume);
    if (!isNum(v) || v <= 0) continue;
    const tp = isNum(h) && isNum(l) && isNum(c) ? (h + l + c) / 3 : (isNum(c) ? c : NaN);
    if (!isNum(tp)) continue;
    pv += tp * v;
    vol += v;
  }
  if (vol <= 0) return null;
  return pv / vol;
}

// -------------------- caching for intraday --------------------
/**
 * cache[ticker][key] = { ts, closes, bars, gmtoffsetSec }
 * key: '5m' | '15m' | '1h'
 */
const cache = {};
const TTL = { '5m': 60_000, '15m': 120_000, '1h': 300_000 }; // 1m / 2m / 5m
const LOOKBACK_MS = { '5m': 5*86400000, '15m': 30*86400000, '1h': 90*86400000 };
const INTERVAL = { '5m': '5m', '15m': '15m', '1h': '1h' };

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

// -------------------- previous day midpoint --------------------
async function fetchPrevDayMid(ticker) {
  try {
    // Use Date objects per yahoo-finance2 validation
    const period2 = new Date();
    const period1 = new Date(Date.now() - 10 * 24 * 3600 * 1000); // ~10 days back
    const dailyBars = await yahooFinance.historical(ticker, {
      period1,
      period2,
      interval: '1d'
    });

    if (Array.isArray(dailyBars) && dailyBars.length >= 2) {
      const prev = dailyBars[dailyBars.length - 2];
      const hi = Number(prev?.high);
      const lo = Number(prev?.low);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return Number(((hi + lo) / 2).toFixed(2));
      }
    }
    return 'N/A';
  } catch (e) {
    console.warn(`[marketData] fetchPrevDayMid failed ${ticker}:`, e.message);
    return 'N/A';
  }
}

// -------------------- per-metric fetchers --------------------
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

// -------------------- quote summary (Price + previous-day mid) --------------------
async function fetchQuoteSummary(ticker) {
  try {
    const quote = await yahooFinance.quoteSummary(ticker, { modules: ['price'] });
    const Price = quote.price?.regularMarketPrice ?? 'N/A';
    const PrevDayMid = await fetchPrevDayMid(ticker);
    return { Price, DayMid: PrevDayMid };
  } catch (err) {
    console.error(`quoteSummary error ${ticker}:`, err.message);
    return { Price: 'Error', DayMid: 'Error' };
  }
}

// -------------------- top-level: all metrics for a ticker --------------------
async function fetchTickerData(ticker) {
  const [summary, ma5, vw5, ma15, vw15, mah, vwh] = await Promise.all([
    fetchQuoteSummary(ticker),
    fetchMA20(ticker, '5m'),  fetchVWAP(ticker, '5m'),
    fetchMA20(ticker, '15m'), fetchVWAP(ticker, '15m'),
    fetchMA20(ticker, '1h'),  fetchVWAP(ticker, '1h'),
  ]);
  return {
    Price: summary.Price,
    DayMid: summary.DayMid,              // previous-day midpoint
    MA20_5m: ma5,   VWAP_5m: vw5,
    MA20_15m: ma15, VWAP_15m: vw15,
    MA20_1h: mah,   VWAP_1h: vwh,
  };
}

// -------------------- alerts loader --------------------
function safeLoad(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// -------------------- updater loop --------------------
/**
 * startMarketDataUpdater(io, { dataDir, intervalMs })
 *  - dataDir: required (server passes DATA_DIR)
 *  - intervalMs: default 5000
 */
function startMarketDataUpdater(io, { dataDir, intervalMs = 5000 }) {
  const f5  = path.join(dataDir, 'alerts_5m.json');
  const f15 = path.join(dataDir, 'alerts_15m.json');
  const f1h = path.join(dataDir, 'alerts_1h.json');

  setInterval(async () => {
    try {
      const a5  = safeLoad(f5);
      const a15 = safeLoad(f15);
      const a1h = safeLoad(f1h);

      // union of tickers across all timeframes
      const tickers = [...new Set(
        [...a5, ...a15, ...a1h].map(a => a.Ticker).filter(Boolean)
      )];
      if (tickers.length === 0) return;

      const entries = await Promise.all(
        tickers.map(async t => [t, await fetchTickerData(t)])
      );
      const priceUpdates = Object.fromEntries(entries);

      io.emit('priceUpdate', priceUpdates);
      console.log('[marketData] priceUpdate:', Object.keys(priceUpdates));
    } catch (e) {
      console.error('[marketData] updater error:', e.message);
    }
  }, intervalMs);

  // small initial emit (empty) so UI wiring is live
  setTimeout(() => io.emit('priceUpdate', {}), 1000);
}

module.exports = { startMarketDataUpdater };
