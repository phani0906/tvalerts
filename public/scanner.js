const socket = io();

// Table bodies
const buyTableBody = document.querySelector('#scannerTableBuy tbody');
const sellTableBody = document.querySelector('#scannerTableSell tbody');

function renderAlerts(alerts) {
    // Clear existing rows
    buyTableBody.innerHTML = '';
    sellTableBody.innerHTML = '';

    alerts.forEach(alert => {
        const row = document.createElement('tr');

        row.innerHTML = `
            <td>${alert.Time}</td>
            <td>${alert.Ticker}</td>
            <td>${alert.PivotRel || ''}</td>
            <td>${alert.Trend || ''}</td>
            <td>${alert.AI5m || ''}</td>
            <td>${alert.AI15m || ''}</td>
            <td>${alert.AI1h || ''}</td>
            <td>${alert.Price || ''}</td>
            <td>${alert.DayMid || ''}</td>
            <td>${alert.WeeklyMid || ''}</td>
            <td>${alert.MA20 || ''}</td>
            <td>${alert.NCPR || ''}</td>
            <td>${alert.Pivot || ''}</td>
        `;

        // Put in Buy or Sell table
        if (alert.Alert.toLowerCase() === 'buy') {
            buyTableBody.appendChild(row);
        } else {
            sellTableBody.appendChild(row);
        }
    });
}

// Listen for updates from server
socket.on('alertsUpdate', (alerts) => {
    renderAlerts(alerts);
});

// Optional: load existing alerts on page load
fetch('/data/alerts.json')
    .then(res => res.json())
    .then(alerts => renderAlerts(alerts))
    .catch(err => console.error('Error loading alerts.json:', err));
