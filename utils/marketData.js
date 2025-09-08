// marketData.js — MA20 + session VWAP (5m, 15m, 1h)
// VWAP = sum(typicalPrice * volume) / sum(volume) for today's session only,
// where typicalPrice = (high + low + close) / 3

const fs = require('fs');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;

// Optional: silence Yahoo survey banner
yahooFinance.suppressNotices?.(['yahooSurvey']);

const alertsFilePath = path.join(__dirname, '..', 'data', 'alerts.json');

// -------------------- helpers --------------------
function sma(values, length = 20) {
  const last = values.slice(-length);
  if (last.length < length) return null;
  const sum = last.reduce((a, b) => a + b, 0);
  return sum / length;
}
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num = v => (isNum(v) ? v : NaN);

// Build a day key in the exchange's local time using gmtoffset (seconds)
function dayKeyWithOffset(dateObj, gmtoffsetSec) {
  if (!(dateObj instanceof Date)) return null;
  const epochSec = Math.floor(dateObj.getTime() / 1000);
  const shifted = new Date((epochSec + (gmtoffsetSec || 0)) * 1000);
  // Use UTC getters after shift to avoid timezone complexity
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Compute session-only VWAP from bars using typical price
function sessionVWAP(bars, gmtoffsetSec) {
  if (!Array.isArray(bars) || bars.length === 0) return null;

  // Determine the "current session" day key from the last bar
  const lastBar = bars[bars.length - 1];
  const lastKey = dayKeyWithOffset(lastBar.date, gmtoffsetSec);
  if (!lastKey) return null;

  let pv = 0, vol = 0;
  for (const b of bars) {
    const key = dayKeyWithOffset(b.date, gmtoffsetSec);
    if (key !== lastKey) continue; // only bars from today's session

    const h = num(b.high), l = num(b.low), c = num(b.close), v = num(b.volume);
    if (!isNum(v) || v <= 0) continue;

    // typical price; fall back to close if h/l missing
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
// Cache the parsed series per ticker/interval, respect different TTLs
const cache = {
  // [ticker]: {
  //   '5m':  { ts, closes, bars, gmtoffsetSec },
  //   '15m': { ts, closes, bars, gmtoffsetSec },
  //   '1h':  { ts, closes, bars, gmtoffsetSec }
  // }
};

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

  // Build arrays of closes and full bars with dates
  const closes = [];
  const bars = [];
  for (const q of quotes) {
    const close = q?.close;
    if (isNum(close)) closes.push(close);

    // Date robustly: yahoo-finance2 usually gives q.date (Date)
    let d = q?.date instanceof Date ? q.date : null;
    if (!d && typeof q?.timestamp === 'number') d = new Date(q.timestamp * 1000);

    bars.push({
      date: d || new Date(), // fallback shouldn't happen often
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

// -------------------- top-level fetchers --------------------
async function fetchQuoteSummary(ticker) {
  try {
    const quote = await yahooFinance.quoteSummary(ticker, { modules: ['price', 'summaryDetail'] });

    const Price = quote.price?.regularMarketPrice ?? 'N/A';

    const dayLow = num(quote.summaryDetail?.dayLow);
    const dayHigh = num(quote.summaryDetail?.dayHigh);
    const DayMid = (isNum(dayLow) && isNum(dayHigh))
      ? Number(((dayLow + dayHigh) / 2).toFixed(2))
      : 'N/A';

    const wLow = num(quote.summaryDetail?.fiftyTwoWeekLow);
    const wHigh = num(quote.summaryDetail?.fiftyTwoWeekHigh);
    const WeeklyMid = (isNum(wLow) && isNum(wHigh))
      ? Number(((wLow + wHigh) / 2).toFixed(2))
      : 'N/A';

    return { Price, DayMid, WeeklyMid };
  } catch (err) {
    console.error(`quoteSummary error ${ticker}:`, err.message);
    return { Price: 'Error', DayMid: 'Error', WeeklyMid: 'Error' };
  }
}

async function fetchTickerData(ticker) {
  const [
    summary,
    ma5, vw5,
    ma15, vw15,
    mah, vwh
  ] = await Promise.all([
    fetchQuoteSummary(ticker),

    fetchMA20(ticker, '5m'),
    fetchVWAP(ticker, '5m'),

    fetchMA20(ticker, '15m'),
    fetchVWAP(ticker, '15m'),

    fetchMA20(ticker, '1h'),
    fetchVWAP(ticker, '1h')
  ]);

  return {
    Price: summary.Price,
    DayMid: summary.DayMid,
    WeeklyMid: summary.WeeklyMid,
    MA20_5m: ma5,
    VWAP_5m: vw5,
    MA20_15m: ma15,
    VWAP_15m: vw15,
    MA20_1h: mah,
    VWAP_1h: vwh
  };
}

// -------------------- updater loop --------------------
function startMarketDataUpdater(io) {
  setInterval(async () => {
    try {
      if (!fs.existsSync(alertsFilePath)) return;
      const raw = fs.readFileSync(alertsFilePath, 'utf8').trim();
      if (!raw) return;

      let alerts;
      try { alerts = JSON.parse(raw); }
      catch (e) { console.error('Invalid alerts.json JSON:', e.message); return; }

      const tickers = [...new Set(alerts.map(a => a.Ticker).filter(Boolean))];
      if (tickers.length === 0) return;

      const entries = await Promise.all(
        tickers.map(async t => [t, await fetchTickerData(t)])
      );

      const priceUpdates = Object.fromEntries(entries);
      io.emit('priceUpdate', priceUpdates);
    } catch (e) {
      console.error('Updater loop error:', e.message);
    }
  }, 5000);
}

module.exports = { startMarketDataUpdater };
