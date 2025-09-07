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

        let existingIndex = alerts.findIndex(a => a.Ticker === alert.Ticker);

        if (existingIndex !== -1) {
            // Update existing entry
            const existing = alerts[existingIndex];

            // Update the relevant timeframe column
            if (alert.Timeframe === 'AI_5m') {
                existing.AI_5m = alert.Alert;

                // If AI_5m alert arrives, zone is **determined by AI_5m** now
                existing.Zone = alert.Alert === 'Buy' ? 'green' : 'red';
            } else if (alert.Timeframe === 'AI_15m') {
                existing.AI_15m = alert.Alert;
            } else if (alert.Timeframe === 'AI_1h') {
                existing.AI_1h = alert.Alert;
            }

            // Time remains first alert time
        } else {
            // New entry
            const newEntry = {
                Ticker: alert.Ticker,
                Time: alert.Time,
                AI_5m: alert.Timeframe === 'AI_5m' ? alert.Alert : '',
                AI_15m: alert.Timeframe === 'AI_15m' ? alert.Alert : '',
                AI_1h: alert.Timeframe === 'AI_1h' ? alert.Alert : '',
                // Zone depends on first alert
                Zone: alert.Alert === 'Buy' ? 'green' : 'red'
            };

            alerts.push(newEntry);
        }

        // Save back
        try {
            fs.writeFileSync(alertsFilePath, JSON.stringify(alerts, null, 2));
        } catch (err) {
            console.error('Error writing alerts.json:', err);
        }

        io.emit('alertsUpdate', alerts);

        res.status(200).send({ success: true });
    });
}

module.exports = { initAlertHandler };
