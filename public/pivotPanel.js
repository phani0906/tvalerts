/* global io */
(function () {
    const socket = io();
  
    const TREND = {
      BULL_CONT: 'Bullish Continuation',
      BEAR_CONT: 'Bearish Continuation',
      BULL_REV:  'Bullish Trend Reversal',
      BEAR_REV:  'Bearish Trend Reversal'
    };
  
    const hBullCont = document.querySelector('h3.table-title:has(+ table#pivotTableBullCont)');
    const hBearCont = document.querySelector('h3.table-title:has(+ table#pivotTableBearCont)');
    const hBullRev  = document.querySelector('h3.table-title:has(+ table#pivotTableBullRev)');
    const hBearRev  = document.querySelector('h3.table-title:has(+ table#pivotTableBearRev)');
  
    function fmt2(v){ if(v==null||v==='')return ''; const n=Number(v); return Number.isNaN(n)?'':n.toFixed(2); }
    function formatTimeToCST(iso){
      if(!iso) return '';
      try{
        const d=new Date(iso);
        const parts=new Intl.DateTimeFormat('en-US',{
          timeZone:'America/Chicago',day:'2-digit',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false
        }).formatToParts(d);
        const get=k=>parts.find(p=>p.type===k)?.value||'';
        return `${get('day')} ${get('month')}'${get('year')} ${get('hour')}:${get('minute')}`;
      }catch{return iso;}
    }
  
    function renderBody(tbody, rows){
      if(!tbody) return;
      tbody.innerHTML='';
      const sorted=[...(rows||[])].sort((a,b)=>a.ticker.localeCompare(b.ticker));
      for(const r of sorted){
        const tr=document.createElement('tr');
  
        const add=(txt)=>{ const td=document.createElement('td'); td.textContent=txt; tr.appendChild(td); };
        add(formatTimeToCST(r.ts));
        add(r.ticker||'');
        add(r.pivotRelationship||'Unknown');
        add(r.trend||'Developing');
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
    function setCount(el, title, n){ if(el) el.textContent = `${title} (${n})`; }
  
    function paint(rows){
      const { bullCont, bearCont, bullRev, bearRev } = splitByTrend(Array.isArray(rows)?rows:[]);
      renderBody(document.querySelector('#pivotTableBullCont tbody'), bullCont);
      renderBody(document.querySelector('#pivotTableBearCont tbody'), bearCont);
      renderBody(document.querySelector('#pivotTableBullRev tbody'),  bullRev);
      renderBody(document.querySelector('#pivotTableBearRev tbody'),  bearRev);
      setCount(hBullCont,'📈 Bullish Continuation',bullCont.length);
      setCount(hBearCont,'📉 Bearish Continuation',bearCont.length);
      setCount(hBullRev, '🔁 Bullish Trend Reversal',bullRev.length);
      setCount(hBearRev, '🔁 Bearish Trend Reversal',bearRev.length);
    }
  
    // Priority paint: fetch snapshot immediately
    (async function boot(){
      try{
        const r=await fetch('/pivot/latest',{cache:'no-store'});
        const rows=await r.json();
        paint(rows);
      }catch(e){ /* no-op; socket will fill shortly */ }
    })();
  
    // Then keep it live with sockets
    socket.on('pivotUpdate', paint);
  })();
  