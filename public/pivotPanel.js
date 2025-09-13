/* global io */
(function () {
    const socket = io();

    const TREND = {
        BULL_CONT: 'Bullish Continuation',
        BEAR_CONT: 'Bearish Continuation',
        BULL_REV: 'Bullish Trend Reversal',
        BEAR_REV: 'Bearish Trend Reversal'
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

                // Midpoint can arrive under several names
                const midRaw =
                    r.midpoint ?? r.midPoint ?? r.mid ??
                    r.cprMid ?? r.pivotMid ?? r.Mid ?? r.MID;

                // Open can arrive as strings or different keys
                const openRaw =
                    r.open ?? r.openPrice ?? r.o ??
                    r.Open ?? r.OPEN;

                const tr = document.createElement('tr');

                const tdTicker = document.createElement('td');
                tdTicker.textContent = ticker;
                tr.appendChild(tdTicker);

                const tdRel = document.createElement('td');
                tdRel.textContent = rel;
                if (rel) tdRel.classList.add('emphasis');
                tr.appendChild(tdRel);

                const tdMid = document.createElement('td');
                tdMid.textContent =
                    (midRaw != null && isFinite(Number(midRaw))) ? Number(midRaw).toFixed(2) : '';
                tr.appendChild(tdMid);

                const tdOpen = document.createElement('td');
                const openVal = (openRaw != null && isFinite(Number(openRaw))) ? Number(openRaw).toFixed(2) : '';
                const priceVal = (r.currentPrice != null && isFinite(Number(r.currentPrice))) ? Number(r.currentPrice).toFixed(2) : '';

                if (openVal) {
                    tdOpen.textContent = openVal;
                }

                if (priceVal) {
                    const span = document.createElement('span');
                    span.textContent = ` / ${priceVal}`;
                    if (Number(r.currentPrice) > Number(openRaw)) {
                        span.style.color = 'limegreen';
                    } else if (Number(r.currentPrice) < Number(openRaw)) {
                        span.style.color = 'red';
                    }
                    tdOpen.appendChild(span);
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
        return {
            bullCont: rows.filter(r => lc(r.trend) === lc(TREND.BULL_CONT)),
            bearCont: rows.filter(r => lc(r.trend) === lc(TREND.BEAR_CONT)),
            bullRev: rows.filter(r => lc(r.trend) === lc(TREND.BULL_REV)),
            bearRev: rows.filter(r => lc(r.trend) === lc(TREND.BEAR_REV)),
        };
    }

    function paint(rows) {
        const { bullCont, bearCont, bullRev, bearRev } = splitByTrend(Array.isArray(rows) ? rows : []);

        // Order:
        // Row 1: Bullish Continuation, Bullish Trend Reversal
        // Row 2: Bearish Continuation, Bearish Trend Reversal
        renderPivotGroup('pivotTableBullCont', bullCont);
        renderPivotGroup('pivotTableBullRev', bullRev);
        renderPivotGroup('pivotTableBearCont', bearCont);
        renderPivotGroup('pivotTableBearRev', bearRev);
    }

    // Initial snapshot (priority paint)
    (async function boot() {
        try {
            const r = await fetch('/pivot/latest', { cache: 'no-store' });
            const rows = await r.json();
            paint(rows);
        } catch (e) {
            // ignore; socket will update
        }
    })();

    // Live updates
    socket.on('pivotUpdate', paint);
})();
