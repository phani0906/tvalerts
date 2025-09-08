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

function setMAWithDiffCell(td, price, ma, label) {
  const p = toNumber(price);
  const m = toNumber(ma);

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

  const diff = p - m; // positive => price above MA
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
      a.AI_5m || '',             // 4  (AI)
      p.MA20_5m ?? '',           // 5  (MA20 5m with diff)
      a.AI_15m || '',            // 6  (AI)
      p.MA20_15m ?? '',          // 7  (MA20 15m with diff)
      a.AI_1h || '',             // 8  (AI)
      p.MA20_1h ?? '',           // 9  (MA20 1h with diff)
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
        // MA20 (5m)
        setMAWithDiffCell(td, p.Price, p.MA20_5m, 'MA20(5m)');
      } else if (i === 7) {
        // MA20 (15m)
        setMAWithDiffCell(td, p.Price, p.MA20_15m, 'MA20(15m)');
      } else if (i === 9) {
        // MA20 (1h)
        setMAWithDiffCell(td, p.Price, p.MA20_1h, 'MA20(1h)');
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
