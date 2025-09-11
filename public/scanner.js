// scanner.js
const socket = io();

let alerts = [];     // 5m ONLY, deduped
let priceData = {};

/* ===== tolerances (unchanged) ===== */
const TOLERANCE = {
  ma20_5m: 0.50,
  vwap_5m: 0.50,
  daymid:  1.00,
};
window.TOLERANCE = TOLERANCE;

/* ===== helpers ===== */
const toNum = v =>
  (v === null || v === undefined || v === '' || v === 'N/A') ? null : Number(v);

const fmt2 = v =>
  (v === null || Number.isNaN(v)) ? '' : Number(v).toFixed(2);

function fillMetricCell(td, metricVal, price, tolerance) {
  td.classList.remove('near-zero', 'blink');
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
    td.classList.add('near-zero', 'blink');
  }
}

/** Normalize so we can read a.AI_5m even if server sends `Alert` */
function normalizeRow(row) {
  const r = { ...row };
  if (!r.AI_5m && r.Alert) r.AI_5m = r.Alert;
  return r;
}

/** Keep only AI_5m rows, dedupe by Ticker keeping most-recent by ReceivedAt */
function dedupe5m(rows) {
  const map = new Map(); // ticker -> row
  rows.forEach((raw, idx) => {
    const r = normalizeRow(raw);
    if (r.Timeframe !== 'AI_5m' && !r.AI_5m) return;

    const key = r.Ticker;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, r);
      return;
    }
    // choose newest by ReceivedAt; fallback to "later in list wins"
    const tNew = r.ReceivedAt ? Date.parse(r.ReceivedAt) : Number.POSITIVE_INFINITY;
    const tOld = prev.ReceivedAt ? Date.parse(prev.ReceivedAt) : Number.NEGATIVE_INFINITY;
    if (tNew >= tOld) map.set(key, r);
  });
  return Array.from(map.values());
}

/* ===== render (Time | Ticker | Price | Alert | MA20(5m) | VWAP(5m) | DayMid) ===== */
function renderTable() {
  const buyTbody  = document.querySelector('#scannerTableBuy tbody');
  const sellTbody = document.querySelector('#scannerTableSell tbody');
  if (!buyTbody || !sellTbody) return;

  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  const rows = alerts; // already AI_5m-only & deduped

  rows.forEach(a => {
    const row = document.createElement('tr');
    const p = priceData[a.Ticker] || {};

    // 0 Time
    let td = document.createElement('td');
    td.textContent = a.Time || '';
    row.appendChild(td);

    // 1 Ticker
    td = document.createElement('td');
    td.textContent = a.Ticker || '';
    row.appendChild(td);

    // 2 Price
    td = document.createElement('td');
    td.textContent = fmt2(toNum(p.Price));
    row.appendChild(td);

    // 3 Alert (AI_5m)
    td = document.createElement('td');
    td.textContent = a.AI_5m || '';
    if (td.textContent === 'Buy')  td.classList.add('signal-buy');
    if (td.textContent === 'Sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // 4 MA20(5m)
    td = document.createElement('td');
    fillMetricCell(td, p.MA20_5m, p.Price, TOLERANCE.ma20_5m);
    row.appendChild(td);

    // 5 VWAP(5m)
    td = document.createElement('td');
    fillMetricCell(td, p.VWAP_5m, p.Price, TOLERANCE.vwap_5m);
    row.appendChild(td);

    // 6 DayMid
    td = document.createElement('td');
    fillMetricCell(td, p.DayMid, p.Price, TOLERANCE.daymid);
    row.appendChild(td);

    const isBuy = (a.AI_5m || '').toLowerCase() === 'buy';
    if (isBuy) buyTbody.appendChild(row);
    else       sellTbody.appendChild(row);
  });
}

/* ===== sockets: ONLY 5m stream + prices ===== */

// STRICT: listen only to the per-timeframe event
socket.on('alertsUpdate:AI_5m', (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  alerts = dedupe5m(list);
  renderTable();
});

// DO NOT listen to generic 'alertsUpdate' — it contains mixed timeframes
// If you had one in your file, make sure it's removed.

/* prices */
socket.on('priceUpdate', (data) => {
  priceData = data || {};
  renderTable();
});

/* initial load: only the 5m file */
(async function initialLoad() {
  try {
    const res = await fetch('/alerts/5m', { cache: 'no-store' });
    const data = await res.json();
    alerts = dedupe5m(Array.isArray(data) ? data : []);
    renderTable();
  } catch (e) {
    console.warn('Failed to load /alerts/5m:', e);
  }
})();
