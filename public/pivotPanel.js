/* global io */
(function () {
    const socket = io();
  
    const TREND = {
      BULL_CONT: 'Bullish Continuation',
      BEAR_CONT: 'Bearish Continuation',
      BULL_REV:  'Bullish Trend Reversal',
      BEAR_REV:  'Bearish Trend Reversal'
    };
  
    function fmt2(v) {
      if (v == null || v === '') return '';
      const n = Number(v);
      return Number.isNaN(n) ? '' : n.toFixed(2);
    }
  
    function renderPivotGroup(tableId, rows) {
      try {
        const table = document.getElementById(tableId);
        if (!table) {
          console.warn(`[pivot] table not found: #${tableId}`);
          return;
        }
        const tbody = table.querySelector('tbody');
        if (!tbody) {
          console.warn(`[pivot] tbody missing in #${tableId}`);
          return;
        }
  
        const list = Array.isArray(rows) ? rows : [];
        tbody.innerHTML = '';
  
        for (const r of list) {
          // ---- tolerant field resolution ----
          const ticker =
            r.ticker ?? r.Ticker ?? '';
  
          const rel =
            r.relationshipLabel ??
            r.pivotRelationship ??
            r.relationship ??
            '';
  
          // Mid-point may arrive under several names
          const midRaw =
            r.midpoint ?? r.midPoint ?? r.mid ??
            r.cprMid ?? r.pivotMid ?? r.Mid ?? r.MID;
  
          // Open can arrive as strings or different keys
          const openRaw =
            r.open ?? r.openPrice ?? r.o ??
            r.Open ?? r.OPEN;
  
          // Live price (added in backend)
          const priceRaw = r.currentPrice ?? r.price ?? r.Price;
  
          const tr = document.createElement('tr');
  
          // Ticker
          const tdTicker = document.createElement('td');
          tdTicker.textContent = ticker;
          tr.appendChild(tdTicker);
  
          // Pivot Relationship
          const tdRel = document.createElement('td');
          tdRel.textContent = rel || '';
          if (rel) tdRel.classList.add('emphasis');
          tr.appendChild(tdRel);
  
          // ---- Mid-point with (±diff to current price) ----
          const tdMid = document.createElement('td');
          const midVal   = (midRaw   != null && isFinite(Number(midRaw)))   ? Number(midRaw)   : null;
          const priceVal = (priceRaw != null && isFinite(Number(priceRaw))) ? Number(priceRaw) : null;
  
          if (midVal != null) {
            // base value
            const base = document.createElement('span');
            base.textContent = fmt2(midVal);
            tdMid.appendChild(base);
  
            // diff if we have live price
            if (priceVal != null) {
              const diff = priceVal - midVal;
              const diffSpan = document.createElement('span');
              diffSpan.className = diff >= 0 ? 'diff-up' : 'diff-down';
              const sign = diff >= 0 ? '+' : '';
              diffSpan.textContent = ` (${sign}${fmt2(diff)})`;
              tdMid.appendChild(diffSpan);
            }
          } else {
            tdMid.textContent = '';
          }
          tr.appendChild(tdMid);
  
          // ---- Open / Price (price colored vs open) ----
          const tdOpen = document.createElement('td');
          const openVal = (openRaw  != null && isFinite(Number(openRaw)))  ? Number(openRaw)  : null;
  
          if (openVal != null) {
            tdOpen.appendChild(document.createTextNode(fmt2(openVal)));
          }
          if (priceVal != null) {
            const s = document.createElement('span');
            s.textContent = ` / ${fmt2(priceVal)}`;
            if (openVal != null) {
              if (priceVal > openVal) s.style.color = 'limegreen';
              else if (priceVal < openVal) s.style.color = 'red';
            }
            tdOpen.appendChild(s);
          }
          tr.appendChild(tdOpen);
  
          tbody.appendChild(tr);
        }
      } catch (err) {
        console.error(`[pivot] render error for #${tableId}:`, err);
      }
    }
  
    const lc = s => String(s || '').toLowerCase();
    function splitByTrend(rows) {
      const list = Array.isArray(rows) ? rows : [];
      return {
        bullCont: list.filter(r => lc(r.trend) === lc(TREND.BULL_CONT)),
        bearCont: list.filter(r => lc(r.trend) === lc(TREND.BEAR_CONT)),
        bullRev:  list.filter(r => lc(r.trend) === lc(TREND.BULL_REV)),
        bearRev:  list.filter(r => lc(r.trend) === lc(TREND.BEAR_REV)),
      };
    }
  
    function paint(rows) {
      const { bullCont, bearCont, bullRev, bearRev } = splitByTrend(rows);
      // Row 1
      renderPivotGroup('pivotTableBullCont', bullCont);
      renderPivotGroup('pivotTableBullRev',  bullRev);
      // Row 2
      renderPivotGroup('pivotTableBearCont', bearCont);
      renderPivotGroup('pivotTableBearRev',  bearRev);
    }
  
    // Initial snapshot (priority paint)
    (async function boot() {
      try {
        const r = await fetch('/pivot/latest', { cache: 'no-store' });
        const rows = await r.json();
        paint(rows);
      } catch {
        // ignore; socket will update
      }
    })();
  
    // Live updates
    socket.on('pivotUpdate', paint);
  })();
  