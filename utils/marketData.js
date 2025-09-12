// marketData.js
// Robust market data fetcher with rate limiting, caching, and safe JSON handling.

const fetch = require("node-fetch");

// ---- Tunables (can be overridden with env) ----
const MAX_CONCURRENT = parseInt(process.env.YF_MAX_CONCURRENT || "1", 10); // keep 1–2 to avoid 429s
const MIN_MS_BETWEEN = parseInt(process.env.YF_MIN_MS || "900", 10);       // ~1 req/sec per pipeline
const CACHE_TTL_MS = parseInt(process.env.MD_CACHE_TTL_MS || "60000", 10); // 60s
const BACKOFF_BASE_MS = 800;
const BACKOFF_MAX_MS = 8000;

// Optional alt provider (leave empty if you don't have keys yet)
const FINNHUB_KEY = process.env.FINNHUB_KEY || "";
// const POLYGON_KEY = process.env.POLYGON_KEY || "";
// const TWELVEDATA_KEY = process.env.TWELVEDATA_KEY || "";

// ---- Simple concurrency limiter ----
let active = 0;
const q = [];
async function schedule(task) {
  return new Promise((resolve, reject) => {
    q.push({ task, resolve, reject });
    pump();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function pump() {
  if (active >= MAX_CONCURRENT || q.length === 0) return;
  const { task, resolve, reject } = q.shift();
  active++;
  try {
    const res = await task();
    // small gap to respect MIN_MS_BETWEEN
    await sleep(MIN_MS_BETWEEN);
    resolve(res);
  } catch (e) {
    reject(e);
  } finally {
    active--;
    if (q.length) pump();
  }
}

// ---- Cache for last-good values ----
const cache = new Map(); // key: `${sym}:${interval}` -> { t, data }
function setCache(key, data) {
  cache.set(key, { t: Date.now(), data });
}
function getCache(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.t > CACHE_TTL_MS) return null;
  return v.data;
}

// ---- Safe JSON fetch with backoff ----
async function fetchJson(url, opts = {}, attempt = 1) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MarketDataBot/1.0; +https://example.local)",
      "Accept": "application/json,text/plain,*/*",
      ...(opts.headers || {})
    }
  });

  if (!res.ok) {
    // Read the body as text for diagnostics
    const text = await res.text().catch(() => "");
    // Handle rate limiting with backoff
    if ((res.status === 429 || res.status === 503) && attempt <= 5) {
      const wait =
        Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, attempt - 1)) +
        Math.floor(Math.random() * 250);
      // eslint-disable-next-line no-console
      console.warn(`[marketData] backoff ${res.status} ${res.statusText} — waiting ${wait}ms`);
      await sleep(wait);
      return fetchJson(url, opts, attempt + 1);
    }
    const msg = `[marketData] HTTP ${res.status} ${res.statusText} -> ${text.slice(0, 120)}`;
    throw new Error(msg);
  }

  // If content-type isn't JSON, guard parsing
  const ct = res.headers.get("content-type") || "";
  const body = await res.text();
  if (!ct.includes("application/json")) {
    // Sometimes Yahoo returns text even on 200; try JSON parse but guard
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`[marketData] Non-JSON body: ${body.slice(0, 120)}`);
    }
  }
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error(`[marketData] JSON parse failed: ${e.message} :: ${body.slice(0, 120)}`);
  }
}

// ---- Yahoo chart helper (batches by symbol+interval) ----
// interval: '5m' | '15m' | '60m' (map your 1h to 60m)
function rangeForInterval(interval) {
  // choose short ranges to reduce payload & rate pressure
  if (interval === "5m") return "1d";
  if (interval === "15m") return "5d";
  if (interval === "60m") return "1mo";
  return "1d";
}

async function getYahooChart(symbol, interval) {
  const i = interval === "1h" ? "60m" : interval; // translate
  const range = rangeForInterval(i);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${i}&range=${range}`;
  return schedule(() => fetchJson(url));
}

// ---- TA helpers ----
function sma(values, len) {
  if (!values || values.length < len) return null;
  const slice = values.slice(-len);
  const sum = slice.reduce((a, b) => a + b, 0);
  return +(sum / len).toFixed(2);
}
function vwapFromSeries(h, l, c, v, len = 20) {
  if (![h, l, c, v].every(arr => Array.isArray(arr) && arr.length)) return null;
  const n = Math.min(len, c.length);
  let pvSum = 0, volSum = 0;
  for (let k = c.length - n; k < c.length; k++) {
    const tp = (h[k] + l[k] + c[k]) / 3;
    pvSum += tp * v[k];
    volSum += v[k];
  }
  if (!volSum) return null;
  return +(pvSum / volSum).toFixed(2);
}

// Placeholder for Day Mid (yesterday’s (H+L)/2) using daily bars
async function getDayMid(symbol) {
  // Use 1d interval over 2d range to get yesterday and today
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  const data = await schedule(() => fetchJson(url));
  const res = data && data.chart && data.chart.result && data.chart.result[0];
  if (!res) return null;
  const h = res.indicators?.quote?.[0]?.high || [];
  const l = res.indicators?.quote?.[0]?.low || [];
  if (h.length < 2 || l.length < 2) return null;
  const yHigh = h[h.length - 2];
  const yLow = l[l.length - 2];
  if (yHigh == null || yLow == null) return null;
  return +(((yHigh + yLow) / 2).toFixed(2));
}

// ---- Main calc for one symbol/interval ----
async function calcFor(symbol, tf) {
  const cacheKey = `${symbol}:${tf}`;
  const cached = getCache(cacheKey);
  if (cached) return { ...cached, _cached: true };

  try {
    const chart = await getYahooChart(symbol, tf === "1h" ? "60m" : tf);
    const res = chart && chart.chart && chart.chart.result && chart.chart.result[0];
    if (!res) throw new Error("Empty chart result");

    const q = res.indicators?.quote?.[0] || {};
    const c = q.close || [];
    const h = q.high || [];
    const l = q.low || [];
    const v = q.volume || [];

    const price = c.length ? +(+c[c.length - 1]).toFixed(2) : null;
    const ma20 = sma(c, 20);
    const vwap = vwapFromSeries(h, l, c, v, 20);
    const dayMid = await getDayMid(symbol); // separate lightweight call; cached by its own limiter

    const payload = { symbol, tf, price, ma20, vwap, dayMid };
    setCache(cacheKey, payload);
    return payload;
  } catch (e) {
    // Log once and return last-good values if any
    console.warn(`${tf} fetch error ${symbol}: ${e.message}`);
    const last = cache.get(cacheKey)?.data || null;
    if (last) return { ...last, _stale: true };
    return { symbol, tf, price: null, ma20: null, vwap: null, dayMid: null, _error: true };
  }
}

// ---- Public API ----
// symbols: string[]; tfs: like ['5m','15m','1h']
// onUpdate: fn(row) -> emit via socket
async function pollAndEmit({ symbols, tfs, onUpdate }) {
  for (const tf of tfs) {
    for (const sym of symbols) {
      // sequential scheduling keeps us under limits
      // eslint-disable-next-line no-await-in-loop
      const row = await calcFor(sym, tf);
      if (typeof onUpdate === "function") {
        onUpdate({
          ticker: sym,
          timeframe: tf,
          price: row.price,
          ma20: row.ma20,
          vwap: row.vwap,
          dayMid: row.dayMid,
          stale: !!row._stale
        });
      }
    }
  }
}

module.exports = {
  pollAndEmit,
  // expose knobs for tests/tuning
  _internals: { fetchJson, schedule, getYahooChart, calcFor, getDayMid }
};
