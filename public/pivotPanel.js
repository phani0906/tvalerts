/* global io */
(function () {
    const socket = io();
  
    const TREND = {
      BULL_CONT: 'Bullish Continuation',
      BEAR_CONT: 'Bearish Continuation',
      BULL_REV:  'Bullish Trend Reversal',
      BEAR_REV:  'Bearish Trend Reversal'
    };
  
    // ===== Tolerance (fetched from server /tolerance; fallback defaults) =====
    let TOL = { pivot_mid: 1.0 };
    (async function loadTol() {
      try {
        const r = await fetch('/tolerance', { cache: 'no-store' });
        if (r.ok) TOL = Object.assign(TOL, await r.json());
        window.PIVOT_TOLERANCE = TOL; // expose for quick tweaking
      } catch { /* keep defaults */ }
    })();
  
    function fmt2(v) {
      if (v == null || v === '') return '';
      const n = Number(v);
      return Number.isNaN(n) ? '' : n.toFixed(2);
    }
    const isNum = v => v != null && isFinite(Number(v));
    const num   = v => Number(v);
  
    function applyNearZeroBlink(td, diff, tol) {
      td.classList.remove('near-zero', 'blink');
      if (!isNum(diff) || !isNum(tol)) return;
      if (Math.abs(diff) <= Number(tol)) td.classList.add('near-zero', 'blink');
    }
  
    function renderPivotGroup(tableId, rows) {
      try {
        const table = document.getElementById(tableId);
        if (!table) { console.warn(`[pivot] table not found: #${tableId}`); return; }
        const tbody = table.querySelector('tbody');
        if (!tbody) { console.warn(`[pivot] tbody missing in #${tableId}`); return; }
  
        const list = Array.isArray(rows) ? rows : [];
        tbody.innerHTML = '';
  
        for (const r of list) {
          const ticker = r.ticker ?? r.Ticker ?? '';
          const rel =
            r.relationshipLabel ??
            r.pivotRelationship ??
            r.relationship ?? '';
  
          const midRaw =
            r.midpoint ?? r.midPoint ?? r.mid ??
            r.cprMid ?? r.pivotMid ?? r.Mid ?? r.MID;
  
          const openRaw =
            r.open ?? r.openPrice ?? r.o ??
            r.Open ?? r.OPEN;
  
          const priceRaw = r.currentPrice ?? r.price ?? r.Price;
  
          const tr = document.createElement('tr');
  
          // ===== Ticker =====
          const tdTicker = document.createElement('td');
          tdTicker.textContent = ticker;
          tr.appendChild(tdTicker);
  
          // ===== Pivot Relationship (short form + color) =====
          const tdRel = document.createElement('td');
          const relMap = {
            'Higher Value': 'HV',
            'Overlapping Higher Value': 'OHV',
            'Lower Value': 'LV',
            'Overlapping Lower Value': 'OLV',
            'Inner Value': 'IV',
            'Outside Value': 'OV',
            'No change': 'NC',
            'No Change': 'NC',
            'Nochange': 'NC'
          };
          const shortRel = relMap[rel] || (rel || '');
          tdRel.textContent = shortRel;
  
          if (shortRel === 'HV' || shortRel === 'OHV') {
            tdRel.style.color = 'limegreen';
            tdRel.style.fontWeight = '700';
          } else if (shortRel === 'LV' || shortRel === 'OLV') {
            tdRel.style.color = 'red';
            tdRel.style.fontWeight = '700';
          } else if (shortRel === 'IV') {
            tdRel.style.color = 'deepskyblue';
            tdRel.style.fontWeight = '700';
          } else if (shortRel === 'OV' || shortRel === 'NC') {
            tdRel.style.color = 'gray';
            tdRel.style.fontWeight = '700';
          }
          if (shortRel) tdRel.classList.add('emphasis');
          tr.appendChild(tdRel);
  
          // ===== Open / Price (moved BEFORE Mid-point) =====
          const tdOpen = document.createElement('td');
          const openVal = isNum(openRaw) ? num(openRaw) : null;
          const priceVal = isNum(priceRaw) ? num(priceRaw) : null;
  
          if (openVal != null || priceVal != null) {
            // render "open / price" as two spans so we can highlight price independently
            const openSpan  = document.createElement('span');
            const priceSpan = document.createElement('span');
  
            if (openVal != null) {
              openSpan.textContent = fmt2(openVal) + (priceVal != null ? ' / ' : '');
            }
  
            if (priceVal != null) {
              priceSpan.textContent = fmt2(priceVal);
            }
  
            // default color logic vs open, if both present
            if (openVal != null && priceVal != null) {
              if (priceVal > openVal) priceSpan.style.color = 'limegreen';
              else if (priceVal < openVal) priceSpan.style.color = 'red';
            }
  
            tdOpen.appendChild(openSpan);
            tdOpen.appendChild(priceSpan);
          }
          tr.appendChild(tdOpen);
  
          // ===== Mid-point (now AFTER Open/Price) =====
          const tdMid = document.createElement('td');
          const midVal = isNum(midRaw) ? num(midRaw) : null;
  
          if (midVal != null) {
            if (priceVal != null) {
              const diff = priceVal - midVal;
              const span = document.createElement('span');
              span.textContent = `${fmt2(midVal)} (${diff >= 0 ? '+' : ''}${fmt2(diff)})`;
              span.className = diff >= 0 ? 'diff-up' : 'diff-down';
              tdMid.appendChild(span);
              applyNearZeroBlink(tdMid, diff, TOL.pivot_mid);
            } else {
              tdMid.textContent = fmt2(midVal);
            }
          }
          tr.appendChild(tdMid);
  
          // ===== Pivot Levels (sorted ascending, two-line blocks with pipes) =====
          const tdLevels = document.createElement('td');
          tdLevels.innerHTML = '';
  
          const pl = r.pivotLevels || null;
          if (pl) {
            let levels = [
              { key: 'R5', val: pl.R5 },
              { key: 'R4', val: pl.R4 },
              { key: 'R3', val: pl.R3 },
              { key: 'H',  val: pl.prevHigh },
              { key: 'TC', val: pl.TC },
              { key: 'P',  val: pl.P },
              { key: 'BC', val: pl.BC },
              { key: 'L',  val: pl.prevLow },
              { key: 'S3', val: pl.S3 },
              { key: 'S4', val: pl.S4 },
              { key: 'S5', val: pl.S5 },
            ].filter(l => isNum(l.val));
  
            // sort ascending by price
            levels.sort((a, b) => a.val - b.val);
  
            // ---- find the bracketing pair around current price ----
            let leftIdx = -1, rightIdx = -1;
            if (isNum(priceVal) && levels.length > 0) {
              for (let i = 0; i < levels.length - 1; i++) {
                const a = levels[i].val, b = levels[i + 1].val;
                if (priceVal >= a && priceVal <= b) {
                  leftIdx = i;
                  rightIdx = i + 1;
                  break;
                }
              }
              // endpoints: if price below min or above max, highlight nearest pair
              if (leftIdx === -1 && priceVal < levels[0].val && levels.length >= 2) {
                leftIdx = 0; rightIdx = 1;
              }
              if (leftIdx === -1 && priceVal > levels[levels.length - 1].val && levels.length >= 2) {
                leftIdx = levels.length - 2; rightIdx = levels.length - 1;
              }
            }
  
            const row = document.createElement('div');
            row.className = 'pivot-text-row';
  
            levels.forEach((lvl, idx) => {
              const block = document.createElement('span');
              block.className = 'pivot-text-block';
  
              // apply green highlight if this block is one of the bracketing pair
              if (idx === leftIdx || idx === rightIdx) {
                block.classList.add('pivot-hl');
              }
  
              const line1 = document.createElement('div');
              line1.className = 'pivot-text-key';
              line1.textContent = String(lvl.key);
  
              const line2 = document.createElement('div');
              line2.className = 'pivot-text-price';
              line2.textContent = fmt2(lvl.val);
  
              block.appendChild(line1);
              block.appendChild(line2);
              row.appendChild(block);
  
              if (idx < levels.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'pivot-text-sep';
                sep.textContent = ' | ';
                row.appendChild(sep);
              }
            });
  
            tdLevels.appendChild(row);
  
            // also force the current price (in Open/Price col) to green if we found a bracket
            if (leftIdx !== -1 && rightIdx !== -1) {
              const priceSpan = tdOpen.querySelector('span:last-child');
              if (priceSpan) {
                priceSpan.classList.add('pivot-hl-price');
              }
            }
  
            /* ===== Old circle UI (kept, commented out) =====
            const container = document.createElement('div');
            container.className = 'pivot-circles';
            for (const lvl of levels) {
              const wrapper = document.createElement('div');
              wrapper.className = 'circle-wrapper';
              const circle = document.createElement('div');
              circle.className = 'circle';
              circle.textContent = lvl.key;
              const price = document.createElement('div');
              price.className = 'circle-price';
              price.textContent = fmt2(lvl.val);
              wrapper.appendChild(circle);
              wrapper.appendChild(price);
              container.appendChild(wrapper);
            }
            tdLevels.appendChild(container);
            ===== end old UI ===== */
          }
          tr.appendChild(tdLevels);
  
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
      renderPivotGroup('pivotTableBullCont', bullCont);
      renderPivotGroup('pivotTableBullRev',  bullRev);
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
  