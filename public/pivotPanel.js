/* global io */
(function () {
    const socket = io();
  
    // Small number formatter used everywhere
    function fmt2(v){
      if (v == null || v === '') return '';
      const n = Number(v);
      return Number.isNaN(n) ? '' : n.toFixed(2);
    }
  
    // ===== Table wiring =====
    const TABLE_ID = 'pivot-table'; // make sure your HTML table has this id
  
    function ensureTable() {
      const table = document.getElementById(TABLE_ID);
      if (!table) return null;
  
      // Header (build once)
      if (!table.dataset.hdrBuilt) {
        const thead = table.querySelector('thead') || table.createTHead();
        thead.innerHTML = '';
        const tr = document.createElement('tr');
  
        [
          'Ticker',
          'Open / Price',
          'Mid-point',
          'PDH',            // <-- NEW column placed right after Mid-point
          // ... keep your existing headers after this line unchanged
          'CPR Pivot',
          'CPR BC',
          'CPR TC',
          'H1','H2','H3','H4','L1','L2','L3','L4'
        ].forEach(h => {
          const th = document.createElement('th');
          th.textContent = h;
          tr.appendChild(th);
        });
  
        thead.appendChild(tr);
        table.dataset.hdrBuilt = '1';
      }
  
      const tbody = table.querySelector('tbody') || table.createTBody();
      return { table, tbody };
    }
  
    // Keep a simple map for quick updates if the same ticker arrives again
    const rowMap = new Map();
  
    function upsertRow(tbody, r) {
      let obj = rowMap.get(r.ticker);
      if (!obj) {
        const tr = document.createElement('tr');
  
        // Create cells in the same order as headers
        const cells = {
          ticker: td(tr, r.ticker || ''),
          openPrice: td(tr, ''),          // your app may fill this from elsewhere
          midPoint: td(tr, fmt2(r.midPoint)),
          pdh: td(tr, fmt2(r.pdh)),       // <-- NEW cell after Mid-point
          cpr_pivot: td(tr, fmt2(r.cpr_pivot)),
          cpr_bc: td(tr, fmt2(r.cpr_bc)),
          cpr_tc: td(tr, fmt2(r.cpr_tc)),
          H1: td(tr, fmt2(r.H1)), H2: td(tr, fmt2(r.H2)),
          H3: td(tr, fmt2(r.H3)), H4: td(tr, fmt2(r.H4)),
          L1: td(tr, fmt2(r.L1)), L2: td(tr, fmt2(r.L2)),
          L3: td(tr, fmt2(r.L3)), L4: td(tr, fmt2(r.L4)),
        };
  
        tbody.appendChild(tr);
        obj = { tr, cells };
        rowMap.set(r.ticker, obj);
      }
  
      // Update values (only ones provided by pivotUpdate)
      obj.cells.midPoint.innerText = fmt2(r.midPoint);
      obj.cells.pdh.innerText = fmt2(r.pdh);    // <-- keep updated
      obj.cells.cpr_pivot.innerText = fmt2(r.cpr_pivot);
      obj.cells.cpr_bc.innerText = fmt2(r.cpr_bc);
      obj.cells.cpr_tc.innerText = fmt2(r.cpr_tc);
      obj.cells.H1.innerText = fmt2(r.H1);
      obj.cells.H2.innerText = fmt2(r.H2);
      obj.cells.H3.innerText = fmt2(r.H3);
      obj.cells.H4.innerText = fmt2(r.H4);
      obj.cells.L1.innerText = fmt2(r.L1);
      obj.cells.L2.innerText = fmt2(r.L2);
      obj.cells.L3.innerText = fmt2(r.L3);
      obj.cells.L4.innerText = fmt2(r.L4);
    }
  
    function td(tr, val) {
      const td = document.createElement('td');
      td.textContent = (val ?? '') + '';
      tr.appendChild(td);
      return td;
    }
  
    function renderRows(rows) {
      const parts = ensureTable();
      if (!parts) return;
      const { tbody } = parts;
  
      rows.forEach(r => upsertRow(tbody, r));
    }
  
    // ===== Socket listeners =====
    socket.on('pivotUpdate', (rows) => {
      if (!Array.isArray(rows)) return;
      renderRows(rows);
    });
  
    // Optional: if server exposes a snapshot endpoint you can fetch once on load.
    // (not required if your server emits soon after connect)
    // fetch('/pivot-snapshot').then(r=>r.json()).then(renderRows).catch(()=>{});
  })();
  