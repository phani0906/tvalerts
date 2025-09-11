// scanner.js
const socket = io();

/* ========= State ========= */
let alerts5m = [];
let alerts15m = [];
let alerts1h = [];
let priceData = {};

/* ========= Tolerances =========
   (you can tweak these; 1h wider by default)
*/
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
  (v === null || v === undefined || v === '' || v === 'N/A') ? null : Number(v);

const fmt2 = v =>
  (v === null || Number.isNaN(v)) ? '' : Number(v).toFixed(2);

function fillMetricCell(td, metricVal, price, tolerance) {
  td.classList.remove('near-zero','blink','border-gold-blink');
  td.textContent = '';

  const m = toNum(metricVal);
  const p = toNum(price);
  if (m === null) { td.textContent = ''; return; }
  if (p === null) { td.textContent = fmt2(m); return; }

  const diff = p - m;
  const diffStr = `${diff >= 0 ? '+' : ''}${fmt2(diff)}`;

  const base = document.createElement('span');
  base.textContent = fmt2(m);

  const wrap = document.createElement('span');
  wrap.className = diff >= 0 ? 'diff-up' : 'diff-down';
  wrap.textContent = ` (${diffStr})`;

  td.appendChild(base);
  td.appendChild(wrap);

  if (tolerance != null && Math.abs(diff) <= tolerance) {
    td.classList.add('near-zero', 'blink');
  }
}

function normalizeRow(row) {
  const r = { ...row };
  // fill AI_* fields from generic Alert when needed
  if (r.Timeframe === 'AI_5m'  && !r.AI_5m  && r.Alert) r.AI_5m  = r.Alert;
  if (r.Timeframe === 'AI_15m' && !r.AI_15m && r.Alert) r.AI_15m = r.Alert;
  if (r.Timeframe === 'AI_1h'  && !r.AI_1h  && r.Alert) r.AI_1h  = r.Alert;
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

/* ========= Renderers (Time, Ticker, Price, Alert, MA20, VWAP, DayMid) ========= */
// --- shared helpers (keep your existing ones) ---
// toNum, fmt2, fillMetricCell ...

// ============ 5 MIN ============
// rows: [{ Time, Ticker, AI_5m: 'Buy'|'Sell' }]
function renderFiveMinTable(rows) {
  const buyTbody  = document.querySelector('#scannerTableBuy_5m tbody');
  const sellTbody = document.querySelector('#scannerTableSell_5m tbody');
  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  rows.forEach(a => {
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

    // Alert (before Price)
    td = document.createElement('td');
    td.textContent = a.AI_5m || '';
    if (td.textContent === 'Buy') td.classList.add('signal-buy');
    else if (td.textContent === 'Sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // Price
    td = document.createElement('td');
    td.textContent = fmt2(toNum(p.Price));
    row.appendChild(td);

    // MA20(5m)
    td = document.createElement('td');
    fillMetricCell(td, p.MA20_5m, p.Price, TOLERANCE.ma20_5m);
    row.appendChild(td);

    // VWAP(5m)
    td = document.createElement('td');
    fillMetricCell(td, p.VWAP_5m, p.Price, TOLERANCE.vwap_5m);
    row.appendChild(td);

    // DayMid (prev day mid)
    td = document.createElement('td');
    fillMetricCell(td, p.DayMid, p.Price, TOLERANCE.daymid);
    row.appendChild(td);

    (a.AI_5m === 'Buy' ? buyTbody : sellTbody).appendChild(row);
  });
}

// ============ 15 MIN ============
function renderFifteenMinTable(rows) {
  const buyTbody  = document.querySelector('#scannerTableBuy_15m tbody');
  const sellTbody = document.querySelector('#scannerTableSell_15m tbody');
  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  rows.forEach(a => {
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

    // Alert (before Price)
    td = document.createElement('td');
    td.textContent = a.AI_15m || '';
    if (td.textContent === 'Buy') td.classList.add('signal-buy');
    else if (td.textContent === 'Sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // Price
    td = document.createElement('td');
    td.textContent = fmt2(toNum(p.Price));
    row.appendChild(td);

    // MA20(15m)
    td = document.createElement('td');
    fillMetricCell(td, p.MA20_15m, p.Price, TOLERANCE.ma20_15m ?? 1.00);
    row.appendChild(td);

    // VWAP(15m)
    td = document.createElement('td');
    fillMetricCell(td, p.VWAP_15m, p.Price, TOLERANCE.vwap_15m ?? 1.00);
    row.appendChild(td);

    // DayMid
    td = document.createElement('td');
    fillMetricCell(td, p.DayMid, p.Price, TOLERANCE.daymid);
    row.appendChild(td);

    (a.AI_15m === 'Buy' ? buyTbody : sellTbody).appendChild(row);
  });
}

// ============ 1 HOUR ============
function renderOneHourTable(rows) {
  const buyTbody  = document.querySelector('#scannerTableBuy_1h tbody');
  const sellTbody = document.querySelector('#scannerTableSell_1h tbody');
  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  rows.forEach(a => {
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

    // Alert (before Price)
    td = document.createElement('td');
    td.textContent = a.AI_1h || '';
    if (td.textContent === 'Buy') td.classList.add('signal-buy');
    else if (td.textContent === 'Sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // Price
    td = document.createElement('td');
    td.textContent = fmt2(toNum(p.Price));
    row.appendChild(td);

    // MA20(1h)
    td = document.createElement('td');
    fillMetricCell(td, p.MA20_1h, p.Price, TOLERANCE.ma20_1h ?? 2.00);
    row.appendChild(td);

    // VWAP(1h)
    td = document.createElement('td');
    fillMetricCell(td, p.VWAP_1h, p.Price, TOLERANCE.vwap_1h ?? 2.00);
    row.appendChild(td);

    // DayMid
    td = document.createElement('td');
    fillMetricCell(td, p.DayMid, p.Price, TOLERANCE.daymid);
    row.appendChild(td);

    (a.AI_1h === 'Buy' ? buyTbody : sellTbody).appendChild(row);
  });
}


/* ========= Sockets ========= */
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
  priceData = data || {};
  renderFiveMinTable();
  renderFifteenMinTable();
  renderOneHrTable();
});

/* ========= Initial loads ========= */
(async function boot() {
  try {
    const r5 = await fetch('/alerts/5m', { cache: 'no-store' });
    alerts5m = dedupe(await r5.json(), 'AI_5m');
  } catch(e) { console.warn('Failed /alerts/5m', e); }

  try {
    const r15 = await fetch('/alerts/15m', { cache: 'no-store' });
    alerts15m = dedupe(await r15.json(), 'AI_15m');
  } catch(e) { console.warn('Failed /alerts/15m', e); }

  try {
    const r1h = await fetch('/alerts/1h', { cache: 'no-store' });
    alerts1h = dedupe(await r1h.json(), 'AI_1h');
  } catch(e) { console.warn('Failed /alerts/1h', e); }

  renderFiveMinTable();
  renderFifteenMinTable();
  renderOneHrTable();
})();
