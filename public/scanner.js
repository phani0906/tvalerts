// scanner.js
const socket = io();

/* ========= State ========= */
let alerts5m = [];     // deduped by ticker
let alerts15m = [];    // deduped by ticker
let priceData = {};

/* ========= Tolerances (keep your existing values) ========= */
const TOLERANCE = {
  // 5m
  ma20_5m: 0.50,
  vwap_5m: 0.50,
  daymid_5m: 1.00,
  // 15m (you can tune these)
  ma20_15m: 1.00,
  vwap_15m: 1.00,
  daymid_15m: 1.00,
};
window.TOLERANCE = TOLERANCE;

/* ========= Helpers ========= */
const toNum = v =>
  (v === null || v === undefined || v === '' || v === 'N/A') ? null : Number(v);

const fmt2 = v =>
  (v === null || Number.isNaN(v)) ? '' : Number(v).toFixed(2);

function fillMetricCell(td, metricVal, price, tolerance) {
  td.classList.remove('near-zero', 'blink', 'border-gold-blink');
  td.textContent = '';

  const m = toNum(metricVal);
  const p = toNum(price);
  if (m === null) { td.textContent = ''; return; }
  if (p === null) { td.textContent = fmt2(m); return; }

  const diff = p - m;
  const diffStr = `${diff >= 0 ? '+' : ''}${fmt2(diff)}`;

  const base = document.createElement('span');
  base.textContent = fmt2(m);

  const gap = document.createTextNode(' ');
  const wrap = document.createElement('span');
  wrap.className = diff >= 0 ? 'diff-up' : 'diff-down';
  wrap.textContent = `(${diffStr})`;

  td.appendChild(base);
  td.appendChild(gap);
  td.appendChild(wrap);

  if (tolerance != null && Math.abs(diff) <= tolerance) {
    // use your existing highlight classes
    td.classList.add('near-zero', 'blink');
  }
}

/** normalize row so we can refer to AI_5m / AI_15m consistently */
function normalizeRow(row) {
  const r = { ...row };
  if (r.Timeframe === 'AI_5m' && !r.AI_5m && r.Alert) r.AI_5m = r.Alert;
  if (r.Timeframe === 'AI_15m' && !r.AI_15m && r.Alert) r.AI_15m = r.Alert;
  return r;
}

/** Dedupe by Ticker, keep newest by ReceivedAt (or later wins) */
function dedupe(rows, timeframeKey) {
  const map = new Map();
  rows.forEach(raw => {
    const r = normalizeRow(raw);
    if (r.Timeframe !== timeframeKey) return;
    const prev = map.get(r.Ticker);
    if (!prev) { map.set(r.Ticker, r); return; }

    const tNew = r.ReceivedAt ? Date.parse(r.ReceivedAt) : Number.POSITIVE_INFINITY;
    const tOld = prev.ReceivedAt ? Date.parse(prev.ReceivedAt) : Number.NEGATIVE_INFINITY;
    if (tNew >= tOld) map.set(r.Ticker, r);
  });
  return Array.from(map.values());
}

/* ========= Renderers =========
   Columns: Time | Ticker | Price | Alert | MA20 | VWAP | DayMid
*/

