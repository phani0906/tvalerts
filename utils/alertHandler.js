const fs = require('fs');
const path = require('path');

const alertsFilePath = path.join(__dirname, '..', 'data', 'alerts.json');

function initAlertHandler(app, io) {
    app.post('/sendAlert', (req, res) => {
        const alert = req.body;
        if (!alert || !alert.Ticker || !alert.Timeframe || !alert.Alert || !alert.Time) {
            return res.status(400).send({ error: 'Invalid alert format' });
        }

        console.log('Received alert:', alert);

        // Read existing alerts
        let alerts = [];
        try {
            if (fs.existsSync(alertsFilePath)) {
                const data = fs.readFileSync(alertsFilePath, 'utf8').trim();
                if (data) alerts = JSON.parse(data);
            }
        } catch (err) {
            console.error('Error reading alerts.json, initializing empty array:', err);
            alerts = [];
        }

        const tickerIndex = alerts.findIndex(a => a.Ticker === alert.Ticker);

        if (tickerIndex !== -1) {
            // Row exists
            const row = alerts[tickerIndex];

            // Update the correct column
            if (alert.Timeframe === 'AI_5m') {
                row.AI_5m = alert.Alert;
                row.Time = alert.Time; // Update time on 5m
                // Decide zone
                row.Zone = alert.Alert === 'Buy' ? 'green' : 'red';
            } else if (alert.Timeframe === 'AI_15m') {
                row.AI_15m = alert.Alert;
                if (!row.AI_5m) row.Zone = row.Zone || (alert.Alert === 'Buy' ? 'green' : 'red');
            } else if (alert.Timeframe === 'AI_1h') {
                row.AI_1h = alert.Alert;
                if (!row.AI_5m) row.Zone = row.Zone || (alert.Alert === 'Buy' ? 'green' : 'red');
            }
        } else {
            // Row does not exist
            const newRow = {
                Ticker: alert.Ticker,
                Time: alert.Timeframe === 'AI_5m' ? alert.Time : '', // Only update time for 5m
                AI_5m: alert.Timeframe === 'AI_5m' ? alert.Alert : '',
                AI_15m: alert.Timeframe === 'AI_15m' ? alert.Alert : '',
                AI_1h: alert.Timeframe === 'AI_1h' ? alert.Alert : '',
                Zone: alert.Alert === 'Buy' ? 'green' : 'red'
            };
            alerts.push(newRow);
        }

        // Save alerts
        try {
            fs.writeFileSync(alertsFilePath, JSON.stringify(alerts, null, 2));
        } catch (err) {
            console.error('Error writing alerts.json:', err);
        }

        // Emit updated alerts to clients
        io.emit('alertsUpdate', alerts);

        res.status(200).send({ success: true });
    });
}

module.exports = { initAlertHandler };
