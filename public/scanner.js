const socket = io();

let alerts = [];
let priceData = {};

function renderTable() {
    const buyTbody = document.querySelector('#scannerTableBuy tbody');
    const sellTbody = document.querySelector('#scannerTableSell tbody');

    buyTbody.innerHTML = '';
    sellTbody.innerHTML = '';

    alerts.forEach(a => {
        const row = document.createElement('tr');

        const columns = [
            a.Time,
            a.Ticker,
            '', // Pivot Rel.
            '', // Trend
            a.AI_5m ? a.AI_5m : '',
            a.AI_15m ? a.AI_15m : '',
            a.AI_1h ? a.AI_1h : '',
            priceData[a.Ticker]?.Price || '',
            priceData[a.Ticker]?.DayMid || '',
            priceData[a.Ticker]?.WeeklyMid || '',
            priceData[a.Ticker]?.MA20 || '',
            a.NCPR || '',
            a.Pivot || ''
        ];

        columns.forEach((c, i) => {
            const td = document.createElement('td');
            td.textContent = c;

            // Color Buy/Sell
            if (['AI_5m','AI_15m','AI_1h'][i-4]) {
                if (c === 'Buy') td.style.color = 'green';
                else if (c === 'Sell') td.style.color = 'red';
            }
            row.appendChild(td);
        });

        if (a.Zone === 'green') buyTbody.appendChild(row);
        else sellTbody.appendChild(row);
    });
}

// Receive alerts
socket.on('alertsUpdate', data => {
    alerts = data;
    renderTable();
});

// Receive live price updates
socket.on('priceUpdate', data => {
    priceData = data;
    renderTable();
});
