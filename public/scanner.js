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
      p.MA20_5m ?? '',           // 5
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
      td.textContent = c;

      // Color only the AI signal columns (indices 4, 6, 8)
      if (i === 4 || i === 6 || i === 8) {
        if (c === 'Buy') td.style.color = 'green';
        else if (c === 'Sell') td.style.color = 'red';
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
