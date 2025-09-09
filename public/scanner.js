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
const TOL_KEY = 'scanner_tolerances_v2';
// Added daymid + weeklymid defaults
const defaultTolerances = {
  '5m': 0.50,
  '15m': 1.00,
  '1h': 2.00,
  'daymid': 1.00,
  'weeklymid': 2.00
};

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
 *   window.setScannerTolerances({ '5m': 0.35, '15m': 0.9, '1h': 1.8, daymid: 0.8, weeklymid: 1.6 })
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
 * label examples: "MA20(5m)" / "VWAP(15m)" / "DayMid" / "WeeklyMid"
 * tolKey: '5m' | '15m' | '1h' | 'daymid' | 'weeklymid' | undefined
 */
function setMetricWithDiffCell(td, price, metric, label, tolKey) {
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

  // tolerance highlight + blink when tolKey provided and configured
  if (tolKey) {
    const tol = tolerances?.[tolKey];
    if (Number.isFinite(tol) && Math.abs(diff) <= tol) {
      td.classList.add('near-zero', 'blink');
    }
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

    // HEADER ORDER (with Price after Ticker, and DayMid/WeeklyMid next to Trend):
    // 0 Time, 1 Ticker, 2 Price, 3 Pivot Rel., 4 Trend, 5 DayMid, 6 WeeklyMid,
    // 7 Ai 5m, 8 MA20(5m), 9 VWAP(5m),
    // 10 Ai 15m, 11 MA20(15m), 12 VWAP(15m),
    // 13 Ai 1h, 14 MA20(1h), 15 VWAP(1h),
    // 16 NCPR, 17 Pivot
    const columns = [
      a.Time,                    // 0
      a.Ticker,                  // 1
      p.Price ?? '',             // 2
      '',                        // 3 Pivot Rel.
      '',                        // 4 Trend
      p.DayMid ?? '',            // 5
      p.WeeklyMid ?? '',         // 6
      a.AI_5m || '',             // 7
      p.MA20_5m ?? '',           // 8
      p.VWAP_5m ?? '',           // 9
      a.AI_15m || '',            // 10
      p.MA20_15m ?? '',          // 11
      p.VWAP_15m ?? '',          // 12
      a.AI_1h || '',             // 13
      p.MA20_1h ?? '',           // 14
      p.VWAP_1h ?? '',           // 15
      a.NCPR || '',              // 16
      a.Pivot || ''              // 17
    ];

    columns.forEach((c, i) => {
      const td = document.createElement('td');

      // AI signal columns (Buy/Sell color)
      if (i === 7 || i === 10 || i === 13) {
        td.textContent = c ?? '';
        if (c === 'Buy') td.style.color = 'green';
        else if (c === 'Sell') td.style.color = 'red';
      }
      // MA/VWAP with timeframe tolerances + blinking
      else if (i === 8) {
        setMetricWithDiffCell(td, p.Price, p.MA20_5m, 'MA20(5m)', '5m');
      } else if (i === 9) {
        setMetricWithDiffCell(td, p.Price, p.VWAP_5m, 'VWAP(5m)', '5m');
      } else if (i === 11) {
        setMetricWithDiffCell(td, p.Price, p.MA20_15m, 'MA20(15m)', '15m');
      } else if (i === 12) {
        setMetricWithDiffCell(td, p.Price, p.VWAP_15m, 'VWAP(15m)', '15m');
      } else if (i === 14) {
        setMetricWithDiffCell(td, p.Price, p.MA20_1h, 'MA20(1h)', '1h');
      } else if (i === 15) {
        setMetricWithDiffCell(td, p.Price, p.VWAP_1h, 'VWAP(1h)', '1h');
      }
      // DayMid / WeeklyMid: now also tolerance-highlight + blink (global keys)
      else if (i === 5) {
        setMetricWithDiffCell(td, p.Price, p.DayMid, 'DayMid', 'daymid');
      } else if (i === 6) {
        setMetricWithDiffCell(td, p.Price, p.WeeklyMid, 'WeeklyMid', 'weeklymid');
      }
      // Everything else plain text
      else {
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
