const fs = require('fs');
const path = require('path');

// Path to alerts.json in data folder
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

        if (alert.Timeframe === 'AI_5m') {
            // --- 5m alerts: create new or update existing ---
            const index = alerts.findIndex(a => a.Ticker === alert.Ticker);
            if (index !== -1) {
                // Update existing entry
                alerts[index].Time = alert.Time;
                alerts[index].Alert = alert.Alert;
                alerts[index].AI5m = alert.Alert;
            } else {
                // Add new entry
                alerts.push({
                    Ticker: alert.Ticker,
                    Time: alert.Time,
                    Alert: alert.Alert,
                    AI5m: alert.Alert,
                    AI15m: '',
                    AI1h: '',
                    PivotRel: '',
                    Trend: '',
                    Price: '',
                    DayMid: '',
                    WeeklyMid: '',
                    MA20: '',
                    NCPR: '',
                    Pivot: ''
                });
            }
        } else if (alert.Timeframe === 'AI_15m') {
            // --- 15m alerts: update only if entry exists ---
            const entry = alerts.find(a => a.Ticker === alert.Ticker);
            if (entry) {
                entry.AI15m = alert.Alert;
            } else {
                console.log(`15m alert ignored for ${alert.Ticker} (no existing entry)`);
            }
        } else if (alert.Timeframe === 'AI_1h') {
            // --- 1h alerts: update only if entry exists ---
            const entry = alerts.find(a => a.Ticker === alert.Ticker);
            if (entry) {
                entry.AI1h = alert.Alert;
            } else {
                console.log(`1h alert ignored for ${alert.Ticker} (no existing entry)`);
            }
        }

        // Sort latest first by Time
        alerts.sort((a, b) => (b.Time || '').localeCompare(a.Time || ''));

        // Write back
        try {
            fs.writeFileSync(alertsFilePath, JSON.stringify(alerts, null, 2));
        } catch (err) {
            console.error('Error writing alerts.json:', err);
        }

        // Emit all alerts to clients
        io.emit('alertsUpdate', alerts);

        res.status(200).send({ success: true });
    });
}

module.exports = { initAlertHandler };
