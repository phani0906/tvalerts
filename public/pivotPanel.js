/* global io */
(function () {
    const socket = io();

    const TREND = {
        BULL_CONT: 'Bullish Continuation',
        BEAR_CONT: 'Bearish Continuation',
        BULL_REV:  'Bullish Trend Reversal',
        BEAR_REV:  'Bearish Trend Reversal'
    };

    // ===== Tolerance (from server) =====
    let TOL = { pivot_mid: 1.0 };
    (async function loadTol() {
        try {
            const r = await fetch('/tolerance', { cache: 'no-store' });
            if (r.ok) TOL = Object.assign(TOL, await r.json());
            window.PIVOT_TOLERANCE = TOL;
        } catch {}
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

    function greenTick() {
        const s = document.createElement('span');
        s.textContent = '✔ ';
        s.style.color = 'limegreen';
        s.style.fontWeight = '700';
        return s;
    }

    // ===== AI 5m signal source (from scanner.js) =====
    function getAISignal(ticker) {
        const map = window.AI_5M;
        if (!map || typeof map.get !== 'function') return '';
        const key = String(ticker || '').toUpperCase();
        const v = map.get(key);
        if (!v) return '';
        const s = (typeof v === 'string') ? v : (v.side || v.signal || '');
        const up = String(s).toUpperCase();
        if (up.includes('SELL') || up.includes('RED') || up.includes('SHORT')) return 'SELL';
        if (up.includes('BUY')  || up.includes('GREEN') || up.includes('LONG'))  return 'BUY';
        return '';
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

                const relText = r.relationshipLabel ?? r.pivotRelationship ?? r.relationship ?? '';
                const midRaw   = r.midpoint ?? r.midPoint ?? r.mid ?? r.cprMid ?? r.pivotMid ?? r.Mid ?? r.MID;
                const openRaw  = r.openPrice ?? r.open ?? r.Open;
                const priceRaw = r.currentPrice ?? r.price ?? r.Price;

                const tr = document.createElement('tr');

                // --- Ticker
                let td = document.createElement('td');
                td.textContent = ticker;
                tr.appendChild(td);

                // --- Pivot Relationship + CPR Badge
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
                const priceVal = isNum(priceRaw) ? num(priceRaw) : null;

                if (openVal != null || priceVal != null) {
                    const openSpan  = document.createElement('span');
                    const priceSpan = document.createElement('span');

                    if (openVal != null) openSpan.textContent = fmt2(openVal) + (priceVal != null ? ' / ' : '');
                    if (priceVal != null) {
                        if (flags.mid) td.appendChild(greenTick());
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

                // --- Mid-point
                td = document.createElement('td');
                const midVal = isNum(midRaw) ? num(midRaw) : null;
                if (midVal != null && priceVal != null) {
                    const diff = priceVal - midVal;

                    const span = document.createElement('span');
                    span.textContent = `${fmt2(midVal)} (${diff >= 0 ? '+' : ''}${fmt2(diff)})`;

                    if (diff < -0.30)      span.className = 'diff-down';
                    else if (diff >= 0)    span.className = 'diff-up';
                    else                   span.className = 'diff-neutral';

                    td.appendChild(span);
                    applyNearZeroBlink(td, diff, TOL.pivot_mid);
                }
                tr.appendChild(td);

                // --- AI 5 min
                td = document.createElement('td');
                const ai = getAISignal(ticker);
                if (ai) {
                    const chip = document.createElement('span');
                    chip.textContent = ai;
                    chip.className = `ai-chip ${ai === 'BUY' ? 'signal-buy' : 'signal-sell'}`;
                    td.appendChild(chip);
                }
                tr.appendChild(td);

                // --- Daily MA20
                td = document.createElement('td');
                const maVal = isNum(r.ma20Daily) ? num(r.ma20Daily) : null;
                if (maVal != null && priceVal != null && maVal !== 0) {
                    const pct  = ((priceVal - maVal) / maVal) * 100;
                    const span = document.createElement('span');
                    span.textContent = `${fmt2(maVal)} (${pct >= 0 ? '+' : ''}${fmt2(pct)}%)`;
                    td.appendChild(span);
                }
                tr.appendChild(td);

                tbody.appendChild(tr);

                // --- AI blink logic
                const prev = AI_SIGNAL_PREV.get(ticker);
                if (prev && prev !== ai) {
                    td.classList.add('ai-blink');
                    if (AI_SIGNAL_BLINK.has(ticker)) clearTimeout(AI_SIGNAL_BLINK.get(ticker));
                    const tId = setTimeout(() => {
                        td.classList.remove('ai-blink');
                        AI_SIGNAL_BLINK.delete(ticker);
                    }, 10 * 60 * 1000);
                    AI_SIGNAL_BLINK.set(ticker, tId);
                }
                AI_SIGNAL_PREV.set(ticker, ai);
            }
        } catch (e) {
            console.error('renderPivotGroup error', e);
        }
    }

    window.renderPivotGroup = renderPivotGroup;
})();
