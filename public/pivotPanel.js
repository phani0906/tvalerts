// public/pivotPanel.js
/* global io */
(function () {
    const socket = io();
  
    function fmt2(v) {
      if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '';
      return Number(v).toFixed(2);
    }
    function formatTimeToCST(isoString) {
      if (!isoString) return '';
      try {
        const d = new Date(isoString);
        const opts = {
          timeZone: 'America/Chicago',
          day: '2-digit', month: 'short', year: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false
        };
        const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(d);
        const day   = parts.find(p => p.type === 'day').value;
        const mon   = parts.find(p => p.type === 'month').value;
        const year  = parts.find(p => p.type === 'year').value;
        const hour  = parts.find(p => p.type === 'hour').value;
        const min   = parts.find(p => p.type === 'minute').value;
        return `${day} ${mon}'${year} ${hour}:${min}`;
      } catch { return isoString; }
    }
  
    function render(rows) {
      const tbody = document.querySelector('#summary5mTable tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      const sorted = [...(rows || [])].sort((a, b) => a.ticker.localeCompare(b.ticker));
      for (const r of sorted) {
        const tr = document.createElement('tr');
  
        let td = document.createElement('td');
        td.textContent = formatTimeToCST(r.ts); tr.appendChild(td);
  
        td = document.createElement('td');
        td.textContent = r.ticker || ''; tr.appendChild(td);
  
        td = document.createElement('td');
        td.textContent = r.pivotRelationship || 'Unknown'; tr.appendChild(td);
  
        td = document.createElement('td');
        td.textContent = r.trend || 'Unknown'; tr.appendChild(td);
  
        td = document.createElement('td');
        td.textContent = fmt2(r.midPoint); tr.appendChild(td);
  
        td = document.createElement('td');
        td.textContent = fmt2(r.openPrice); tr.appendChild(td);
  
        tbody.appendChild(tr);
      }
    }
  
    socket.on('pivotUpdate', render);
  })();
  