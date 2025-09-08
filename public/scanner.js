// scanner.js
const socket = io();

let alerts = [];
let priceData = {};

/**
 * Expected priceData shape per ticker (examples):
 * priceData[ticker] = {
 *   Price, DayMid, WeeklyMid,
 *   MA20_5m, VWAP_5m,
 *   MA20_15m, VWAP_15m,
 *   MA20_1h, VWAP_1h
 * }
 */

// ------- helpers -------
function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Renders a cell with "metric (+/-diff)" where diff = Price - metric.
 * Example: metric=98, price=100 -> "98.00 (+2.00)" in green.
 */
function setMetricWithDiffCell(td, price, metric, label) {
  const p = toNumber(price);
  const m = toNumber(metric);

  if (!Number.isFinite(m)) {
    td.textContent = '';
    td.title = '';
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
}

function renderTable() {
  const buyTbody = document.querySelector('#scannerTableBuy tbody');
  const sellTbody = document.querySelector('#scannerTableSell tbody');

  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  alerts.forEach(a => {
    const row = document.createElement('tr');
    const p = priceData[a.Ticker] || {};

    // Column order must match <thead>
    const columns = [
      a.Time,                    // 0
      a.Ticker,                  // 1
      '',                        // 2 Pivot Rel.
      '',                        // 3 Trend

      a.AI_5m || '',             // 4 (AI)
      p.MA20_5m ?? '',           // 5 (MA20 5m, with diff)
      p.VWAP_5m ?? '',           // 6 (VWAP 5m, with diff)

      a.AI_15m || '',            // 7 (AI)
      p.MA20_15m ?? '',          // 8 (MA20 15m, with diff)
      p.VWAP_15m ?? '',          // 9 (VWAP 15m, with diff)

      a.AI_1h || '',             // 10 (AI)
      p.MA20_1h ?? '',           // 11 (MA20 1h, with diff)
      p.VWAP_1h ?? '',           // 12 (VWAP 1h, with diff)

      p.Price ?? '',             // 13
      p.DayMid ?? '',            // 14
      p.WeeklyMid ?? '',         // 15
      a.NCPR || '',              // 16
      a.Pivot || ''              // 17
    ];

    columns.forEach((c, i) => {
      const td = document.createElement('td');

      // AI signal columns (color Buy/Sell)
      if (i === 4 || i === 7 || i === 10) {
        td.textContent = c;
        if (c === 'Buy') td.style.color = 'green';
        else if (c === 'Sell') td.style.color = 'red';
      }
      // Metric cells with (Price - Metric) diff
      else if (i === 5) {        // MA20 (5m)
        setMetricWithDiffCell(td, p.Price, p.MA20_5m, 'MA20(5m)');
      } else if (i === 6) {      // VWAP (5m)
        setMetricWithDiffCell(td, p.Price, p.VWAP_5m, 'VWAP(5m)');
      } else if (i === 8) {      // MA20 (15m)
        setMetricWithDiffCell(td, p.Price, p.MA20_15m, 'MA20(15m)');
      } else if (i === 9) {      // VWAP (15m)
        setMetricWithDiffCell(td, p.Price, p.VWAP_15m, 'VWAP(15m)');
      } else if (i === 11) {     // MA20 (1h)
        setMetricWithDiffCell(td, p.Price, p.MA20_1h, 'MA20(1h)');
      } else if (i === 12) {     // VWAP (1h)
        setMetricWithDiffCell(td, p.Price, p.VWAP_1h, 'VWAP(1h)');
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
