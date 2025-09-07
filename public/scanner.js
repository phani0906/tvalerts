const socket = io();

const tableBuy = document.querySelector('#scannerTableBuy tbody');
const tableSell = document.querySelector('#scannerTableSell tbody');

socket.on('alertsUpdate', (alerts) => {
    // Clear tables
    tableBuy.innerHTML = '';
    tableSell.innerHTML = '';

    alerts.forEach(alert => {
        const row = document.createElement('tr');

        // Create cells
        const columns = [
            alert.Time,
            alert.Ticker,
            alert.PivotRel || '',
            alert.Trend || '',
            alert.AI_5m || '',
            alert.AI_15m || '',
            alert.AI_1h || '',
            alert.Price || '',
            alert.DayMid || '',
            alert.WeeklyMid || '',
            alert.MA20 || '',
            alert.NCPR || '',
            alert.Pivot || ''
        ];

        columns.forEach((colValue, idx) => {
            const td = document.createElement('td');
            td.textContent = colValue;

            // Color logic for Buy/Sell in AI columns
            if ([4, 5, 6].includes(idx)) { // AI_5m, AI_15m, AI_1h columns
                if (colValue === 'Buy') td.style.color = 'green';
                if (colValue === 'Sell') td.style.color = 'red';
            }

            row.appendChild(td);
        });

        // Append row to correct table based on zone
        if (alert.Zone === 'green') {
            tableBuy.appendChild(row);
        } else {
            tableSell.appendChild(row);
        }
    });
});
