// Minimal scanner client with Alert column + Buy/Sell coloring

(function () {
  const socket = io();
  window.socket = socket; // for quick debugging

  let alerts = [];
  let priceData = {}; // { TICKER: { MA20_5m, VWAP_5m, DayMid, ... } }

  // ---- helpers ----
  function fmt(v) {
    if (v == null) return '—';
    if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(2);
    if (v === 'N/A' || v === 'Error') return String(v);
    return String(v);
  }

  function getAlertText(a) {
    // prefer explicit Alert, fall back to timeframe fields
    return (a.Alert || a.AI_5m || a.AI_15m || a.AI_1h || '').toString();
  }

  function inferZone(a) {
    if (a.Zone) return a.Zone;
    const s = getAlertText(a).toLowerCase();
    if (s.includes('sell')) return 'red';
    if (s.includes('buy')) return 'green';
    return 'green';
  }

  function renderTable() {
    const buyTbody = document.querySelector('#scannerTableBuy tbody');
    const sellTbody = document.querySelector('#scannerTableSell tbody');
    if (!buyTbody || !sellTbody) return;

    buyTbody.innerHTML = '';
    sellTbody.innerHTML = '';

    for (const a of alerts) {
      const p = priceData[a.Ticker] || {};
      const row = document.createElement('tr');

      // Time
      const tdTime = document.createElement('td');
      tdTime.textContent = a.Time || '';
      row.appendChild(tdTime);

      // Ticker
      const tdTicker = document.createElement('td');
      tdTicker.textContent = a.Ticker || '';
      row.appendChild(tdTicker);

      // Alert (colored Buy/Sell)
      const tdAlert = document.createElement('td');
      const alertText = getAlertText(a);
      tdAlert.textContent = alertText;
      const lc = alertText.toLowerCase();
      if (lc.includes('buy')) tdAlert.style.color = 'green';
      else if (lc.includes('sell')) tdAlert.style.color = 'red';
      row.appendChild(tdAlert);

      // MA20 (5m)
      const tdMA = document.createElement('td');
      tdMA.textContent = fmt(p.MA20_5m);
      row.appendChild(tdMA);

      // VWAP (5m)
      const tdVW = document.createElement('td');
      tdVW.textContent = fmt(p.VWAP_5m);
      row.appendChild(tdVW);

      // DayMid
      const tdDM = document.createElement('td');
      tdDM.textContent = fmt(p.DayMid);
      row.appendChild(tdDM);

      const zone = inferZone(a);
      if (zone === 'green') buyTbody.appendChild(row);
      else sellTbody.appendChild(row);
    }
  }

  // ---- socket.io listeners ----
  socket.on('connect', () => console.log('[socket] connected', socket.id));

  socket.on('alertsUpdate', (data) => {
    console.log('[socket] alertsUpdate', Array.isArray(data) ? data.length : data);
    alerts = Array.isArray(data) ? data : [];
    renderTable();
  });

  socket.on('priceUpdate', (data) => {
    console.log('[socket] priceUpdate');
    priceData = data || {};
    renderTable();
  });

  // ---- initial fetch (in case we connected after the first emit) ----
  fetch('/alerts')
    .then((r) => r.json())
    .then((data) => {
      if (Array.isArray(data)) {
        alerts = data;
        console.log('[init] fetched alerts', data.length);
        renderTable();
      }
    })
    .catch((e) => console.warn('[init] fetch /alerts failed:', e.message));
})();
