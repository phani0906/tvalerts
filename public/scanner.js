// public/scanner.js
/* global io */

const socket = io();

/* ========= State ========= */
let alerts5m = [];
let alerts15m = [];
let alerts1h = [];
let priceData = {}; // { TICKER: { Price, DayMid, MA20_5m, ... } }

/* ========= Tolerances (gold blink when |price - metric| <= tolerance) ========= */
const TOLERANCE = {
  // 5m
  ma20_5m: 0.50,
  vwap_5m: 0.50,
  daymid_5m: 1.00,
  // 15m
  ma20_15m: 1.00,
  vwap_15m: 1.00,
  daymid_15m: 1.00,
  // 1h
  ma20_1h: 2.00,
  vwap_1h: 2.00,
  daymid_1h: 1.00
};
window.TOLERANCE = TOLERANCE;

/* ========= Helpers ========= */
const toNum = v =>
  (v === null || v === undefined || v === '' || v === 'N/A' || v === 'Error')
    ? null : Number(v);

const fmt2 = v =>
  (v === null || Number.isNaN(v)) ? '' : Number(v).toFixed(2);

function formatTime(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d)) return str; // fallback if not parsable
  return d.toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',   // "Sep"
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).replace(',', ''); // "12 Sep 14:30"
}

/** Fill a metric cell with "value (+/-diff)"; skip diff if either side missing */
function fillMetricCell(td, metricVal, price, tolerance) {
  td.classList.remove('near-zero','blink');
  td.textContent = '';

  const m = toNum(metricVal);
  const p = toNum(price);
  if (m === null) return;

  if (p === null) { td.textContent = fmt2(m); return; }

  const diff = p - m;

  // Show value + diff in one line
  const span = document.createElement('span');
  span.textContent = `${fmt2(m)} (${diff >= 0 ? '+' : ''}${fmt2(diff)})`;
  span.className = diff >= 0 ? 'diff-up' : 'diff-down';
  td.appendChild(span);

  if (tolerance != null && Math.abs(diff) <= tolerance) {
    td.classList.add('near-zero','blink');
  }
}


function normalizeRow(row) {
  const r = { ...row };
  // Backfill AI_* from Alert so the “Alert” column shows even for plain TV alerts
  if (r.Timeframe === 'AI_5m'  && !r.AI_5m  && r.Alert) r.AI_5m  = r.Alert;
  if (r.Timeframe === 'AI_15m' && !r.AI_15m && r.Alert) r.AI_15m = r.Alert;
  if (r.Timeframe === 'AI_1h'  && !r.AI_1h  && r.Alert) r.AI_1h  = r.Alert;
  // Normalize tickers once
  r.Ticker = String(r.Ticker || '').toUpperCase();
  return r;
}

function dedupe(rows, timeframeKey) {
  const map = new Map();
  (rows || []).forEach(raw => {
    const r = normalizeRow(raw);
    if (r.Timeframe !== timeframeKey) return;
    const prev = map.get(r.Ticker);
    if (!prev) { map.set(r.Ticker, r); return; }
    const tNew = r.ReceivedAt ? Date.parse(r.ReceivedAt) : 0;
    const tOld = prev.ReceivedAt ? Date.parse(prev.ReceivedAt) : 0;
    if (tNew >= tOld) map.set(r.Ticker, r);
  });
  return Array.from(map.values());
}

