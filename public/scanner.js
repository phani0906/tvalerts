// public/scanner.js
/* global io */

const socket = io();

/* ========= State ========= */
let alerts5m = [];
let alerts15m = [];
let alerts1h = [];
let priceData = {}; // { [ticker]: { Price, DayMid, MA20_5m, VWAP_5m, ... } }

/* ========= Tolerances (blink when |price - metric| <= tolerance) ========= */
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
const toNum = (v) =>
  (v === null || v === undefined || v === '' || v === 'N/A') ? null : Number(v);

const fmt2 = (v) =>
  (v === null || Number.isNaN(v)) ? '' : Number(v).toFixed(2);

function appendWithFlash(tbody, row) {
  tbody.appendChild(row);
  row.classList.add('new-row');
  setTimeout(() => row.classList.remove('new-row'), 1500);
}


function formatTimeToCST(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    const opts = {
      timeZone: 'America/Chicago',
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    };
    const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(d);
    const day   = parts.find(p => p.type === 'day').value;
    const mon   = parts.find(p => p.type === 'month').value;
    const year  = parts.find(p => p.type === 'year').value;
    const hour  = parts.find(p => p.type === 'hour').value;
    const min   = parts.find(p => p.type === 'minute').value;

    return `${day} ${mon}'${year} ${hour}:${min}`;
  } catch {
    return isoString;
  }
}

/**
 * Fill a metric cell with: "<metric> (+/-diff)" and add near-zero blinking border
 */
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

  const wrap = document.createElement('span');
  wrap.className = diff >= 0 ? 'diff-up' : 'diff-down';
  wrap.textContent = ` (${diffStr})`;

  td.appendChild(base);
  td.appendChild(wrap);

  if (tolerance != null && Math.abs(diff) <= tolerance) {
    td.classList.add('near-zero', 'blink');
  }
}

/**
 * Fill missing AI_* field from Alert when rows come from TradingView
 */
function normalizeRow(row) {
  const r = { ...row };
  if (r.Timeframe === 'AI_5m'  && !r.AI_5m  && r.Alert) r.AI_5m  = r.Alert;
  if (r.Timeframe === 'AI_15m' && !r.AI_15m && r.Alert) r.AI_15m = r.Alert;
  if (r.Timeframe === 'AI_1h'  && !r.AI_1h  && r.Alert) r.AI_1h  = r.Alert;
  return r;
}

/**
 * Keep the latest row per Ticker for a given timeframe
 */
function dedupe(rows, timeframeKey) {
  const map = new Map();
  (rows || []).forEach(raw => {
    const r = normalizeRow(raw);
    if (r.Timeframe !== timeframeKey) return;
    const key = (r.Ticker || '').toUpperCase();
    const prev = map.get(key);
    if (!prev) { map.set(key, r); return; }
    const tNew = r.ReceivedAt ? Date.parse(r.ReceivedAt) : 0;
    const tOld = prev.ReceivedAt ? Date.parse(prev.ReceivedAt) : 0;
    if (tNew >= tOld) map.set(key, r);
  });
  return Array.from(map.values());
}

/* ========= Renderers ========= */
/* 5m: header is Time, Ticker, Alert, Price, MA20(5m), VWAP(5m), DayMid */
function renderFiveMinTable() {
  const buyTbody  = document.querySelector('#scannerTableBuy tbody');
  const sellTbody = document.querySelector('#scannerTableSell tbody');
  if (!buyTbody || !sellTbody) return;

  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  // ✅ sort newest first
  const sorted = [...alerts5m].sort((a, b) => {
    const ta = Date.parse(a.ReceivedAt || a.Time || 0);
    const tb = Date.parse(b.ReceivedAt || b.Time || 0);
    return tb - ta; // descending
  });

  sorted.forEach(a => {
    const row = document.createElement('tr');
    const p = priceData[a.Ticker] || {};

    // Time column
    let td = document.createElement('td');
    td.textContent = formatTimeToCST(a.Time);
    row.appendChild(td);

    // Ticker
    td = document.createElement('td');
    td.textContent = a.Ticker || '';
    row.appendChild(td);

    // Alert
    td = document.createElement('td');
    const alertVal = a.AI_5m || a.Alert || '';
    td.textContent = alertVal;
    if ((alertVal || '').toLowerCase() === 'buy') td.classList.add('signal-buy');
    if ((alertVal || '').toLowerCase() === 'sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // Price
    td = document.createElement('td');
    td.textContent = fmt2(toNum(p.Price));
    row.appendChild(td);

    // Metrics…
    td = document.createElement('td'); fillMetricCell(td, p.MA20_5m, p.Price, TOLERANCE.ma20_5m); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.VWAP_5m, p.Price, TOLERANCE.vwap_5m); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.DayMid,  p.Price, TOLERANCE.daymid_5m); row.appendChild(td);

    const isBuy = (alertVal || '').toLowerCase() === 'buy';
    appendWithFlash(isBuy ? buyTbody : sellTbody, row);

  });
}


