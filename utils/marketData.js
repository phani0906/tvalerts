// utils/marketData.js
// Price fast (~5s), MA20/VWAP/DayMid slow (~60s). Emits a full snapshot each time.

const fs = require('fs');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default; // daily + quote summary

// -------------------- small helpers --------------------
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num   = v => (isNum(v) ? v : NaN);

function sma(values, length = 20) {
  const last = values.slice(-length);
  if (last.length === 0) return null;
  let sum = 0;
  for (let i = 0; i < last.length; i++) sum += last[i];
  return sum / last.length;
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
function sessionVWAP(bars, gmtoffsetSec, regStartSec, regEndSec) {
  if (!Array.isArray(bars) || bars.length === 0) return null;

  let pv = 0, vol = 0;
  for (const b of bars) {
    const tsec = Math.floor(b.date.getTime() / 1000);
    const inRegular = regStartSec && regEndSec
      ? (tsec >= regStartSec && tsec <= regEndSec)
      : isRegularLocal(tsec, gmtoffsetSec);

    if (!inRegular) continue;

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

// Rolling VWAP fallback (last N bars, any session)
function rollingVWAP(bars, n = 20) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  const start = Math.max(0, bars.length - n);
  let pv = 0, vol = 0;
  for (let i = start; i < bars.length; i++) {
    const b = bars[i];
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

// -------------------- intraday fetch (range-only via native fetch) --------------------
/**
 * cache[ticker][key] = { ts, closes, bars, gmtoffsetSec, regStartSec, regEndSec }
 * key: '5m' | '15m' | '1h'
 */
const cache = {};
const TTL      = { '5m': 60_000, '15m': 120_000, '1h': 300_000 };
const INTERVAL = { '5m': '5m',   '15m': '15m',   '1h': '1h' };
const RANGE    = { '5m': '1d',   '15m': '1mo',   '1h': '3mo' };

async function fetchYahooChart(ticker, { interval, range, includePrePost = false }) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set('interval', interval);
  url.searchParams.set('range', range);
  if (includePrePost) url.searchParams.set('includePrePost', 'true');

  const r = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Node) TV-Scanner',
      'Accept': 'application/json,text/plain,*/*'
    }
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${r.statusText} ${txt.slice(0,120)}`);
  }
  const json = await r.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No result');

  const timestamps = result.timestamp || [];
  const indicators = result.indicators?.quote?.[0] || {};
  const meta       = result.meta || {};

  const bars = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    bars.push({
      date: new Date(ts * 1000),
      open: indicators.open?.[i],
      high: indicators.high?.[i],
      low:  indicators.low?.[i],
      close:indicators.close?.[i],
      volume:indicators.volume?.[i]
    });
  }
  return { quotes: bars, meta };
}

async function fetchIntradaySeries(ticker, key) {
  const nowMs = Date.now();
  const c = cache[ticker]?.[key];
  if (c && (nowMs - c.ts) < TTL[key]) return c;

  const interval = INTERVAL[key];
  const range    = RANGE[key];
  const includePrePost = key === '5m'; // keep pre/post for data, but we'll filter when needed

  const result = await fetchYahooChart(ticker, { interval, range, includePrePost });

  const quotes       = Array.isArray(result?.quotes) ? result.quotes : [];
  const gmtoffsetSec = Number(result?.meta?.gmtoffset) || 0;

  const reg = result?.meta?.currentTradingPeriod?.regular || {};
  const regStartSec = Number(reg.start) || null; // epoch seconds
  const regEndSec   = Number(reg.end)   || null; // epoch seconds

  const closes = [];
  const bars   = [];
  for (const q of quotes) {
    if (isNum(q?.close)) closes.push(q.close);
    bars.push({
      date: q.date || new Date(),
      open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume
    });
  }

  const packed = { ts: nowMs, closes, bars, gmtoffsetSec, regStartSec, regEndSec };
  cache[ticker] = cache[ticker] || {};
  cache[ticker][key] = packed;
  return packed;
}

// -------------------- individual fetchers --------------------
async function fetchPriceOnly(ticker) {
  try {
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
    const { bars, gmtoffsetSec, regStartSec, regEndSec } = await fetchIntradaySeries(ticker, key);
    let v = sessionVWAP(bars, gmtoffsetSec, regStartSec, regEndSec);
    if (v == null) v = rollingVWAP(bars, 20);
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
    const dailyBars = await yahooFinance.historical(ticker, { period1, period2, interval: '1d' });
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

// previous-day high (PDH)
async function fetchPrevDayHigh(ticker) {
  try {
    const period2 = new Date();
    const period1 = new Date(Date.now() - 15 * 24 * 3600 * 1000);
    const dailyBars = await yahooFinance.historical(ticker, { period1, period2, interval: '1d' });
    if (Array.isArray(dailyBars) && dailyBars.length >= 2) {
      const prev = dailyBars[dailyBars.length - 2];
      if (isNum(prev?.high)) return Number(prev.high.toFixed(2));
    }
    return 'N/A';
  } catch (e) {
    console.warn(`[marketData] fetchPrevDayHigh failed ${ticker}:`, e.message);
    return 'N/A';
  }
}

// -------- Regular session detector (fallback when meta missing) --------
function isRegularLocal(tsec, gmtoffsetSec) {
  // convert to exchange-local wall clock using meta gmtoffset
  const d = new Date((tsec + (gmtoffsetSec || 0)) * 1000);
  const hm = d.getUTCHours() * 60 + d.getUTCMinutes(); // in minutes
  // 09:30 to 16:00 inclusive of 16:00 bar start
  return hm >= (9 * 60 + 30) && hm <= (16 * 60);
}

// NEW: did today's REGULAR session touch a level?
function touchedLevelToday(bars, level, { gmtoffsetSec, regStartSec, regEndSec }) {
  if (!Array.isArray(bars) || !isNum(level)) return false;

  for (const b of bars) {
    const tsec = Math.floor(b.date.getTime() / 1000);

    // Use Yahoo meta regular session if available; otherwise use 9:30–16:00 local.
    const inRegular = (regStartSec && regEndSec)
      ? (tsec >= regStartSec && tsec <= regEndSec)
      : isRegularLocal(tsec, gmtoffsetSec);

    if (!inRegular) continue;

    const lo = num(b.low), hi = num(b.high);
    if (!isNum(lo) || !isNum(hi)) continue;
    if (lo <= level && level <= hi) return true;
  }
  return false;
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

// Return the most recent alert for a ticker from a list
function latestAlertFor(ticker, alerts) {
  if (!Array.isArray(alerts) || !ticker) return null;
  const t = String(ticker).toUpperCase();
  let best = null;

  for (const a of alerts) {
    if (!a || String(a.Ticker).toUpperCase() !== t) continue;
    const when = a.ts ? Date.parse(a.ts) : null; // optional ISO timestamp
    if (!best) best = { ...a, _t: when ?? 0 };
    else {
      const cmp = a.ts ? Date.parse(a.ts) : null;
      if ((cmp ?? 0) > best._t) best = { ...a, _t: cmp ?? 0 };
    }
  }
  return best;
}

// Load latest AI signals for a ticker from the three alert files
function loadLatestAISignals(dataDir, ticker) {
  const f5  = path.join(dataDir, 'alerts_5m.json');
  const f15 = path.join(dataDir, 'alerts_15m.json');
  const f1h = path.join(dataDir, 'alerts_1h.json');

  const a5  = safeLoad(f5);
  const a15 = safeLoad(f15);
  const a1h = safeLoad(f1h);

  const last5  = latestAlertFor(ticker, a5);
  const last15 = latestAlertFor(ticker, a15);
  const last1h = latestAlertFor(ticker, a1h);

  const norm = (a) => !a ? null : ({
    alert: a.Alert || a.alert || '',   // "Buy"/"Sell"
    zone:  a.Zone  || a.zone  || '',   // "green"/"red" (optional)
    time:  a.Time  || a.time  || a.ts || '' // friendly or ISO time
  });

  return {
    AI_5m:  norm(last5),
    AI_15m: norm(last15),
    AI_1h:  norm(last1h),
  };
}

// -------------------- dual-cadence updater --------------------
const currentData = {}; // { [TICKER]: { Price, DayMid, MA..., VWAP..., TouchMid, TouchPDH, AI_* } }

function assignIfNum(obj, key, val) { if (isNum(val)) obj[key] = val; }

function mergeTicker(t, patch) {
  const prev = currentData[t] || {};
  const next = { ...prev };

  // Only update when incoming value is numeric (keep last-good)
  if ('Price'   in patch) assignIfNum(next, 'Price',   patch.Price);
  if ('DayMid'  in patch) assignIfNum(next, 'DayMid',  patch.DayMid);

  if ('MA20_5m'  in patch) assignIfNum(next, 'MA20_5m',  patch.MA20_5m);
  if ('VWAP_5m'  in patch) assignIfNum(next, 'VWAP_5m',  patch.VWAP_5m);
  if ('MA20_15m' in patch) assignIfNum(next, 'MA20_15m', patch.MA20_15m);
  if ('VWAP_15m' in patch) assignIfNum(next, 'VWAP_15m', patch.VWAP_15m);
  if ('MA20_1h'  in patch) assignIfNum(next, 'MA20_1h',  patch.MA20_1h);
  if ('VWAP_1h'  in patch) assignIfNum(next, 'VWAP_1h',  patch.VWAP_1h);

  // Booleans copy through as-is
  if ('TouchMid'  in patch) next.TouchMid  = !!patch.TouchMid;
  if ('TouchPDH'  in patch) next.TouchPDH  = !!patch.TouchPDH;

  // AI signals (objects copied as-is; last non-null wins)
  if ('AI_5m'  in patch && patch.AI_5m)  next.AI_5m  = patch.AI_5m;
  if ('AI_15m' in patch && patch.AI_15m) next.AI_15m = patch.AI_15m;
  if ('AI_1h'  in patch && patch.AI_1h)  next.AI_1h  = patch.AI_1h;

  currentData[t] = next;
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
    // include latest AI signals even on the fast pass (keeps UI snappy)
    const ai = loadLatestAISignals(dataDir, t);
    mergeTicker(t, { Price, ...ai });
  }

  io.emit('priceUpdate', { ...currentData }); // full snapshot
}

async function runMetricsPass(io, dataDir) {
  const tickers = readTickersFromFiles(dataDir);
  if (tickers.length === 0) return;

  for (const t of tickers) {
    // eslint-disable-next-line no-await-in-loop
    const [ma5, vw5Series, ma15, vw15Series, mah, vwhSeries, dayMid, pdh, series5] = await Promise.all([
      fetchMA20(t, '5m'),  fetchIntradaySeries(t, '5m'),
      fetchMA20(t, '15m'), fetchIntradaySeries(t, '15m'),
      fetchMA20(t, '1h'),  fetchIntradaySeries(t, '1h'),
      fetchPrevDayMid(t),
      fetchPrevDayHigh(t),
      fetchIntradaySeries(t, '5m'),
    ]);

    const vw5  = sessionVWAP(vw5Series.bars,  vw5Series.gmtoffsetSec,  vw5Series.regStartSec,  vw5Series.regEndSec)  ?? rollingVWAP(vw5Series.bars, 20);
    const vw15 = sessionVWAP(vw15Series.bars, vw15Series.gmtoffsetSec, vw15Series.regStartSec, vw15Series.regEndSec) ?? rollingVWAP(vw15Series.bars, 20);
    const vwh  = sessionVWAP(vwhSeries.bars,  vwhSeries.gmtoffsetSec,  vwhSeries.regStartSec,  vwhSeries.regEndSec)  ?? rollingVWAP(vwhSeries.bars, 20);

    // Regular-hours touch flags
    const touchedMid = isNum(dayMid) && touchedLevelToday(series5.bars, dayMid, {
      gmtoffsetSec: series5.gmtoffsetSec,
      regStartSec:  series5.regStartSec,
      regEndSec:    series5.regEndSec
    });

    const touchedPDH = isNum(pdh) && touchedLevelToday(series5.bars, pdh, {
      gmtoffsetSec: series5.gmtoffsetSec,
      regStartSec:  series5.regStartSec,
      regEndSec:    series5.regEndSec
    });

    // latest AI signals (slow pass also refreshes)
    const ai = loadLatestAISignals(dataDir, t);

    mergeTicker(t, {
      DayMid: dayMid,
      MA20_5m:  isNum(ma5)  ? Number(ma5.toFixed(2))  : ma5,
      VWAP_5m:  isNum(vw5)  ? Number(vw5.toFixed(2))  : vw5,
      MA20_15m: isNum(ma15) ? Number(ma15.toFixed(2)) : ma15,
      VWAP_15m: isNum(vw15) ? Number(vw15.toFixed(2)) : vw15,
      MA20_1h:  isNum(mah)  ? Number(mah.toFixed(2))  : mah,
      VWAP_1h:  isNum(vwh)  ? Number(vwh.toFixed(2))  : vwh,
      TouchMid:  touchedMid,
      TouchPDH:  touchedPDH,

      // AI fields
      AI_5m:  ai.AI_5m,
      AI_15m: ai.AI_15m,
      AI_1h:  ai.AI_1h,
    });
  }

  io.emit('priceUpdate', { ...currentData }); // full snapshot (with fresh metrics + flags)
}

/**
 * startMarketDataUpdater(io, { dataDir, fastMs = 5000, slowMs = 60000 })
 */
function startMarketDataUpdater(io, { dataDir, fastMs = 5000, slowMs = 60000 }) {
  setTimeout(() => io.emit('priceUpdate', {}), 500);
  setInterval(() => { runPricePass(io, dataDir).catch(e => console.warn('[price pass]', e.message)); }, fastMs);
  setInterval(() => { runMetricsPass(io, dataDir).catch(e => console.warn('[metrics pass]', e.message)); }, slowMs);
  runMetricsPass(io, dataDir).catch(() => {});
}

module.exports = {
  startMarketDataUpdater,
  fetchPriceOnly,
};
