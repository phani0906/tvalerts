// scanner.js
const socket = io();

let alerts = [];
let priceData = {};

/* =========================
   Configurable tolerances
   ========================= */
const TOLERANCE = {
  ma20_5m: 0.50,  // |Price - MA20(5m)| <= $0.50
  vwap_5m: 0.50,  // |Price - VWAP(5m)| <= $0.50
  daymid:  1.00   // |Price - DayMid|   <= $1.00
};
// (Optional) tweak from console: window.TOLERANCE = TOLERANCE;
window.TOLERANCE = TOLERANCE;

/* =========================
   Helpers
   ========================= */
const toNum = v =>
  (v === null || v === undefined || v === '' || v === 'N/A') ? null : Number(v);

const fmt2 = v =>
  (v === null || Number.isNaN(v)) ? '' : Number(v).toFixed(2);

/**
 * Fill a metric cell with "VALUE (+/-DIFF)" vs current price.
 * Adds gold 4-sided blinking border if |diff| <= tolerance via
 * CSS classes: `near-zero blink` (your CSS handles the animation).
 */
function fillMetricCell(td, metricVal, price, tolerance) {
  td.classList.remove('near-zero', 'blink');
  td.textContent = '';

  const m = toNum(metricVal);
  const p = toNum(price);

  if (m === null) { td.textContent = ''; return; }
  if (p === null) { td.textContent = fmt2(m); return; }

  const diff = p - m; // positive means price above metric
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

/* Normalize incoming alert rows so we can always read `row.AI_5m` */
function normalizeRow(row) {
  const r = { ...row };
  // Many server payloads now have `Alert` instead of `AI_5m`
  if (!r.AI_5m && r.Alert) r.AI_5m = r.Alert;
  return r;
}

/* =========================
   Main render (5m alerts only)
   ========================= */
function renderTable() {
  const buyTbody  = document.querySelector('#scannerTableBuy tbody');
  const sellTbody = document.querySelector('#scannerTableSell tbody');

  if (!buyTbody || !sellTbody) return;

  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  // Only rows with a 5m signal
  const rows = (alerts || [])
    .map(normalizeRow)
    .filter(a => a.AI_5m); // only show rows that actually have a 5m signal

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

    // 2 Price (keep look & feel: Price next to Ticker)
    td = document.createElement('td');
    td.textContent = fmt2(toNum(p.Price));
    row.appendChild(td);

    // 3 Alert (5m only)
    td = document.createElement('td');
    td.textContent = a.AI_5m || '';
    if (td.textContent === 'Buy')  td.classList.add('signal-buy');
    if (td.textContent === 'Sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // 4 MA20(5m) vs Price — near-zero blink if within tolerance
    td = document.createElement('td');
    fillMetricCell(td, p.MA20_5m, p.Price, TOLERANCE.ma20_5m);
    row.appendChild(td);

    // 5 VWAP(5m) vs Price — near-zero blink if within tolerance
    td = document.createElement('td');
    fillMetricCell(td, p.VWAP_5m, p.Price, TOLERANCE.vwap_5m);
    row.appendChild(td);

    // 6 DayMid vs Price — near-zero blink if within tolerance
    td = document.createElement('td');
    fillMetricCell(td, p.DayMid, p.Price, TOLERANCE.daymid);
    row.appendChild(td);

    // Place into Green or Red zone based on the 5m signal
    const isBuy = (a.AI_5m || '').toLowerCase() === 'buy';
    if (isBuy) buyTbody.appendChild(row);
    else       sellTbody.appendChild(row);
  });
}

/* =========================
   Socket listeners
   ========================= */

// New per-timeframe stream from server (best)
socket.on('alertsUpdate:AI_5m', (rows) => {
  alerts = Array.isArray(rows) ? rows : [];
  renderTable();
});

// Back-compat: if server ever emits generic event with mixed timeframes
socket.on('alertsUpdate', (rows) => {
  if (!Array.isArray(rows)) return;
  // Try to pull 5m rows whether they come as AI_5m or Timeframe === 'AI_5m'
  const only5m = rows
    .map(normalizeRow)
    .filter(r => r.Timeframe === 'AI_5m' || r.AI_5m);
  if (only5m.length) {
    alerts = only5m;
    renderTable();
  }
});

// Live price updates
socket.on('priceUpdate', data => {
  priceData = data || {};
  renderTable();
});

/* =========================
   Initial load (show existing file immediately)
   ========================= */
(async function initialLoad() {
  try {
    const res = await fetch('/alerts/5m', { cache: 'no-store' });
    const data = await res.json();
    alerts = Array.isArray(data) ? data : [];
    renderTable();
  } catch (e) {
    console.warn('Failed to load /alerts/5m:', e);
  }
})();
