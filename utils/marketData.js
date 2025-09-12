// utils/marketData.js
// Price fast (~5s), MA20/VWAP/DayMid slow (~60s). Emits a full snapshot each time.

const fs = require('fs');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;

// Optional: silence Yahoo survey banner
yahooFinance.suppressNotices?.(['yahooSurvey']);

// -------------------- small helpers --------------------
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num   = v => (isNum(v) ? v : NaN);

function sma(values, length = 20) {
  const last = values.slice(-length);
  if (last.length === 0) return null;      // tolerant to short series
  const n = last.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += last[i];
  return sum / n;
}

function dayKeyWithOffset(dateObj, gmtoffsetSec) {
  if (!(dateObj instanceof Date)) return null;
  const epochSec = Math.floor(dateObj.getTime() / 1000);
  const shifted  = new Date((epochSec + (gmtoffsetSec || 0)) * 1000);
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

    const tp = isNum(h) && isNum(l) && isNum(c) ? (h + l + c) / 3 :
               isNum(c) ? c : NaN;
    if (!isNum(tp)) continue;

    pv  += tp * v;
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
const TTL         = { '5m':  60_000, '15m': 120_000, '1h': 300_000 };
const LOOKBACK_MS = { '5m': 5*86400000, '15m': 30*86400000, '1h': 90*86400000 };
const INTERVAL    = { '5m': '5m',       '15m': '15m',       '1h': '1h' };

async function fetchIntradaySeries(ticker, key) {
  const nowMs = Date.now();
  const c = cache[ticker]?.[key];
  if (c && (nowMs - c.ts) < TTL[key]) return c;

  const interval = INTERVAL[key];

  const tryUnix = async () => {
    const period2 = new Date();
    const period1 = new Date(nowMs - LOOKBACK_MS[key]);
    return yahooFinance.chart(ticker, {
      interval,
      period1,
      period2,
      includePrePost: false
    });
  };

  const tryRange = async () => {
    const range = key === '1h' ? '3mo' : key === '15m' ? '1mo' : '5d';
    return yahooFinance.chart(ticker, { interval, range, includePrePost: false });
  };

  let result;
  try {
    // prefer 'range' for 5m to ensure enough bars at boot
    result = (key === '5m') ? await tryRange() : await tryUnix();
  } catch (e) {
    const msg = (e && (e.message || String(e))) || '';
    if (msg.includes('/period1') || msg.includes('Expected required property')) {
      result = await tryRange();
    } else {
      throw e;
    }
  }

  const quotes       = Array.isArray(result?.quotes) ? result.quotes : [];
  const gmtoffsetSec = Number(result?.meta?.gmtoffset) || 0;

  const closes = [];
  const bars   = [];
  for (const q of quotes) {
    if (isNum(q?.close)) closes.push(q.close);
    let d = q?.date instanceof Date ? q.date : null;
    if (!d && typeof q?.timestamp === 'number') d = new Date(q.timestamp * 1000);
    bars.push({
      date: d || new Date(),
      open: q?.open,
      high: q?.high,
      low:  q?.low,
      close:q?.close,
      volume:q?.volume
    });
  }

  const packed = { ts: nowMs, closes, bars, gmtoffsetSec };
  cache[ticker] = cache[ticker] || {};
  cache[ticker][key] = packed;
  return packed;
}

// -------------------- individual fetchers --------------------
async function fetchPriceOnly(ticker) {
  try {
    // quoteSummary is stable; we only read the price
    const q = await yahooFinance.quoteSummary(ticker, { modules: ['price'] });
    const p = q?.price?.regularMarketPrice;
    return (p != null && isNum(p)) ? Number(p.toFixed(2)) : 'N/A';
  } catch (e) {
    console.error(`price fetch error ${ticker}:`, e.message);
    return 'Error';
  }
}

async function fetchMA20(ticker, key) {
  try {
    const { closes } = await fetchIntradaySeries(ticker, key);
    const avg = sma(closes, 20);
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

// previous-day midpoint from daily bars
async function fetchPrevDayMid(ticker) {
  try {
    const period2 = new Date();
    const period1 = new Date(Date.now() - 15 * 24 * 3600 * 1000);
    const dailyBars = await yahooFinance.historical(ticker, {
      period1, period2, interval: '1d'
    });
    if (Array.isArray(dailyBars) && dailyBars.length >= 2) {
      const prev = dailyBars[dailyBars.length - 2]; // yesterday
      if (isNum(prev?.high) && isNum(prev?.low)) {
        return Number(((prev.high + prev.low) / 2).toFixed(2));
      }
    }
    return 'N/A';
  } catch (e) {
    console.warn(`[marketData] fetchPrevDayMid failed ${ticker}:`, e.message);
    return 'N/A';
  }
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

// -------------------- dual-cadence updater --------------------
// We maintain an in-memory snapshot per ticker and emit the WHOLE object each pass.
const currentData = {}; // { [TICKER]: { Price, DayMid, MA20_5m, VWAP_5m, MA20_15m, VWAP_15m, MA20_1h, VWAP_1h } }

function mergeTicker(t, patch) {
  currentData[t] = { ...(currentData[t] || {}), ...patch };
}

function readTickersFromFiles(dataDir) {
  const f5  = path.join(dataDir, 'alerts_5m.json');
  const f15 = path.join(dataDir, 'alerts_15m.json');
  const f1h = path.join(dataDir, 'alerts_1h.json');

  const a5  = safeLoad(f5);
  const a15 = safeLoad(f15);
  const a1h = safeLoad(f1h);

  return [...new Set([...a5, ...a15, ...a1h].map(a => a.Ticker).filter(Boolean))];
}

async function runPricePass(io, dataDir) {
  const tickers = readTickersFromFiles(dataDir);
  if (tickers.length === 0) return;

  for (const t of tickers) {
    // eslint-disable-next-line no-await-in-loop
    const Price = await fetchPriceOnly(t);
    mergeTicker(t, { Price });
  }

  io.emit('priceUpdate', { ...currentData }); // full snapshot
  console.log('[marketData] priceUpdate (fast):', Object.keys(currentData));
}

async function runMetricsPass(io, dataDir) {
  const tickers = readTickersFromFiles(dataDir);
  if (tickers.length === 0) return;

  for (const t of tickers) {
    // eslint-disable-next-line no-await-in-loop
    const [ma5, vw5, ma15, vw15, mah, vwh, dayMid] = await Promise.all([
      fetchMA20(t, '5m'),  fetchVWAP(t, '5m'),
      fetchMA20(t, '15m'), fetchVWAP(t, '15m'),
      fetchMA20(t, '1h'),  fetchVWAP(t, '1h'),
      fetchPrevDayMid(t)
    ]);

    mergeTicker(t, {
      DayMid: dayMid,
      MA20_5m:  ma5,  VWAP_5m:  vw5,
      MA20_15m: ma15, VWAP_15m: vw15,
      MA20_1h:  mah,  VWAP_1h:  vwh,
    });
  }

  io.emit('priceUpdate', { ...currentData }); // full snapshot (with fresh metrics)
  console.log('[marketData] metricsUpdate (slow):', Object.keys(currentData));
}

/**
 * startMarketDataUpdater(io, { dataDir, fastMs = 5000, slowMs = 60000 })
 */
function startMarketDataUpdater(io, { dataDir, fastMs = 5000, slowMs = 60000 }) {
  // initial empty emit so UI wires up
  setTimeout(() => io.emit('priceUpdate', {}), 500);

  // Kick off both loops
  setInterval(() => { runPricePass(io, dataDir).catch(e => console.warn('[price pass]', e.message)); }, fastMs);
  setInterval(() => { runMetricsPass(io, dataDir).catch(e => console.warn('[metrics pass]', e.message)); }, slowMs);

  // Also do one immediate metrics pass so MA/VWAP/DayMid show up without waiting a minute
  runMetricsPass(io, dataDir).catch(() => {});
}

module.exports = {
  startMarketDataUpdater,
  fetchPriceOnly,          // exported in case you also run a separate fast loop in server.js
};