/* ========= Renderers ========= */
function renderFiveMinTable() {
  const buyTbody  = document.querySelector('#scannerTableBuy tbody');
  const sellTbody = document.querySelector('#scannerTableSell tbody');
  if (!buyTbody || !sellTbody) return;
  buyTbody.innerHTML = ''; sellTbody.innerHTML = '';

  alerts5m.forEach(a => {
    const tkr = a.Ticker;
    const p = priceData[tkr] || {};
    const row = document.createElement('tr');

    let td = document.createElement('td'); td.textContent = formatTime(a.Time); row.appendChild(td);
    td = document.createElement('td'); td.textContent = tkr; row.appendChild(td);

    td = document.createElement('td');
    const alertVal = a.AI_5m || a.Alert || '';
    td.textContent = alertVal;
    if ((alertVal || '').toLowerCase() === 'buy')  td.classList.add('signal-buy');
    if ((alertVal || '').toLowerCase() === 'sell') td.classList.add('signal-sell');
    row.appendChild(td);

    td = document.createElement('td'); td.textContent = fmt2(toNum(p.Price)); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.MA20_5m, p.Price, TOLERANCE.ma20_5m); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.VWAP_5m, p.Price, TOLERANCE.vwap_5m); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.DayMid,  p.Price, TOLERANCE.daymid_5m); row.appendChild(td);

    ((alertVal || '').toLowerCase() === 'buy' ? buyTbody : sellTbody).appendChild(row);
  });
}

function renderFifteenMinTable() {
  const buyTbody  = document.querySelector('#scannerTableBuy15 tbody');
  const sellTbody = document.querySelector('#scannerTableSell15 tbody');
  if (!buyTbody || !sellTbody) return;
  buyTbody.innerHTML = ''; sellTbody.innerHTML = '';

  alerts15m.forEach(a => {
    const tkr = a.Ticker;
    const p = priceData[tkr] || {};
    const row = document.createElement('tr');

    let td = document.createElement('td'); td.textContent = formatTime(a.Time); row.appendChild(td);
    td = document.createElement('td'); td.textContent = tkr; row.appendChild(td);

    // ALERT (now before Price to match headers)
    td = document.createElement('td');
    const alertVal = a.AI_15m || a.Alert || '';
    td.textContent = alertVal;
    if ((alertVal || '').toLowerCase() === 'buy')  td.classList.add('signal-buy');
    if ((alertVal || '').toLowerCase() === 'sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // PRICE
    td = document.createElement('td'); td.textContent = fmt2(toNum(p.Price)); row.appendChild(td);

    td = document.createElement('td'); fillMetricCell(td, p.MA20_15m, p.Price, TOLERANCE.ma20_15m); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.VWAP_15m, p.Price, TOLERANCE.vwap_15m); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.DayMid,     p.Price, TOLERANCE.daymid_15m); row.appendChild(td);

    ((alertVal || '').toLowerCase() === 'buy' ? buyTbody : sellTbody).appendChild(row);
  });
}


function renderOneHrTable() {
  const buyTbody  = document.querySelector('#scannerTableBuy1h tbody');
  const sellTbody = document.querySelector('#scannerTableSell1h tbody');
  if (!buyTbody || !sellTbody) return;
  buyTbody.innerHTML = ''; sellTbody.innerHTML = '';

  alerts1h.forEach(a => {
    const tkr = a.Ticker;
    const p = priceData[tkr] || {};
    const row = document.createElement('tr');

    let td = document.createElement('td'); td.textContent = formatTime(a.Time); row.appendChild(td);
    td = document.createElement('td'); td.textContent = tkr; row.appendChild(td);

    // ALERT (now before Price to match headers)
    td = document.createElement('td');
    const alertVal = a.AI_1h || a.Alert || '';
    td.textContent = alertVal;
    if ((alertVal || '').toLowerCase() === 'buy')  td.classList.add('signal-buy');
    if ((alertVal || '').toLowerCase() === 'sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // PRICE
    td = document.createElement('td'); td.textContent = fmt2(toNum(p.Price)); row.appendChild(td);

    td = document.createElement('td'); fillMetricCell(td, p.MA20_1h, p.Price, TOLERANCE.ma20_1h); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.VWAP_1h, p.Price, TOLERANCE.vwap_1h); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.DayMid,  p.Price, TOLERANCE.daymid_1h); row.appendChild(td);

    ((alertVal || '').toLowerCase() === 'buy' ? buyTbody : sellTbody).appendChild(row);
  });
}


