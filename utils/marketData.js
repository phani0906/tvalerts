// marketData.js
// Fetches market data + intraday MA20s and emits to the UI via Socket.IO

const fs = require('fs');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;

const alertsFilePath = path.join(__dirname, '..', 'data', 'alerts.json');

// -------------------- Utilities --------------------
function sma(values, length = 20) {
  const recent = values.slice(-length);
  if (recent.length < length) return null;
  const sum = recent.reduce((a, b) => a + b, 0);
  return sum / length;
}

// In-memory cache to reduce API calls
// shape: { [ticker]: { '5m': { value, ts }, '15m': {...}, '60m': {...} } }
const maCache = {};

// Refresh cadence for each timeframe (ms)
const TTL = {
  '5m': 60 * 1000,      // ~1 minute
  '15m': 2 * 60 * 1000, // ~2 minutes
  '60m': 5 * 60 * 1000  // ~5 minutes
};

// Lookback windows to ensure >= 20 bars for each interval
const LOOKBACK_MS = {
  '5m':  5 * 24 * 60 * 60 * 1000,   // ~5 trading days
  '15m': 30 * 24 * 60 * 60 * 1000,  // ~1 month
  '60m': 90 * 24 * 60 * 60 * 1000   // ~3 months
};

// -------------------- Fetchers --------------------
async function fetchMA20(ticker, intervalKey /* '5m' | '15m' | '60m' */) {
  const now = Date.now();
  const cached = maCache[ticker]?.[intervalKey];
  if (cached && (now - cached.ts) < TTL[intervalKey]) return cached.value;

  try {
    const period2 = new Date(); // now
    const period1 = new Date(now - LOOKBACK_MS[intervalKey]);

    // NOTE: For intraday, yahoo-finance2.chart() needs period1 & period2
    const result = await yahooFinance.chart(ticker, {
      interval: intervalKey,      // '5m' | '15m' | '60m'
      period1,                    // Date
      period2,                    // Date
      includePrePost: false
    });

    const closes = (result?.quotes || [])
      .map(q => q.close)
      .filter(c => typeof c === 'number');

    const avg = sma(closes, 20);
    const value = (avg != null && isFinite(avg)) ? Number(avg.toFixed(2)) : 'N/A';

    maCache[ticker] = maCache[ticker] || {};
    maCache[ticker][intervalKey] = { value, ts: now };

    return value;
  } catch (err) {
    console.error(`MA20 fetch error ${ticker} [${intervalKey}]:`, err.message);
    return 'Error';
  }
}

async function fetchQuoteSummary(ticker) {
  try {
    const quote = await yahooFinance.quoteSummary(ticker, { modules: ['price', 'summaryDetail'] });

    const Price = quote.price?.regularMarketPrice ?? 'N/A';

    // DayMid from current day low/high (fallback to 'N/A' when missing)
    const dayLow = quote.summaryDetail?.dayLow;
    const dayHigh = quote.summaryDetail?.dayHigh;
    const DayMid =
      (typeof dayLow === 'number' && typeof dayHigh === 'number')
        ? Number(((dayLow + dayHigh) / 2).toFixed(2))
        : 'N/A';

    // WeeklyMid from 52-week low/high (your original)
    const wLow = quote.summaryDetail?.fiftyTwoWeekLow;
    const wHigh = quote.summaryDetail?.fiftyTwoWeekHigh;
    const WeeklyMid =
      (typeof wLow === 'number' && typeof wHigh === 'number')
        ? Number(((wLow + wHigh) / 2).toFixed(2))
        : 'N/A';

    return { Price, DayMid, WeeklyMid };
  } catch (err) {
    console.error(`Error fetching quoteSummary for ${ticker}:`, err.message);
    return { Price: 'Error', DayMid: 'Error', WeeklyMid: 'Error' };
  }
}

async function fetchTickerData(ticker) {
  const [summary, ma5m, ma15m, ma1h] = await Promise.all([
    fetchQuoteSummary(ticker),
    fetchMA20(ticker, '5m'),
    fetchMA20(ticker, '15m'),
    fetchMA20(ticker, '60m') // hourly
  ]);

  return {
    Price: summary.Price,
    DayMid: summary.DayMid,
    WeeklyMid: summary.WeeklyMid,
    MA20_5m: ma5m,
    MA20_15m: ma15m,
    MA20_1h: ma1h
  };
}

// -------------------- Updater Loop --------------------
function startMarketDataUpdater(io) {
  setInterval(async () => {
    try {
      if (!fs.existsSync(alertsFilePath)) return;
      const raw = fs.readFileSync(alertsFilePath, 'utf8').trim();
      if (!raw) return;

      let alerts;
      try {
        alerts = JSON.parse(raw);
      } catch (e) {
        console.error('Invalid alerts.json JSON:', e.message);
        return;
      }

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
  }, 5000); // UI refresh interval; MAs themselves are cached by TTL
}

module.exports = { startMarketDataUpdater };
