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
          // ---- tolerant field resolution ----
          const ticker = r.ticker ?? r.Ticker ?? '';
  
          const rel =
            r.relationshipLabel ??
            r.pivotRelationship ??
            r.relationship ?? '';
  
          // Mid-point (various keys)
          const midRaw =
            r.midpoint ?? r.midPoint ?? r.mid ??
            r.cprMid ?? r.pivotMid ?? r.Mid ?? r.MID;
  
          // Open and live Price
          const openRaw =
            r.open ?? r.openPrice ?? r.o ??
            r.Open ?? r.OPEN;
  
          // Prefer server-provided currentPrice; fall back to price/Price if present
          const priceRaw = r.currentPrice ?? r.price ?? r.Price;
  
          const tr = document.createElement('tr');
  
          // ===== Ticker =====
          const tdTicker = document.createElement('td');
          tdTicker.textContent = ticker;
          tr.appendChild(tdTicker);
  
          // ===== Pivot Relationship -> short form + color =====
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
  
          // color coding: HV/OHV green, LV/OLV red, IV blue, OV/NC gray
          const sr = shortRel;
          if (sr === 'HV' || sr === 'OHV') {
            tdRel.style.color = 'limegreen';
            tdRel.style.fontWeight = '700';
          } else if (sr === 'LV' || sr === 'OLV') {
            tdRel.style.color = 'red';
            tdRel.style.fontWeight = '700';
          } else if (sr === 'IV') {
            tdRel.style.color = 'deepskyblue';
            tdRel.style.fontWeight = '700';
          } else if (sr === 'OV' || sr === 'NC') {
            tdRel.style.color = 'gray';
            tdRel.style.fontWeight = '700';
          }
          if (shortRel) tdRel.classList.add('emphasis');
          tr.appendChild(tdRel);
  
          // ===== Mid-point with inline (±diff to current price) + blink on tolerance =====
          const tdMid = document.createElement('td');
          const midVal   = isNum(midRaw)   ? num(midRaw)   : null;
          const priceVal = isNum(priceRaw) ? num(priceRaw) : null;
  
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
          } else {
            tdMid.textContent = '';
          }
          tr.appendChild(tdMid);
  
          // ===== Open / Price (price colored vs open) =====
          const tdOpen = document.createElement('td');
          const openVal = isNum(openRaw) ? num(openRaw) : null;
  
          if (openVal != null) {
            if (priceVal != null) {
              const s = document.createElement('span');
              s.textContent = `${fmt2(openVal)} / ${fmt2(priceVal)}`;
              if (priceVal > openVal) s.style.color = 'limegreen';
              else if (priceVal < openVal) s.style.color = 'red';
              tdOpen.appendChild(s);
            } else {
              tdOpen.textContent = fmt2(openVal);
            }
          } else if (priceVal != null) {
            const s = document.createElement('span');
            s.textContent = fmt2(priceVal);
            tdOpen.appendChild(s);
          }
          tr.appendChild(tdOpen);
  
          // ===== Pivot Levels: circle with label inside + price below =====
          const tdLevels = document.createElement('td');
          tdLevels.innerHTML = ''; // ensure no leftover text
  
          const pl = r.pivotLevels || null;
          if (pl) {
            const levels = [
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
            ];
  
            const container = document.createElement('div');
            container.className = 'pivot-circles';
  
            for (const lvl of levels) {
              if (lvl.val == null) continue;
  
              const wrapper = document.createElement('div');
              wrapper.className = 'circle-wrapper';
  
              const circle = document.createElement('div');
              circle.className = 'circle';
              circle.textContent = lvl.key;   // label INSIDE circle
  
              const price = document.createElement('div');
              price.className = 'circle-price';
              price.textContent = fmt2(lvl.val); // price BELOW circle
  
              wrapper.appendChild(circle);
              wrapper.appendChild(price);
              container.appendChild(wrapper);
            }
  
            tdLevels.appendChild(container);
          } else {
            // fallback for very old payloads (CPR only)
            const pP  = (r.P  != null) ? r.P  : undefined;
            const pBC = (r.BC != null) ? r.BC : undefined;
            const pTC = (r.TC != null) ? r.TC : undefined;
            const parts = [];
            if (pTC !== undefined) parts.push(`TC ${fmt2(pTC)}`);
            if (pP  !== undefined) parts.push(`P ${fmt2(pP)}`);
            if (pBC !== undefined) parts.push(`BC ${fmt2(pBC)}`);
            tdLevels.textContent = parts.join(' | ');
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
  