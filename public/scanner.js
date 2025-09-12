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

  // If metric is missing, show nothing
  if (m === null) return;

  // If price missing, show metric only
  if (p === null) { td.textContent = fmt2(m); return; }

  // Both present → show value + diff
  const diff = p - m;
  const base = document.createElement('span');
  base.textContent = fmt2(m);

  const wrap = document.createElement('span');
  wrap.className = diff >= 0 ? 'diff-up' : 'diff-down';
  wrap.textContent = ` (${diff >= 0 ? '+' : ''}${fmt2(diff)})`;

  td.appendChild(base);
  td.appendChild(wrap);

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
    td = document.createElement('td'); td.textContent = fmt2(toNum(p.Price)); row.appendChild(td);

    td = document.createElement('td');
    const alertVal = a.AI_15m || a.Alert || '';
    td.textContent = alertVal;
    if ((alertVal || '').toLowerCase() === 'buy')  td.classList.add('signal-buy');
    if ((alertVal || '').toLowerCase() === 'sell') td.classList.add('signal-sell');
    row.appendChild(td);

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
    td = document.createElement('td'); td.textContent = fmt2(toNum(p.Price)); row.appendChild(td);

    td = document.createElement('td');
    const alertVal = a.AI_1h || a.Alert || '';
    td.textContent = alertVal;
    if ((alertVal || '').toLowerCase() === 'buy')  td.classList.add('signal-buy');
    if ((alertVal || '').toLowerCase() === 'sell') td.classList.add('signal-sell');
    row.appendChild(td);

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
    const box = document.getElementById('quoteBox');
    if (box) {
      box.innerHTML = '';
      const q = document.createElement('div');
      q.textContent = text || '';
      const a = document.createElement('small');
      a.textContent = author ? `— ${author}` : '';
      box.appendChild(q);
      box.appendChild(a);
    }
  } catch (_e) {
    // Optional: leave prior quote or noop
  }
}

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

