/* global io */
(function () {
    const socket = io();

    const TREND = {
        BULL_CONT: 'Bullish Continuation',
        BEAR_CONT: 'Bearish Continuation',
        BULL_REV: 'Bullish Trend Reversal',
        BEAR_REV: 'Bearish Trend Reversal'
    };

    // ===== Tolerance (from server) =====
    let TOL = { pivot_mid: 1.0 };
    (async function loadTol() {
        try {
            const r = await fetch('/tolerance', { cache: 'no-store' });
            if (r.ok) TOL = Object.assign(TOL, await r.json());
            window.PIVOT_TOLERANCE = TOL;
        } catch { }
    })();

    // ===== Live touch flags & pivot cache =====
    const TOUCH = new Map();           // ticker -> { mid:boolean, pdh:boolean }
    let LAST_PIVOT_ROWS = [];          // cache latest rows so we can repaint on price updates

    // repaint helper after we update TOUCH
    function repaintIfPossible() {
        if (Array.isArray(LAST_PIVOT_ROWS) && LAST_PIVOT_ROWS.length) {
            paint(LAST_PIVOT_ROWS);
        }
    }

    // ===== utils =====
    function fmt2(v) {
        if (v == null || v === '') return '';
        const n = Number(v);
        return Number.isNaN(n) ? '' : n.toFixed(2);
    }
    const isNum = v => v != null && isFinite(Number(v));
    const num = v => Number(v);

    function applyNearZeroBlink(td, diff, tol) {
        td.classList.remove('near-zero', 'blink');
        if (!isNum(diff) || !isNum(tol)) return;
        if (Math.abs(diff) <= Number(tol)) td.classList.add('near-zero', 'blink');
    }

    function greenTick() {
        const s = document.createElement('span');
        s.textContent = '✔ ';
        s.style.color = 'limegreen';
        s.style.fontWeight = '700';
        return s;
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
                const flags = TOUCH.get(ticker) || { mid: false, pdh: false };

                const relText =
                    r.relationshipLabel ??
                    r.pivotRelationship ??
                    r.relationship ?? '';

                const midRaw = r.midpoint ?? r.midPoint ?? r.mid ?? r.cprMid ?? r.pivotMid ?? r.Mid ?? r.MID;
                const pdhRaw = r.pdh;
                const openRaw = r.openPrice ?? r.open ?? r.Open;
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
                    'No Change': 'NC',
                    'Nochange': 'NC'
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
                    const rkTxt = (rk != null) ? ` • rank ${rk}/10` : '';
                    badge.title = `CPR width ${Number(w).toFixed(2)}${rkTxt}${pctTxt}`;
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
                const openVal = isNum(openRaw) ? num(openRaw) : null;
                const priceVal = isNum(priceRaw) ? num(priceRaw) : null;

                if (openVal != null || priceVal != null) {
                    const openSpan = document.createElement('span');
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

                    // tolerance: only mark red if below -0.30; between -0.30 and 0 is neutral
                    if (diff < -0.30) {
                        span.className = 'diff-down';
                    } else if (diff >= 0) {
                        span.className = 'diff-up';
                    } else {
                        span.className = 'diff-neutral';
                    }

                    td.appendChild(span);

                    // keep your near-zero blink using existing tolerance
                    applyNearZeroBlink(td, diff, TOL.pivot_mid);
                }
                tr.appendChild(td);

                // --- PDH ---
                td = document.createElement('td');
                const pdhVal = isNum(pdhRaw) ? num(pdhRaw) : null;
                if (pdhVal != null && priceVal != null) {
                    const diff = priceVal - pdhVal;

                    if (flags.pdh) td.appendChild(greenTick());  // ✔ comes first

                    const span = document.createElement('span');
                    span.textContent = `${fmt2(pdhVal)} (${diff >= 0 ? '+' : ''}${fmt2(diff)})`;

                    // tolerance: only mark red if below -0.30; between -0.30 and 0 is neutral
                    if (diff < -0.30) {
                        span.className = 'diff-down';
                    } else if (diff >= 0) {
                        span.className = 'diff-up';
                    } else {
                        span.className = 'diff-neutral';
                    }

                    td.appendChild(span);

                    // reuse same blink tolerance as mid-point unless you want a separate one
                    applyNearZeroBlink(td, diff, TOL.pivot_mid);
                }
                tr.appendChild(td);

                // --- Daily MA20 (with % diff)
                td = document.createElement('td');
                const maVal = isNum(r.ma20Daily) ? num(r.ma20Daily) : null;
                if (maVal != null) {
                    if (priceVal != null && maVal !== 0) {
                        const pct = ((priceVal - maVal) / maVal) * 100;
                        const span = document.createElement('span');
                        span.textContent = `${fmt2(maVal)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
                        span.className = pct >= 0 ? 'diff-up' : 'diff-down';
                        td.appendChild(span);
                    } else {
                        td.textContent = fmt2(maVal);
                    }
                }
                tr.appendChild(td);

                // --- Pivot Levels (sorted, BC blue & neighbors highlighted)
                td = document.createElement('td');
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

                    levels.sort((a, b) => a.val - b.val);

                    let leftIdx = -1, rightIdx = -1;
                    if (isNum(priceVal) && levels.length > 0) {
                        for (let i = 0; i < levels.length - 1; i++) {
                            const a = levels[i].val, b = levels[i + 1].val;
                            if (priceVal >= a && priceVal <= b) { leftIdx = i; rightIdx = i + 1; break; }
                        }
                        if (leftIdx === -1 && priceVal < levels[0].val && levels.length >= 2) { leftIdx = 0; rightIdx = 1; }
                        if (leftIdx === -1 && priceVal > levels[levels.length - 1].val && levels.length >= 2) { leftIdx = levels.length - 2; rightIdx = levels.length - 1; }
                    }

                    const row = document.createElement('div');
                    row.className = 'pivot-text-row';

                    levels.forEach((lvl, idx) => {
                        const block = document.createElement('span');
                        block.className = 'pivot-text-block';
                        if (idx === leftIdx || idx === rightIdx) block.classList.add('pivot-hl');

                        const line1 = document.createElement('div');
                        line1.className = 'pivot-text-key';

                        // H -> PDH, L -> PDL (UI label only)
                        const keyLabel = (lvl.key === 'H') ? 'PDH' : (lvl.key === 'L') ? 'PDL' : lvl.key;
                        line1.textContent = keyLabel;

                        if (lvl.key === 'BC') { line1.style.color = '#1E90FF'; line1.style.fontWeight = '700'; }

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

        // helpful debug
        console.log('[pivot] counts', {
          total: (rows || []).length,
          bullCont: bullCont.length,
          bearCont: bearCont.length,
          bullRev: bullRev.length,
          bearRev: bearRev.length
        });

        renderPivotGroup('pivotTableBullCont', bullCont);
        renderPivotGroup('pivotTableBearCont', bearCont);
        renderPivotGroup('pivotTableBullRev', bullRev);
        renderPivotGroup('pivotTableBearRev', bearRev);
    }

    // ===== initial boot =====
    (async function boot() {
        try {
            const r = await fetch('/pivot/latest', { cache: 'no-store' });
            LAST_PIVOT_ROWS = await r.json();
            paint(LAST_PIVOT_ROWS);
        } catch { }
    })();

    // ===== sockets =====
    socket.on('pivotUpdate', (rows) => {
        LAST_PIVOT_ROWS = Array.isArray(rows) ? rows : [];
        paint(LAST_PIVOT_ROWS);
    });

    socket.on('priceUpdate', (snapshot) => {
        if (!snapshot || typeof snapshot !== 'object') return;
        for (const [t, data] of Object.entries(snapshot)) {
            TOUCH.set(t, {
                mid: !!data.TouchMid,
                pdh: !!data.TouchPDH
            });
        }
        // ✅ repaint so ticks show up immediately
        repaintIfPossible();
    });
})();
