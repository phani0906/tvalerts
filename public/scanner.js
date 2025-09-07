const socket = io();
const buyTable = document.querySelector('#scannerTableBuy tbody');
const sellTable = document.querySelector('#scannerTableSell tbody');

// Helper to create or update row in table
function upsertRow(alert) {
    // Determine which table the alert should be in
    const targetTable = alert.Alert.toLowerCase() === 'buy' ? buyTable : sellTable;
    const oppositeTable = alert.Alert.toLowerCase() === 'buy' ? sellTable : buyTable;

    // Try to find existing row in either table
    let row = targetTable.querySelector(`tr[data-ticker="${alert.Ticker}"]`);
    let oppositeRow = oppositeTable.querySelector(`tr[data-ticker="${alert.Ticker}"]`);

    // If row exists in opposite table, remove it
    if (oppositeRow) oppositeRow.remove();

    // If row exists in target table, update it
    if (row) {
        updateRowValues(row, alert);
    } else {
        // Create new row
        row = document.createElement('tr');
        row.setAttribute('data-ticker', alert.Ticker);
        row.innerHTML = `
            <td>${alert.Time || ''}</td>
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
        targetTable.appendChild(row);
    }
}

// Helper to update row values without changing order/time unless AI5m
function updateRowValues(row, alert) {
    const cells = row.children;

    // Time is updated only if AI5m alert
    if (alert.Time) cells[0].textContent = alert.Time;

    cells[4].textContent = alert.AI5m || cells[4].textContent;
    cells[5].textContent = alert.AI15m || cells[5].textContent;
    cells[6].textContent = alert.AI1h || cells[6].textContent;

    cells[2].textContent = alert.PivotRel || cells[2].textContent;
    cells[3].textContent = alert.Trend || cells[3].textContent;
    cells[7].textContent = alert.Price || cells[7].textContent;
    cells[8].textContent = alert.DayMid || cells[8].textContent;
    cells[9].textContent = alert.WeeklyMid || cells[9].textContent;
    cells[10].textContent = alert.MA20 || cells[10].textContent;
    cells[11].textContent = alert.NCPR || cells[11].textContent;
    cells[12].textContent = alert.Pivot || cells[12].textContent;
}

// Clear tables and redraw from alerts array
function refreshTables(alerts) {
    // Clear tables
    buyTable.innerHTML = '';
    sellTable.innerHTML = '';

    // Sort alerts by Time descending (AI5m time)
    alerts.sort((a, b) => (b.Time || '').localeCompare(a.Time || ''));

    // Upsert rows
    alerts.forEach(alert => {
        // Only add rows if AI5m exists or AI15m/1h exists with AI5m row
        if (alert.AI5m || alert.AI15m || alert.AI1h) {
            // Determine main alert for table selection
            const mainAlert = alert.AI5m || alert.AI15m || alert.AI1h;
            upsertRow({ ...alert, Alert: mainAlert });
        }
    });
}

// Listen for alerts from server
socket.on('alertsUpdate', (alerts) => {
    refreshTables(alerts);
});