/* 15m: header is Time, Ticker, Price, Alert, … */
function renderFifteenMinTable() {
  const buyTbody  = document.querySelector('#scannerTableBuy15 tbody');
  const sellTbody = document.querySelector('#scannerTableSell15 tbody');
  if (!buyTbody || !sellTbody) return;

  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  const sorted = [...alerts15m].sort((a, b) => {
    const ta = Date.parse(a.ReceivedAt || a.Time || 0);
    const tb = Date.parse(b.ReceivedAt || b.Time || 0);
    return tb - ta; // newest first
  });

  sorted.forEach(a => {
    const p = priceData[a.Ticker] || {};
    const row = document.createElement('tr');

    // Time
    let td = document.createElement('td');
    td.textContent = formatTimeToCST(a.Time);
    row.appendChild(td);

    // Ticker
    td = document.createElement('td');
    td.textContent = a.Ticker || '';
    row.appendChild(td);

    // Alert (before Price)
    td = document.createElement('td');
    const alertVal = a.AI_15m || a.Alert || '';
    td.textContent = alertVal;
    if ((alertVal || '').toLowerCase() === 'buy')  td.classList.add('signal-buy');
    if ((alertVal || '').toLowerCase() === 'sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // Price
    td = document.createElement('td');
    td.textContent = fmt2(toNum(p.Price));
    row.appendChild(td);

    // Metrics
    td = document.createElement('td'); fillMetricCell(td, p.MA20_15m, p.Price, TOLERANCE.ma20_15m); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.VWAP_15m, p.Price, TOLERANCE.vwap_15m); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.DayMid,     p.Price, TOLERANCE.daymid_15m); row.appendChild(td);

    const isBuy = (alertVal || '').toLowerCase() === 'buy';
    appendWithFlash(isBuy ? buyTbody : sellTbody, row);

  });
}



/* 1h: header is Time, Ticker, Price, Alert, … */
function renderOneHrTable() {
  const buyTbody  = document.querySelector('#scannerTableBuy1h tbody');
  const sellTbody = document.querySelector('#scannerTableSell1h tbody');
  if (!buyTbody || !sellTbody) return;

  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  const sorted = [...alerts1h].sort((a, b) => {
    const ta = Date.parse(a.ReceivedAt || a.Time || 0);
    const tb = Date.parse(b.ReceivedAt || b.Time || 0);
    return tb - ta; // newest first
  });

  sorted.forEach(a => {
    const p = priceData[a.Ticker] || {};
    const row = document.createElement('tr');

    // Time
    let td = document.createElement('td');
    td.textContent = formatTimeToCST(a.Time);
    row.appendChild(td);

    // Ticker
    td = document.createElement('td');
    td.textContent = a.Ticker || '';
    row.appendChild(td);

    // Alert (before Price)
    td = document.createElement('td');
    const alertVal = a.AI_1h || a.Alert || '';
    td.textContent = alertVal;
    if ((alertVal || '').toLowerCase() === 'buy')  td.classList.add('signal-buy');
    if ((alertVal || '').toLowerCase() === 'sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // Price
    td = document.createElement('td');
    td.textContent = fmt2(toNum(p.Price));
    row.appendChild(td);

    // Metrics
    td = document.createElement('td'); fillMetricCell(td, p.MA20_1h, p.Price, TOLERANCE.ma20_1h); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.VWAP_1h, p.Price, TOLERANCE.vwap_1h); row.appendChild(td);
    td = document.createElement('td'); fillMetricCell(td, p.DayMid,   p.Price, TOLERANCE.daymid_1h); row.appendChild(td);

    const isBuy = (alertVal || '').toLowerCase() === 'buy';
    appendWithFlash(isBuy ? buyTbody : sellTbody, row);

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
  // Normalize keys to UPPERCASE to match Ticker rendering
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
  } catch (e) {
    console.warn('Failed /alerts/5m', e);
  }

  try {
    const r15 = await fetch('/alerts/15m', { cache: 'no-store' });
    alerts15m = dedupe(await r15.json(), 'AI_15m');
  } catch (e) {
    console.warn('Failed /alerts/15m', e);
  }

  try {
    const r1h = await fetch('/alerts/1h', { cache: 'no-store' });
    alerts1h = dedupe(await r1h.json(), 'AI_1h');
  } catch (e) {
    console.warn('Failed /alerts/1h', e);
  }

  renderFiveMinTable();
  renderFifteenMinTable();
  renderOneHrTable();
})();
