const socket = io();

const buyTableBody = document.querySelector('#scannerTableBuy tbody');
const sellTableBody = document.querySelector('#scannerTableSell tbody');

function renderTables(alerts) {
    buyTableBody.innerHTML = '';
    sellTableBody.innerHTML = '';

    alerts.forEach(alert => {
        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td>${alert.Time}</td>
            <td>${alert.Ticker}</td>
            <td></td>
            <td></td>
            <td class="${alert.AI_5m === 'Buy' ? 'green' : alert.AI_5m === 'Sell' ? 'red' : ''}">${alert.AI_5m}</td>
            <td class="${alert.AI_15m === 'Buy' ? 'green' : alert.AI_15m === 'Sell' ? 'red' : ''}">${alert.AI_15m}</td>
            <td class="${alert.AI_1h === 'Buy' ? 'green' : alert.AI_1h === 'Sell' ? 'red' : ''}">${alert.AI_1h}</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
        `;

        // Append to green/red zone based on first alert
        if (alert.Zone === 'green') {
            buyTableBody.appendChild(tr);
        } else {
            sellTableBody.appendChild(tr);
        }
    });
}

// Listen for alerts from server
socket.on('alertsUpdate', alerts => {
    renderTables(alerts);
});
