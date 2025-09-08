// scanner.js
const socket = io();

let alerts = [];
let priceData = {};

/**
 * Expected priceData shape per ticker (examples):
 * priceData[ticker] = {
 *   Price, DayMid, WeeklyMid,
 *   MA20_5m, MA20_15m, MA20_1h
 * }
 */

// ------- helpers -------
function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
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
      a.AI_5m || '',             // 4
      p.MA20_5m ?? '',           // 5  <-- MA20 (5m) with diff vs Price
      a.AI_15m || '',            // 6
      p.MA20_15m ?? '',          // 7
      a.AI_1h || '',             // 8
      p.MA20_1h ?? '',           // 9
      p.Price ?? '',             // 10
      p.DayMid ?? '',            // 11
      p.WeeklyMid ?? '',         // 12
      a.NCPR || '',              // 13
      a.Pivot || ''              // 14
    ];

    columns.forEach((c, i) => {
      const td = document.createElement('td');

      if (i === 4 || i === 6 || i === 8) {
        // Color only the AI signal columns (indices 4, 6, 8)
        td.textContent = c;
        if (c === 'Buy') td.style.color = 'green';
        else if (c === 'Sell') td.style.color = 'red';
      } else if (i === 5) {
        // MA20 (5m) cell: show "MA20 (+/-diff)" e.g., "98.00 (+2.00)"
        const ma = toNumber(p.MA20_5m);
        const price = toNumber(p.Price);

        if (Number.isFinite(ma)) {
          if (Number.isFinite(price)) {
            const diff = price - ma; // positive => price above MA
            const sign = diff > 0 ? '+' : diff < 0 ? '-' : '+';
            const color = diff > 0 ? 'green' : diff < 0 ? 'red' : 'gray';
            td.innerHTML = `${ma.toFixed(2)} <span style="color:${color}">(${sign}${Math.abs(diff).toFixed(2)})</span>`;
            td.title = `Price: ${price.toFixed(2)}, MA20(5m): ${ma.toFixed(2)}`;
          } else {
            td.textContent = ma.toFixed(2);
            td.title = `MA20(5m): ${ma.toFixed(2)}`;
          }
        } else {
          td.textContent = ''; // no MA → leave blank
        }
      } else {
        td.textContent = c;
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
