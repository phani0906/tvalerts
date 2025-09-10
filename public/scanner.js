// public/scanner.js
// Minimal scanner client: shows Time, Ticker, MA20(5m), VWAP(5m), DayMid

(function () {
  const socket = io();
  window.socket = socket; // for quick debugging in DevTools

  let alerts = [];
  let priceData = {}; // { TICKER: { MA20_5m, VWAP_5m, DayMid, Price?... } }

  // ---- helpers ----
  function fmt(v) {
    if (v == null) return '—';
    if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(2);
    if (v === 'N/A' || v === 'Error') return String(v);
    return String(v);
  }

  function inferZone(a) {
    if (a.Zone) return a.Zone;
    const s = (a.Alert || a.AI_5m || a.AI_15m || a.AI_1h || '').toString().toLowerCase();
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

      const cols = [
        a.Time || '',
        a.Ticker || '',
        fmt(p.MA20_5m),
        fmt(p.VWAP_5m),
        fmt(p.DayMid),
      ];

      for (const c of cols) {
        const td = document.createElement('td');
        td.textContent = c ?? '';
        row.appendChild(td);
      }

      const zone = inferZone(a);
      if (zone === 'green') buyTbody.appendChild(row);
      else sellTbody.appendChild(row);
    }
  }

  // ---- socket.io listeners ----
  socket.on('connect', () => {
    console.log('[socket] connected', socket.id);
  });

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

  // ---- initial fetch fallback (in case we connect after the first emit) ----
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
