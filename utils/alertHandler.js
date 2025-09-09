const fs = require('fs').promises;
const path = require('path');

const alertsFilePath = path.join(__dirname, '..', 'data', 'alerts.json');

function initAlertHandler(app, io) {
    app.post('/sendAlert', async (req, res) => {
        const alert = req.body;
        if (!alert || !alert.Ticker || !alert.Timeframe || !alert.Alert || !alert.Time) {
            return res.status(400).send({ error: 'Invalid alert format' });
        }

        console.log('Received alert:', alert);

        let alerts = [];

        // Read existing alerts
        try {
            const data = await fs.readFile(alertsFilePath, 'utf8');
            if (data) alerts = JSON.parse(data);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error('Error reading alerts.json:', err);
            } else {
                console.log('alerts.json not found, initializing empty array.');
            }
            alerts = [];
        }

        const tickerIndex = alerts.findIndex(a => a.Ticker === alert.Ticker);

        const zone = alert.Alert === 'Buy' ? 'green' : 'red';

        if (tickerIndex !== -1) {
            const row = alerts[tickerIndex];

            // Update the correct column
            if (alert.Timeframe === 'AI_5m') {
                row.AI_5m = alert.Alert;
                row.Time = alert.Time;
                row.Zone = zone;
            } else if (alert.Timeframe === 'AI_15m') {
                row.AI_15m = alert.Alert;
                if (!row.AI_5m) row.Zone = row.Zone || zone;
            } else if (alert.Timeframe === 'AI_1h') {
                row.AI_1h = alert.Alert;
                if (!row.AI_5m) row.Zone = row.Zone || zone;
            }
        } else {
            // Row does not exist
            const newRow = {
                Ticker: alert.Ticker,
                Time: alert.Timeframe === 'AI_5m' ? alert.Time : '',
                AI_5m: alert.Timeframe === 'AI_5m' ? alert.Alert : '',
                AI_15m: alert.Timeframe === 'AI_15m' ? alert.Alert : '',
                AI_1h: alert.Timeframe === 'AI_1h' ? alert.Alert : '',
                Zone: zone
            };
            alerts.push(newRow);
        }

        // Save alerts async
        try {
            await fs.writeFile(alertsFilePath, JSON.stringify(alerts, null, 2));
        } catch (err) {
            console.error('Error writing alerts.json:', err);
        }

        // Emit updated alerts
        io.emit('alertsUpdate', alerts);

        res.status(200).send({ success: true });
    });
}

module.exports = { initAlertHandler };
