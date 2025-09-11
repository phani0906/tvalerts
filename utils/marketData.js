// utils/marketData.js
// Emits priceUpdate for all tickers seen in alerts_5m/15m/1h.json.
// Computes MA20 (5m/15m/1h), session VWAP (per TF), and DayMid = (prevDayHigh+prevDayLow)/2.

const fs = require('fs');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;

yahooFinance.suppressNotices?.(['yahooSurvey']);

// ---------- small helpers ----------
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num   = v => (isNum(v) ? v : NaN);

function sma(values, length = 20) {
  const last = values.slice(-length);
  if (last.length < length) return null;
  let sum = 0;
  for (let i = 0; i < last.length; i++) sum += last[i];
  return sum / length;
}

// Use exchange gmtoffset to group bars by their local "day"
function dayKeyWithOffset(dateObj, gmtoffsetSec) {
  if (!(dateObj instanceof Date)) return null;
  const epochSec = Math.floor(dateObj.getTime() / 1000);
  const shifted  = new Date((epochSec + (gmtoffsetSec || 0)) * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Session VWAP from bars using typical price
function sessionVWAP(bars, gmtoffsetSec) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  const lastBar = bars[bars.length - 1];
  const lastKey = dayKeyWithOffset(lastBar.date, gmtoffsetSec);
  if (!lastKey) return null;

  let pv = 0, vol = 0;
  for (const b of bars) {
    const key = dayKeyWithOffset(b.date, gmtoffsetSec);
    if (key !== lastKey) continue;

    const h = num(b.high), l = num(b.low), c = num(b.close), v = num(b.volume);
    if (!isNum(v) || v <= 0) continue;
    const tp = isNum(h) && isNum(l) && isNum(c) ? (h + l + c) / 3 : (isNum(c) ? c : NaN);
    if (!isNum(tp)) continue;

    pv  += tp * v;
    vol += v;
  }
  if (vol <= 0) return null;
  return pv / vol;
}

// ---------- caching / fetch ----------
const cache = {};
const TTL         = { '5m': 60_000, '15m': 120_000, '1h': 300_000 };
const LOOKBACK_MS = { '5m': 5 * 86400000, '15m': 30 * 86400000, '1h': 90 * 86400000 };
const INTERVAL    = { '5m': '5m', '15m': '15m', '1h': '1h' };

async function fetchIntradaySeries(ticker, key) {
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
      includePrePost: false,
    });
  };
  const tryRange = async () => {
    const range = key === '1h' ? '3mo' : key === '15m' ? '1mo' : '5d';
    return yahooFinance.chart(ticker, {
      interval,
      range,
      includePrePost: false,
    });
  };

  let result;
  try { result = await tryUnix(); }
  catch (e) {
    const msg = (e && (e.message || String(e))) || '';
    if (msg.includes('/period1') || msg.includes('Expected required property')) {
      result = await tryRange();
    } else { throw e; }
  }

  const quotes        = Array.isArray(result?.quotes) ? result.quotes : [];
  const gmtoffsetSec  = Number(result?.meta?.gmtoffset) || 0;

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
      volume:q?.volume,
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

// Previous **full** day midpoint = (prevHigh + prevLow) / 2
async function fetchPrevDayMid(ticker) {
  try {
    const res = await yahooFinance.chart(ticker, { interval: '1d', range: '5d', includePrePost: false });
    const quotes = Array.isArray(res?.quotes) ? res.quotes : [];
    if (quotes.length < 2) return 'N/A';
    const prev = quotes[quotes.length - 2];
    const low  = num(prev?.low);
    const high = num(prev?.high);
    if (!isNum(low) || !isNum(high)) return 'N/A';
    return Number(((low + high) / 2).toFixed(2));
  } catch (e) {
    console.error(`DayMid prev-day error ${ticker}:`, e.message);
    return 'Error';
  }
}

// Quote (for real-time regular market price)
async function fetchQuote(ticker) {
  try {
    const q = await yahooFinance.quoteSummary(ticker, { modules: ['price'] });
    const Price = q.price?.regularMarketPrice ?? 'N/A';
    return { Price };
  } catch (e) {
    console.error(`quote error ${ticker}:`, e.message);
    return { Price: 'Error' };
  }
}

async function fetchTickerData(ticker) {
  // We fetch all TF metrics so all three tables can render.
  const [q, dayMid, ma5, vw5, ma15, vw15, ma1h, vw1h] = await Promise.all([
    fetchQuote(ticker),
    fetchPrevDayMid(ticker),
    fetchMA20(ticker, '5m'),  fetchVWAP(ticker, '5m'),
    fetchMA20(ticker, '15m'), fetchVWAP(ticker, '15m'),
    fetchMA20(ticker, '1h'),  fetchVWAP(ticker, '1h'),
  ]);
  return {
    Price: q.Price,
    DayMid: dayMid,
    MA20_5m:  ma5,  VWAP_5m:  vw5,
    MA20_15m: ma15, VWAP_15m: vw15,
    MA20_1h:  ma1h, VWAP_1h:  vw1h,
  };
}

// ---------- alerts loading ----------
function safeLoad(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('[marketData] bad JSON:', file, e.message);
    return [];
  }
}

// ---------- updater loop ----------
function startMarketDataUpdater(io, opts = {}) {
  const { dataDir, intervalMs = 5000 } = opts;
  const baseDir = dataDir || path.join(__dirname, '..', 'data');

  const file5  = path.join(baseDir, 'alerts_5m.json');
  const file15 = path.join(baseDir, 'alerts_15m.json');
  const file1h = path.join(baseDir, 'alerts_1h.json');

  const tickersFromAllFiles = () => {
    const a5  = safeLoad(file5);
    const a15 = safeLoad(file15);
    const a1h = safeLoad(file1h);
    const all = [...a5, ...a15, ...a1h];
    return [...new Set(all.map(a => a.Ticker).filter(Boolean))];
  };

  const tickers = new Set(); // last seen (for logging only)

  setInterval(async () => {
    try {
      const list = tickersFromAllFiles();
      if (list.length === 0) return;

      // log when set changes (helps debugging)
      const key = list.sort().join(',');
      const prevKey = [...tickers].sort().join(',');
      if (key !== prevKey) {
        tickers.clear(); list.forEach(t => tickers.add(t));
        console.log('[marketData] tracking tickers:', key);
      }

      const entries = await Promise.all(
        list.map(async t => [t, await fetchTickerData(t)])
      );
      const priceUpdates = Object.fromEntries(entries);

      io.emit('priceUpdate', priceUpdates);
    } catch (e) {
      console.error('[marketData] updater error:', e.message);
    }
  }, intervalMs);

  // initial noop so client wiring is ready
  setTimeout(() => io.emit('priceUpdate', {}), 1000);
}

module.exports = { startMarketDataUpdater };
