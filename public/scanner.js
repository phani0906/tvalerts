// scanner.js
const socket = io();

let alerts = [];
let priceData = {};

/**
 * Expected priceData per ticker:
 * {
 *   Price, DayMid, WeeklyMid,
 *   MA20_5m, VWAP_5m,
 *   MA20_15m, VWAP_15m,
 *   MA20_1h, VWAP_1h
 * }
 */

// ------- tolerance config (with persistence) -------
const TOL_KEY = 'scanner_tolerances_v1';
const defaultTolerances = { '5m': 0.50, '15m': 1.00, '1h': 2.00 };

function loadTolerances() {
  try {
    const raw = localStorage.getItem(TOL_KEY);
    if (!raw) return { ...defaultTolerances };
    const parsed = JSON.parse(raw);
    return { ...defaultTolerances, ...parsed };
  } catch {
    return { ...defaultTolerances };
  }
}
let tolerances = loadTolerances();

/**
 * Override tolerances at runtime (persisted):
 *   window.setScannerTolerances({ '5m': 0.35, '15m': 0.9, '1h': 1.8 })
 */
window.setScannerTolerances = (overrides = {}) => {
  tolerances = { ...tolerances, ...overrides };
  localStorage.setItem(TOL_KEY, JSON.stringify(tolerances));
  renderTable();
};

// ------- helpers -------
function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Renders "metric (+/-diff)" and highlights/blinks if |diff| <= tolerance.
 * label examples: "MA20(5m)" / "VWAP(15m)"; timeframeKey: '5m' | '15m' | '1h'
 */
function setMetricWithDiffCell(td, price, metric, label, timeframeKey) {
  const p = toNumber(price);
  const m = toNumber(metric);

  // reset styles/classes each render
  td.classList.remove('near-zero', 'blink');
  td.removeAttribute('style');
  td.title = '';

  if (!Number.isFinite(m)) {
    td.textContent = '';
    return;
  }

  if (!Number.isFinite(p)) {
    td.textContent = m.toFixed(2);
    td.title = `${label}: ${m.toFixed(2)}`;
    return;
  }

  const diff = p - m; // positive => price above metric
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '+';
  const color = diff > 0 ? 'green' : diff < 0 ? 'red' : 'gray';
  td.innerHTML = `${m.toFixed(2)} <span style="color:${color}">(${sign}${Math.abs(diff).toFixed(2)})</span>`;
  td.title = `Price: ${p.toFixed(2)}, ${label}: ${m.toFixed(2)}`;

  // tolerance highlight + blink (guard if tolerances not loaded for any reason)
  const tol = tolerances?.[timeframeKey];
  if (Number.isFinite(tol) && Math.abs(diff) <= tol) {
    td.classList.add('near-zero', 'blink');
  }
}

function renderTable() {
  const buyTbody = document.querySelector('#scannerTableBuy tbody');
  const sellTbody = document.querySelector('#scannerTableSell tbody');

  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  alerts.forEach(a => {
    const row = document.createElement('tr');
    const p = priceData[a.Ticker] || {};

    // Column order must match your HTML with VWAP columns:
    // 0 Time, 1 Ticker, 2 Pivot Rel., 3 Trend,
    // 4 Ai 5m, 5 MA20 (5m), 6 VWAP (5m),
    // 7 Ai 15m, 8 MA20 (15m), 9 VWAP (15m),
    // 10 Ai 1h, 11 MA20 (1h), 12 VWAP (1h),
    // 13 Price, 14 DayMid, 15 WeeklyMid, 16 NCPR, 17 Pivot
    const columns = [
      a.Time,
      a.Ticker,
      '',
      '',
      a.AI_5m || '',
      p.MA20_5m ?? '',
      p.VWAP_5m ?? '',
      a.AI_15m || '',
      p.MA20_15m ?? '',
      p.VWAP_15m ?? '',
      a.AI_1h || '',
      p.MA20_1h ?? '',
      p.VWAP_1h ?? '',
      p.Price ?? '',
      p.DayMid ?? '',
      p.WeeklyMid ?? '',
      a.NCPR || '',
      a.Pivot || ''
    ];

    columns.forEach((c, i) => {
      const td = document.createElement('td');

      if (i === 4 || i === 7 || i === 10) {
        // AI signal columns
        td.textContent = c ?? '';
        if (c === 'Buy') td.style.color = 'green';
        else if (c === 'Sell') td.style.color = 'red';
      } else if (i === 5) {
        setMetricWithDiffCell(td, p.Price, p.MA20_5m, 'MA20(5m)', '5m');
      } else if (i === 6) {
        setMetricWithDiffCell(td, p.Price, p.VWAP_5m, 'VWAP(5m)', '5m');
      } else if (i === 8) {
        setMetricWithDiffCell(td, p.Price, p.MA20_15m, 'MA20(15m)', '15m');
      } else if (i === 9) {
        setMetricWithDiffCell(td, p.Price, p.VWAP_15m, 'VWAP(15m)', '15m');
      } else if (i === 11) {
        setMetricWithDiffCell(td, p.Price, p.MA20_1h, 'MA20(1h)', '1h');
      } else if (i === 12) {
        setMetricWithDiffCell(td, p.Price, p.VWAP_1h, 'VWAP(1h)', '1h');
      } else {
        td.textContent = c ?? '';
      }

      row.appendChild(td);
    });

    if (a.Zone === 'green') buyTbody.appendChild(row);
    else sellTbody.appendChild(row);
  });
}

// Socket listeners
socket.on('alertsUpdate', data => {
  alerts = data;
  renderTable();
});

socket.on('priceUpdate', data => {
  priceData = data;
  renderTable();
});
