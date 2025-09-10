// scanner.js
const socket = io();

let alerts = [];
let priceData = {};

/* =========================
   Configurable tolerances
   ========================= */
const TOLERANCE = {
  ma20_5m: 0.50,  // 50 cents
  vwap_5m: 0.50,  // 50 cents
  daymid: 1.00    // $1
};

/* =========================
   Helpers
   ========================= */
const toNum = v => (v === null || v === undefined || v === '' || v === 'N/A') ? null : Number(v);
const fmt2  = v => (v === null || Number.isNaN(v)) ? '' : Number(v).toFixed(2);

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

    // 3 Alert (AI_5m used as the Alert column)
    td = document.createElement('td');
    td.textContent = a.AI_5m || '';
    if (td.textContent === 'Buy') td.classList.add('signal-buy');
    else if (td.textContent === 'Sell') td.classList.add('signal-sell');
    row.appendChild(td);

    // 4 MA20(5m) vs Price
    td = document.createElement('td');
    fillMetricCell(td, p.MA20_5m, p.Price, TOLERANCE.ma20_5m);
    row.appendChild(td);

    // 5 VWAP(5m) vs Price
    td = document.createElement('td');
    fillMetricCell(td, p.VWAP_5m, p.Price, TOLERANCE.vwap_5m);
    row.appendChild(td);

    // 6 DayMid vs Price
    td = document.createElement('td');
    fillMetricCell(td, p.DayMid, p.Price, TOLERANCE.daymid);
    row.appendChild(td);

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
