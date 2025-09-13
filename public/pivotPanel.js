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
      if (Math.abs(diff) <= Number(tol)) {
        td.classList.add('near-zero', 'blink');
      }
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
  
          // Ticker
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
  
          // ---- Mid-point with inline (±diff to current price) + blink on tolerance ----
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
  
          // ---- Open / Price (price colored vs open) ----
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
  
          // ---- Pivot Levels (simple text: R5 → ... → S5, incl. PrevHigh/PrevLow) ----
          const tdLevels = document.createElement('td');
  
          const text =
            r.pivotLevelsText ||
            (r.pivotLevels && typeof r.pivotLevels.text === 'string' ? r.pivotLevels.text : null);
  
          if (text) {
            tdLevels.textContent = text;  // simple text for now
          } else {
            // Fallback if only CPR is present (older server)
            const pl = r.pivotLevels || r.cpr || null;
            const P  = (pl && typeof pl.P  === 'number') ? pl.P  : (typeof r.P  === 'number' ? r.P  : null);
            const BC = (pl && typeof pl.BC === 'number') ? pl.BC : (typeof r.BC === 'number' ? r.BC : null);
            const TC = (pl && typeof pl.TC === 'number') ? pl.TC : (typeof r.TC === 'number' ? r.TC : null);
            const parts = [];
            if (TC != null) parts.push(`TC ${fmt2(TC)}`);
            if (P  != null) parts.push(`P ${fmt2(P)}`);
            if (BC != null) parts.push(`BC ${fmt2(BC)}`);
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
  