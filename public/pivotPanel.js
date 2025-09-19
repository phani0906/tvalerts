/* global io */
(function () {
  // Shared caches (even if scanner.js hasn't run yet)
  window.AI_5M      = window.AI_5M      || new Map();
  window.MA20_5M    = window.MA20_5M    || new Map();
  window.PRICE_LIVE = window.PRICE_LIVE || new Map(); // live prices for 5s updates

  const socket = io();

  const TREND = {
    BULL_CONT: 'Bullish Continuation',
    BEAR_CONT: 'Bearish Continuation',
    BULL_REV:  'Bullish Trend Reversal',
    BEAR_REV:  'Bearish Trend Reversal'
  };

  // Remember last AI signal + change time for 5m blink
  const AI_LAST = new Map(); // ticker -> { signal, changedAt }

  // ===== Tolerance (from server) =====
  let TOL = { pivot_mid: 1.0 };
  (async function loadTol() {
    try {
      const r = await fetch('/tolerance', { cache: 'no-store' });
      if (r.ok) TOL = Object.assign(TOL, await r.json());
      window.PIVOT_TOLERANCE = TOL;
      console.log('[pivot] tolerance', TOL);
    } catch (e) {
      console.warn('[pivot] tolerance fetch failed', e);
    }
  })();

  // ===== Live touch flags & pivot cache =====
  const TOUCH = new Map();  // ticker -> { mid:boolean, pdh:boolean }
  let LAST_PIVOT_ROWS = [];

  function repaintIfPossible() {
    if (Array.isArray(LAST_PIVOT_ROWS) && LAST_PIVOT_ROWS.length) {
      paint(LAST_PIVOT_ROWS);
    }
  }

  // ===== utils =====
  function fmt2(v) { if (v == null || v === '') return ''; const n = Number(v); return Number.isNaN(n) ? '' : n.toFixed(2); }
  const isNum = v => v != null && isFinite(Number(v));
  const num   = v => Number(v);

  function applyNearZeroBlink(el, diff, tol) {
    el.classList.remove('near-zero', 'blink');
    if (!isNum(diff) || !isNum(tol)) return;
    if (Math.abs(diff) <= Number(tol)) el.classList.add('near-zero', 'blink');
  }

  function greenTick() {
    const s = document.createElement('span');
    s.textContent = '✔ ';
    s.style.color = 'limegreen';
    s.style.fontWeight = '700';
    return s;
  }

  // ===== AI 5m helpers =====
  function normalizeAIStr(v) {
    if (!v) return '';
    const s = (typeof v === 'string') ? v : (v.alert || v.signal || v.side || '');
    const up = String(s).toUpperCase();
    if (up.includes('SELL') || up.includes('RED') || up.includes('SHORT')) return 'SELL';
    if (up.includes('BUY')  || up.includes('GREEN')|| up.includes('LONG'))  return 'BUY';
    return '';
  }
  function getAISignal(ticker) {
    const key = String(ticker || '').toUpperCase();
    return normalizeAIStr(window.AI_5M.get(key));
  }

  // ===== 5m MA20 access =====
  function setMA20_5m(ticker, val) {
    if (!isNum(val)) return;
    window.MA20_5M.set(String(ticker).toUpperCase(), Number(val));
  }
  function getMA20_5m(ticker) {
    const v = window.MA20_5M.get(String(ticker).toUpperCase());
    return isNum(v) ? Number(v) : null;
  }

  // ===== Live price cache (5s)
  function setLivePrice(ticker, val) {
    if (!isNum(val)) return;
    window.PRICE_LIVE.set(String(ticker).toUpperCase(), Number(val));
  }
  function getLivePrice(ticker, fallback) {
    const v = window.PRICE_LIVE.get(String(ticker).toUpperCase());
    return isNum(v) ? v : (isNum(fallback) ? Number(fallback) : null);
  }

  // ===== table painter =====
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
        const flags  = TOUCH.get(ticker) || { mid: false, pdh: false };

        const relText =
          r.relationshipLabel ??
          r.pivotRelationship ??
          r.relationship ?? '';

        const midRaw   = r.midpoint ?? r.midPoint ?? r.mid ?? r.cprMid ?? r.pivotMid ?? r.Mid ?? r.MID;
        const openRaw  = r.openPrice ?? r.open ?? r.Open;
        const priceRaw = r.currentPrice ?? r.price ?? r.Price;

        const tr = document.createElement('tr');

        // --- Ticker
        let td = document.createElement('td');
        td.textContent = ticker;
        tr.appendChild(td);

        // --- Pivot Relationship (short + CPR badge)
        td = document.createElement('td');
        const relMap = {
          'Higher Value': 'HV',
          'Overlapping Higher Value': 'OHV',
          'Lower Value': 'LV',
          'Overlapping Lower Value': 'OLV',
          'Inner Value': 'IV',
          'Outside Value': 'OV',
          'No change': 'NC',
        };
        const shortRel = relMap[relText] || (relText || '');
        td.textContent = shortRel;

        const cls = (r.cprClass || 'normal').toLowerCase();
        const badge = document.createElement('span');
        badge.className = `cpr-badge cpr-${cls}`;
        badge.textContent = cls === 'narrow' ? 'Narrow' : cls === 'wide' ? 'Wide' : 'Normal';
        const w = r.cprWidth, rk = r.cprRank, pct = r.cprPercentile;
        if (w != null) {
          const pctTxt = (pct != null) ? ` • pct ${(pct * 100).toFixed(0)}%` : '';
          const rkTxt  = (rk != null) ? ` • rank ${rk}/10` : '';
          badge.title  = `CPR width ${Number(w).toFixed(2)}${rkTxt}${pctTxt}`;
        }
        td.appendChild(document.createTextNode(' '));
        td.appendChild(badge);

        if (shortRel === 'HV' || shortRel === 'OHV') { td.style.color = 'limegreen'; td.style.fontWeight = '700'; }
        else if (shortRel === 'LV' || shortRel === 'OLV') { td.style.color = 'red'; td.style.fontWeight = '700'; }
        else if (shortRel === 'IV') { td.style.color = 'deepskyblue'; td.style.fontWeight = '700'; }
        else if (shortRel === 'OV' || shortRel === 'NC') { td.style.color = 'gray'; td.style.fontWeight = '700'; }

        if (shortRel) td.classList.add('emphasis');
        tr.appendChild(td);

        // --- Open / Price
        td = document.createElement('td');
        const openVal  = isNum(openRaw)  ? num(openRaw)  : null;
        const priceValRow = isNum(priceRaw) ? num(priceRaw) : null;
        const priceVal = getLivePrice(ticker, priceValRow); // prefer live price

        if (openVal != null || priceVal != null) {
          const openSpan  = document.createElement('span');
          const priceSpan = document.createElement('span');

          if (openVal != null) openSpan.textContent = fmt2(openVal) + (priceVal != null ? ' / ' : '');
          if (priceVal != null) {
            priceSpan.textContent = fmt2(priceVal);
            if (openVal != null) {
              if (priceVal > openVal) priceSpan.style.color = 'limegreen';
              else if (priceVal < openVal) priceSpan.style.color = 'red';
            }
          }
          td.appendChild(openSpan);
          td.appendChild(priceSpan);
        }
        tr.appendChild(td);

        // --- Mid-point ---
        td = document.createElement('td');
        const midVal = isNum(midRaw) ? num(midRaw) : null;
        if (midVal != null && priceVal != null) {
          const diff = priceVal - midVal;

          if (flags.mid) td.appendChild(greenTick());  // ✔ comes first

          const span = document.createElement('span');
          span.textContent = `${fmt2(midVal)} (${diff >= 0 ? '+' : ''}${fmt2(diff)})`;

          if (diff < -0.30)      span.className = 'diff-down';
          else if (diff >= 0)    span.className = 'diff-up';
          else                   span.className = 'diff-neutral';

          td.appendChild(span);
          applyNearZeroBlink(td, diff, TOL.pivot_mid);
        }
        tr.appendChild(td);

        // --- AI 5 min (chip + MA20(5m) beside it, 1rem gap)
        td = document.createElement('td');
        const ai = getAISignal(ticker);
        const aiWrap = document.createElement('div');
        aiWrap.className = 'ai-cell-wrap';

        if (ai) {
          const chip = document.createElement('span');
          chip.textContent = ai;
          chip.className = `ai-chip ${ai === 'BUY' ? 'signal-buy' : 'signal-sell'}`;
          const rec = AI_LAST.get(ticker.toUpperCase());
          if (rec && rec.signal === ai && Date.now() - rec.changedAt <= 300000) {
            chip.classList.add('ai-blink');
          }
          aiWrap.appendChild(chip);
        }

        const ma5m = getMA20_5m(ticker);
        if (isNum(ma5m)) {
          const sub = document.createElement('span');
          sub.className = 'ai-sub';
          if (isNum(priceVal) && ma5m !== 0) {
            const diff = priceVal - ma5m;
            const pct  = (diff / ma5m) * 100;
            sub.textContent = `${fmt2(ma5m)} (${diff >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
            sub.classList.add(diff >= 0 ? 'diff-up' : 'diff-down');
            applyNearZeroBlink(td, diff, TOL.pivot_mid);
          } else {
            sub.textContent = fmt2(ma5m);
          }
          aiWrap.appendChild(sub);
        }

        if (aiWrap.children.length > 0) td.appendChild(aiWrap);
        tr.appendChild(td);

        // --- Daily MA20 (with % diff)
        td = document.createElement('td');
        const maVal = isNum(r.ma20Daily) ? num(r.ma20Daily) : null;
        if (maVal != null) {
          if (priceVal != null && maVal !== 0) {
            const pct  = ((priceVal - maVal) / maVal) * 100;
            const span = document.createElement('span');
            span.textContent = `${fmt2(maVal)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
            span.className = pct >= 0 ? 'diff-up' : 'diff-down';
            td.appendChild(span);
          } else {
            td.textContent = fmt2(maVal);
          }
        }
        tr.appendChild(td);

        // --- Pivot Levels (NOW + OPEN included, live)
        td = document.createElement('td');
        const pl = r.pivotLevels || null;
        if (pl) {
          // Core pivot levels for neighbor-highlighting (exclude OPEN/NOW)
          let core = [
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

          core.sort((a, b) => a.val - b.val);

          // Determine neighbors around the current price (live)
          let leftIdx = -1, rightIdx = -1;
          if (isNum(priceVal) && core.length > 0) {
            for (let i = 0; i < core.length - 1; i++) {
              const a = core[i].val, b = core[i + 1].val;
              if (priceVal >= a && priceVal <= b) { leftIdx = i; rightIdx = i + 1; break; }
            }
            if (leftIdx === -1 && priceVal < core[0].val && core.length >= 2) { leftIdx = 0; rightIdx = 1; }
            if (leftIdx === -1 && priceVal > core[core.length - 1].val && core.length >= 2) { leftIdx = core.length - 2; rightIdx = core.length - 1; }
          }

          // Add OPEN & NOW to display set, then sort by price
          const display = core.slice();
          const haveOpen = isNum(openVal);
          const haveNow  = isNum(priceVal);
          if (haveOpen) display.push({ key: 'OPEN',  val: openVal });
          if (haveNow)  display.push({ key: 'NOW',   val: priceVal });

          display.sort((a, b) => a.val - b.val);

          // Helper to find display index for a core item
          const findDispIndex = (it) =>
            display.findIndex(d => d.key === it.key && Math.abs(d.val - it.val) < 1e-9);

          const leftDisp  = (leftIdx !== -1)  ? findDispIndex(core[leftIdx])  : -1;
          const rightDisp = (rightIdx !== -1) ? findDispIndex(core[rightIdx]) : -1;
          const nowDisp   = haveNow ? display.findIndex(d => d.key === 'NOW') : -1;

          const row = document.createElement('div');
          row.className = 'pivot-text-row';

          // We’ll render in a single pass. If we hit the first member of [left, NOW, right],
          // we render the whole blue range box and skip to the end of that trio.
          const trioValid = leftDisp !== -1 && rightDisp !== -1 && nowDisp !== -1;
          const trioStart = trioValid ? Math.min(leftDisp, nowDisp, rightDisp) : -1;
          const trioEnd   = trioValid ? Math.max(leftDisp, nowDisp, rightDisp) : -1;

          function renderOne(lvl, highlightNeighbors) {
            const block = document.createElement('span');
            block.className = 'pivot-text-block';

            // highlight neighbors based on *core* calculation
            if (highlightNeighbors) block.classList.add('pivot-hl');

            const line1 = document.createElement('div');
            line1.className = 'pivot-text-key';
            const keyLabel = (lvl.key === 'H') ? 'PDH' : (lvl.key === 'L') ? 'PDL' : lvl.key;
            line1.textContent = keyLabel;

            const line2 = document.createElement('div');
            line2.className = 'pivot-text-price';
            line2.textContent = fmt2(lvl.val);

            // Colors: BC + NOW both blue, OPEN yellow (key and price)
            if (lvl.key === 'BC') {
              line1.style.color = '#1E90FF';
              line1.style.fontWeight = '700';
              line2.style.color = '#1E90FF';
            }
            if (lvl.key === 'NOW') {
              line1.style.color = '#1E90FF';
              line1.style.fontWeight = '700';
              line2.style.color = '#1E90FF';
            }
            if (lvl.key === 'OPEN') {
              line1.style.color = '#FFD700';
              line1.style.fontWeight = '700';
              line2.style.color = '#FFD700';
            }

            block.appendChild(line1);
            block.appendChild(line2);
            return block;
          }

          for (let idx = 0; idx < display.length; idx++) {
            // Render blue range box if this index is the first in the trio
            if (trioValid && idx === trioStart) {
              const box = document.createElement('span');
              box.className = 'now-range'; // blue rectangle wrapper

              // determine actual order inside the trio
              const order = [leftDisp, nowDisp, rightDisp].sort((a, b) => a - b);

              order.forEach((di, j) => {
                const lvl = display[di];

                // Should neighbor-highlight apply? Only for the two pivots (left/right)
                const isCore = (lvl.key !== 'NOW');
                const highlight =
                  (isCore && (
                    (leftIdx !== -1 && lvl.key === core[leftIdx].key && Math.abs(lvl.val - core[leftIdx].val) < 1e-9) ||
                    (rightIdx !== -1 && lvl.key === core[rightIdx].key && Math.abs(lvl.val - core[rightIdx].val) < 1e-9)
                  ));

                box.appendChild(renderOne(lvl, highlight));

                if (j < order.length - 1) {
                  const sep = document.createElement('span');
                  sep.className = 'pivot-text-sep now-range-sep';
                  sep.textContent = ' | ';
                  box.appendChild(sep);
                }
              });

              row.appendChild(box);

              // Add separator after the box if not the last element overall
              if (trioEnd < display.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'pivot-text-sep';
                sep.textContent = ' | ';
                row.appendChild(sep);
              }

              // Skip everything up to the end of the trio
              idx = trioEnd;
              continue;
            }

            // Normal rendering for non-trio elements
            const lvl = display[idx];

            // highlight neighbors if this is one of the two core neighbors
            const inCoreIdx = core.findIndex(c => c.key === lvl.key && Math.abs(c.val - lvl.val) < 1e-9);
            const highlightNeighbors = (inCoreIdx !== -1 && (inCoreIdx === leftIdx || inCoreIdx === rightIdx));

            row.appendChild(renderOne(lvl, highlightNeighbors));

            if (idx < display.length - 1) {
              const sep = document.createElement('span');
              sep.className = 'pivot-text-sep';
              sep.textContent = ' | ';
              row.appendChild(sep);
            }
          }

          td.appendChild(row);

          if (leftIdx !== -1 && rightIdx !== -1) {
            const openPriceTd = tr.children[2]; // Open/Price column
            const priceSpan = openPriceTd && openPriceTd.querySelector('span:last-child');
            if (priceSpan) priceSpan.classList.add('pivot-hl-price');
          }
        }
        tr.appendChild(td);

        tbody.appendChild(tr);
      }
    } catch (err) {
      console.error(`[pivot] render error for #${tableId}:`, err);
    }
  }

  // ===== split by trend & paint =====
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

    console.log('[pivot] counts', {
      total: (rows || []).length,
      bullCont: bullCont.length,
      bearCont: bearCont.length,
      bullRev: bullRev.length,
      bearRev: bearRev.length
    });

    renderPivotGroup('pivotTableBullCont', bullCont);
    renderPivotGroup('pivotTableBearCont', bearCont);
    renderPivotGroup('pivotTableBullRev',  bullRev);
    renderPivotGroup('pivotTableBearRev',  bearRev);
  }

  // ===== initial boot =====
  (async function boot() {
    try {
      const r = await fetch('/pivot/latest', { cache: 'no-store' });
      const txt = await r.text();
      console.log('[pivot] /pivot/latest status', r.status);
      let data = [];
      try { data = JSON.parse(txt); }
      catch (e) { console.error('[pivot] bad JSON from /pivot/latest', e, txt); }
      LAST_PIVOT_ROWS = Array.isArray(data) ? data : [];
      paint(LAST_PIVOT_ROWS);
    } catch (e) {
      console.error('[pivot] boot fetch failed', e);
    }
  })();

  // ===== sockets =====
  socket.on('pivotUpdate', (rows) => {
    console.log('[pivot] pivotUpdate', Array.isArray(rows) ? rows.length : rows);
    LAST_PIVOT_ROWS = Array.isArray(rows) ? rows : [];
    paint(LAST_PIVOT_ROWS);
  });

  socket.on('priceUpdate', (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return;

    for (const [t, data] of Object.entries(snapshot)) {
      // Touch flags
      TOUCH.set(t, {
        mid: !!data.TouchMid,
        pdh: !!data.TouchPDH
      });

      // Live price for 5s refresh
      if (isNum(data?.Price)) {
        setLivePrice(t, Number(data.Price));
      }

      // AI 5m (flip blink)
      if (data && 'AI_5m' in data) {
        const aiStr = normalizeAIStr(data.AI_5m);
        const key = String(t).toUpperCase();
        const prev = AI_LAST.get(key);
        if (!prev || prev.signal !== aiStr) {
          AI_LAST.set(key, { signal: aiStr, changedAt: Date.now() });
        }
        if (aiStr) window.AI_5M.set(key, aiStr);
      }

      // MA20 (5m)
      if (isNum(data?.MA20_5m)) {
        setMA20_5m(t, Number(data.MA20_5m));
      }
    }

    // Repaint tables using fresh prices (≈ every 5s)
    repaintIfPossible();
  });
})();
