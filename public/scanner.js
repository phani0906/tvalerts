// scanner.js
const socket = io();

let alerts = [];
let priceData = {};

/**
 * priceData[ticker] shape example:
 * {
 *   Price: 123.45,
 *   DayMid: 120.00,
 *   WeeklyMid: 110.00,
 *   MA20_5m: 122.10,
 *   MA20_15m: 121.50,
 *   MA20_1h: 119.90,
 *   VWAP_5m: 121.80,
 *   VWAP_15m: 121.10,
 *   VWAP_1h: 120.25
 * }
 */

/* =========================
   Configurable tolerances
   ========================= */
const TOLERANCE = {
  ma20: { '5m': 0.50, '15m': 1.00, '1h': 2.00 },
  vwap: { '5m': 0.50, '15m': 1.00, '1h': 2.00 },
  mid:  { day: 1.00, week: 2.00 }
};

/* =========================
   Helpers
   ========================= */
const toNum = v => (v === null || v === undefined || v === '' || v === 'N/A') ? null : Number(v);
const fmt2  = v => (v === null || Number.isNaN(v)) ? '' : Number(v).toFixed(2);

/**
 * Renders a metric cell like "123.45 (+2.10)" vs current price, colors diff, and
 * adds near-zero highlight if |diff| <= tolerance.
 *
 * @param {HTMLTableCellElement} td
 * @param {number|null} metricVal
 * @param {number|null} price
 * @param {number|null} tolerance
 */
function fillMetricCell(td, metricVal, price, tolerance) {
  td.classList.remove('near-zero', 'blink');
  td.textContent = '';

  const m = toNum(metricVal);
  const p = toNum(price);

  if (m === null) { td.textContent = ''; return; }

  // If no price, just show metric value
  if (p === null) {
    td.textContent = fmt2(m);
    return;
  }

  const diff = p - m; // positive when price > metric
  const diffStr = `${diff >= 0 ? '+' : ''}${fmt2(diff)}`;

  // Build inner HTML: base value + colored diff
  const base = document.createElement('span');
  base.textContent = fmt2(m);

  const gap = document.createTextNode(' ');
  const wrap = document.createElement('span');
  wrap.className = diff >= 0 ? 'diff-up' : 'diff-down';
  wrap.textContent = `(${diffStr})`;

  td.appendChild(base);
  td.appendChild(gap);
  td.appendChild(wrap);

  // Near-zero border blink if within tolerance
  if (tolerance !== null && tolerance !== undefined && Math.abs(diff) <= tolerance) {
    td.classList.add('near-zero', 'blink');
  }
}

/* =========================
   Main render
   ========================= */
function renderTable() {
  const buyTbody = document.querySelector('#scannerTableBuy tbody');
  const sellTbody = document.querySelector('#scannerTableSell tbody');

  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  alerts.forEach(a => {
    const row = document.createElement('tr');
    const p = priceData[a.Ticker] || {};

    // ----- Columns in the exact order of your <thead> -----
    // 0 Time
    let td = document.createElement('td');
    td.textContent = a.Time || '';
    row.appendChild(td);

    // 1 Ticker
    td = document.createElement('td');
    td.textContent = a.Ticker || '';
    row.appendChild(td);

    // 2 Price (current)
    td = document.createElement('td');
    td.textContent = fmt2(toNum(p.Price));
    row.appendChild(td);

    // 3 Pivot Rel.
    td = document.createElement('td');
    td.textContent = ''; // fill if/when you compute this
    row.appendChild(td);

    // 4 Trend
    td = document.createElement('td');
    td.textContent = ''; // fill if/when you compute this
    td.classList.add('trend-arrow');
    row.appendChild(td);

    // 5 DayMid with diff vs Price
    td = document.createElement('td');
    fillMetricCell(td, p.DayMid, p.Price, TOLERANCE.mid.day);
    row.appendChild(td);

    // 6 WeeklyMid with diff vs Price
    td = document.createElement('td');
    fillMetricCell(td, p.WeeklyMid, p.Price, TOLERANCE.mid.week);
    row.appendChild(td);

    // 7 Ai 5min
    td = document.createElement('td');
    td.textContent = a.AI_5m || '';
    if (td.textContent === 'Buy') td.classList.add('signal-buy');
    else if (td.textContent === 'Sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // 8 MA20(5min) vs Price
    td = document.createElement('td');
    fillMetricCell(td, p.MA20_5m, p.Price, TOLERANCE.ma20['5m']);
    row.appendChild(td);

    // 9 VWAP(5min) vs Price
    td = document.createElement('td');
    fillMetricCell(td, p.VWAP_5m, p.Price, TOLERANCE.vwap['5m']);
    row.appendChild(td);

    // 10 Ai 15min
    td = document.createElement('td');
    td.textContent = a.AI_15m || '';
    if (td.textContent === 'Buy') td.classList.add('signal-buy');
    else if (td.textContent === 'Sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // 11 MA20(15min) vs Price
    td = document.createElement('td');
    fillMetricCell(td, p.MA20_15m, p.Price, TOLERANCE.ma20['15m']);
    row.appendChild(td);

    // 12 VWAP(15min) vs Price
    td = document.createElement('td');
    fillMetricCell(td, p.VWAP_15m, p.Price, TOLERANCE.vwap['15m']);
    row.appendChild(td);

    // 13 Ai 1Hr
    td = document.createElement('td');
    td.textContent = a.AI_1h || '';
    if (td.textContent === 'Buy') td.classList.add('signal-buy');
    else if (td.textContent === 'Sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // 14 MA20(1Hr) vs Price
    td = document.createElement('td');
    fillMetricCell(td, p.MA20_1h, p.Price, TOLERANCE.ma20['1h']);
    row.appendChild(td);

    // 15 VWAP(1Hr) vs Price
    td = document.createElement('td');
    fillMetricCell(td, p.VWAP_1h, p.Price, TOLERANCE.vwap['1h']);
    row.appendChild(td);

    // 16 NCPR
    td = document.createElement('td');
    td.textContent = a.NCPR || '';
    row.appendChild(td);

    // 17 Pivot
    td = document.createElement('td');
    td.textContent = a.Pivot || '';
    row.appendChild(td);

    // Append to the proper zone
    if (a.Zone === 'green') buyTbody.appendChild(row);
    else sellTbody.appendChild(row);
  });
}

/* =========================
   Socket listeners
   ========================= */
socket.on('alertsUpdate', data => {
  alerts = data || [];
  renderTable();
});

socket.on('priceUpdate', data => {
  priceData = data || {};
  renderTable();
});