/** 5-minute tables */
function renderFiveMinTable() {
  const buyTbody  = document.querySelector('#scannerTableBuy tbody');
  const sellTbody = document.querySelector('#scannerTableSell tbody');
  if (!buyTbody || !sellTbody) return;

  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  alerts5m.forEach(a => {
    const row = document.createElement('tr');
    const p = priceData[a.Ticker] || {};

    // Time
    let td = document.createElement('td');
    td.textContent = a.Time || '';
    row.appendChild(td);

    // Ticker
    td = document.createElement('td');
    td.textContent = a.Ticker || '';
    row.appendChild(td);

    // Price
    td = document.createElement('td');
    td.textContent = fmt2(toNum(p.Price));
    row.appendChild(td);

    // Alert (Buy/Sell)
    td = document.createElement('td');
    const alertVal = a.AI_5m || a.Alert || '';
    td.textContent = alertVal;
    if ((alertVal || '').toLowerCase() === 'buy')  td.classList.add('signal-buy');
    if ((alertVal || '').toLowerCase() === 'sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // MA20 (5m)
    td = document.createElement('td');
    fillMetricCell(td, p.MA20_5m, p.Price, TOLERANCE.ma20_5m);
    row.appendChild(td);

    // VWAP (5m)
    td = document.createElement('td');
    fillMetricCell(td, p.VWAP_5m, p.Price, TOLERANCE.vwap_5m);
    row.appendChild(td);

    // DayMid
    td = document.createElement('td');
    fillMetricCell(td, p.DayMid, p.Price, TOLERANCE.daymid_5m);
    row.appendChild(td);

    const isBuy = (alertVal || '').toLowerCase() === 'buy';
    (isBuy ? buyTbody : sellTbody).appendChild(row);
  });
}

/** 15-minute tables */
function renderFifteenMinTable() {
  const buyTbody  = document.querySelector('#scannerTableBuy15 tbody');
  const sellTbody = document.querySelector('#scannerTableSell15 tbody');
  if (!buyTbody || !sellTbody) return;

  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  alerts15m.forEach(a => {
    const row = document.createElement('tr');
    const p = priceData[a.Ticker] || {};

    // Time
    let td = document.createElement('td');
    td.textContent = a.Time || '';
    row.appendChild(td);

    // Ticker
    td = document.createElement('td');
    td.textContent = a.Ticker || '';
    row.appendChild(td);

    // Price
    td = document.createElement('td');
    td.textContent = fmt2(toNum(p.Price));
    row.appendChild(td);

    // Alert (Buy/Sell)
    td = document.createElement('td');
    const alertVal = a.AI_15m || a.Alert || '';
    td.textContent = alertVal;
    if ((alertVal || '').toLowerCase() === 'buy')  td.classList.add('signal-buy');
    if ((alertVal || '').toLowerCase() === 'sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // MA20 (15m)
    td = document.createElement('td');
    fillMetricCell(td, p.MA20_15m, p.Price, TOLERANCE.ma20_15m);
    row.appendChild(td);

    // VWAP (15m)
    td = document.createElement('td');
    fillMetricCell(td, p.VWAP_15m, p.Price, TOLERANCE.vwap_15m);
    row.appendChild(td);

    // DayMid
    td = document.createElement('td');
    fillMetricCell(td, p.DayMid, p.Price, TOLERANCE.daymid_15m);
    row.appendChild(td);

    const isBuy = (alertVal || '').toLowerCase() === 'buy';
    (isBuy ? buyTbody : sellTbody).appendChild(row);
  });
}

/* ========= Sockets ========= */
// 5m stream
socket.on('alertsUpdate:AI_5m', (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  alerts5m = dedupe(list, 'AI_5m');
  renderFiveMinTable();
});

// 15m stream
socket.on('alertsUpdate:AI_15m', (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  alerts15m = dedupe(list, 'AI_15m');
  renderFifteenMinTable();
});

// live prices (same feed drives both tables)
socket.on('priceUpdate', (data) => {
  priceData = data || {};
  renderFiveMinTable();
  renderFifteenMinTable();
});

/* ========= Initial loads ========= */
(async function boot() {
  try {
    // initial 5m
    const r5 = await fetch('/alerts/5m', { cache: 'no-store' });
    const d5 = await r5.json();
    alerts5m = dedupe(Array.isArray(d5) ? d5 : [], 'AI_5m');
  } catch(e){ console.warn('Failed to load /alerts/5m', e); }

  try {
    // initial 15m
    const r15 = await fetch('/alerts/15m', { cache: 'no-store' });
    const d15 = await r15.json();
    alerts15m = dedupe(Array.isArray(d15) ? d15 : [], 'AI_15m');
  } catch(e){ console.warn('Failed to load /alerts/15m', e); }

  renderFiveMinTable();
  renderFifteenMinTable();
})();
