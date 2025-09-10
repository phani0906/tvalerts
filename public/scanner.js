function renderTable() {
  const buyTbody = document.querySelector('#scannerTableBuy tbody');
  const sellTbody = document.querySelector('#scannerTableSell tbody');

  buyTbody.innerHTML = '';
  sellTbody.innerHTML = '';

  alerts.forEach(a => {
    const row = document.createElement('tr');
    const p = priceData[a.Ticker] || {};

    // Slimmed down column set:
    // 0 Time, 1 Ticker, 2 MA20(5m), 3 VWAP(5m), 4 DayMid
    const columns = [
      a.Time,                   // 0
      a.Ticker,                 // 1
      p.MA20_5m ?? '',          // 2
      p.VWAP_5m ?? '',          // 3
      p.DayMid ?? ''            // 4
      // Commented out:
      // p.Price, a.PivotRel, a.Trend, p.WeeklyMid, a.AI_5m,
      // a.AI_15m, p.MA20_15m, p.VWAP_15m,
      // a.AI_1h, p.MA20_1h, p.VWAP_1h,
      // a.NCPR, a.Pivot
    ];

    columns.forEach((c, i) => {
      const td = document.createElement('td');

      if (i === 2) {
        setMetricWithDiffCell(td, p.Price, p.MA20_5m, 'MA20(5m)', '5m');
      } else if (i === 3) {
        setMetricWithDiffCell(td, p.Price, p.VWAP_5m, 'VWAP(5m)', '5m');
      } else if (i === 4) {
        setMetricWithDiffCell(td, p.Price, p.DayMid, 'DayMid', 'daymid');
      } else {
        td.textContent = c ?? '';
      }

      row.appendChild(td);
    });

    if (a.Zone === 'green') buyTbody.appendChild(row);
    else sellTbody.appendChild(row);
  });
}