/* ========= Socket wiring ========= */
socket.on('alertsUpdate:AI_5m', rows => {
  alerts5m = dedupe(Array.isArray(rows) ? rows : [], 'AI_5m');
  renderFiveMinTable();
});
socket.on('alertsUpdate:AI_15m', rows => {
  alerts15m = dedupe(Array.isArray(rows) ? rows : [], 'AI_15m');
  renderFifteenMinTable();
});
socket.on('alertsUpdate:AI_1h', rows => {
  alerts1h = dedupe(Array.isArray(rows) ? rows : [], 'AI_1h');
  renderOneHrTable();
});

socket.on('priceUpdate', data => {
  // Normalize keys once so lookups always match
  const out = {};
  Object.entries(data || {}).forEach(([k, v]) => { out[String(k).toUpperCase()] = v; });
  priceData = out;

  renderFiveMinTable();
  renderFifteenMinTable();
  renderOneHrTable();
});

/* ========= Initial loads ========= */
(async function boot() {
  try {
    const r5 = await fetch('/alerts/5m', { cache: 'no-store' });
    alerts5m = dedupe(await r5.json(), 'AI_5m');
  } catch (e) { console.warn('Failed /alerts/5m', e); }

  try {
    const r15 = await fetch('/alerts/15m', { cache: 'no-store' });
    alerts15m = dedupe(await r15.json(), 'AI_15m');
  } catch (e) { console.warn('Failed /alerts/15m', e); }

  try {
    const r1h = await fetch('/alerts/1h', { cache: 'no-store' });
    alerts1h = dedupe(await r1h.json(), 'AI_1h');
  } catch (e) { console.warn('Failed /alerts/1h', e); }

  renderFiveMinTable();
  renderFifteenMinTable();
  renderOneHrTable();
})();

/* ========= Motivational Quote (via server proxy) ========= */
async function loadQuote() {
  try {
    const r = await fetch('/quote', { cache: 'no-store' });
    if (!r.ok) throw new Error('quote http ' + r.status);
    const { text, author } = await r.json();
    const el = document.getElementById('quote-text');
    if (el) {
      el.textContent = author ? `${text} — ${author}` : (text || '');
    }
  } catch (e) {
    const el = document.getElementById('quote-text');
    if (el) el.textContent = 'Trade your plan. Manage risk. Stay patient.';
    console.warn('quote load failed', e);
  }
}
loadQuote();
setInterval(loadQuote, 60 * 60 * 1000);


function msUntilTopOfHour() {
  const now = new Date();
  return (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
}

// Kick off: load immediately, then at the top of next hour, then every hour
(async function bootQuote() {
  await loadQuote();
  setTimeout(() => {
    loadQuote();
    setInterval(loadQuote, 3600_000); // hourly
  }, Math.max(1000, msUntilTopOfHour()));
})();

async function fetchQuote() {
  try {
    const res = await fetch('/quote', { cache: 'no-store' }); // or your API
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { text, author } = await res.json();
    return `${text} — ${author || 'Unknown'}`;
  } catch {
    return 'Consistency compounds; small edges, repeated, become big wins. — Unknown';
  }
}

function setQuote(text) {
  const el = document.getElementById('quote-text');
  if (!el) return;

  el.textContent = text;

  // Adjust speed so long quotes don’t fly by too fast (clamp 16–40s)
  const chars = text.length;
  const duration = Math.max(16, Math.min(40, Math.round((chars + window.innerWidth / 8) / 6)));
  el.style.setProperty('--marquee-duration', `${duration}s`);

  // Restart animation (so new quote starts from the right immediately)
  el.style.animation = 'none';
  void el.offsetWidth; // reflow
  el.style.animation = ''; // uses CSS-defined animation again
}

(async function bootQuoteLoop() {
  setQuote('Loading quote…');
  setQuote(await fetchQuote());

  // Refresh the quote at the top of the hour, then hourly
  function msUntilTopOfHour() {
    const now = new Date();
    return (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
  }

  setTimeout(async () => {
    setQuote(await fetchQuote());
    setInterval(async () => setQuote(await fetchQuote()), 3600_000);
  }, Math.max(1000, msUntilTopOfHour()));
})();
