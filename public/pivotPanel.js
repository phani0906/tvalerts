/* global io */
(function () {
    const socket = io();
  
    const TREND = {
      BULL_CONT: 'Bullish Continuation',
      BEAR_CONT: 'Bearish Continuation',
      BULL_REV:  'Bullish Trend Reversal',
      BEAR_REV:  'Bearish Trend Reversal'
    };
  
    function fmt2(v){ if(v==null||v==='')return ''; const n=Number(v); return Number.isNaN(n)?'':n.toFixed(2); }
  
    function renderBody(tbody, rows){
      if(!tbody) return;
      tbody.innerHTML=''; // clears skeletons automatically
      const sorted=[...(rows||[])].sort((a,b)=>a.ticker.localeCompare(b.ticker));
      for(const r of sorted){
        const tr=document.createElement('tr');
        const add=(txt)=>{ const td=document.createElement('td'); td.textContent=txt; tr.appendChild(td); };
  
        // No Date/Time column by request
        add(r.ticker || '');
        add(r.pivotRelationship || 'Unknown');
        add(r.trend || 'Developing');
        add(fmt2(r.midPoint));
        add(fmt2(r.openPrice));
  
        tbody.appendChild(tr);
      }
    }
  
    const lc=s=>String(s||'').toLowerCase();
    function splitByTrend(rows){
      return {
        bullCont: rows.filter(r=>lc(r.trend)===lc(TREND.BULL_CONT)),
        bearCont: rows.filter(r=>lc(r.trend)===lc(TREND.BEAR_CONT)),
        bullRev:  rows.filter(r=>lc(r.trend)===lc(TREND.BULL_REV)),
        bearRev:  rows.filter(r=>lc(r.trend)===lc(TREND.BEAR_REV)),
      };
    }
  
    function paint(rows){
      const { bullCont, bearCont, bullRev, bearRev } = splitByTrend(Array.isArray(rows)?rows:[]);
      renderBody(document.querySelector('#pivotTableBullCont tbody'), bullCont);
      renderBody(document.querySelector('#pivotTableBearCont tbody'), bearCont);
      renderBody(document.querySelector('#pivotTableBullRev tbody'),  bullRev);
      renderBody(document.querySelector('#pivotTableBearRev tbody'),  bearRev);
    }
  
    // Priority paint: fetch snapshot immediately
    (async function boot(){
      try{
        const r=await fetch('/pivot/latest',{cache:'no-store'});
        const rows=await r.json();
        paint(rows);
      }catch(e){ /* ignore; socket will update */ }
    })();
  
    // Then keep it live with sockets
    socket.on('pivotUpdate', paint);
  })();
  