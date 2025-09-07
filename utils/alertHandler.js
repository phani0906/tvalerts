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

        // Find existing entry for this Ticker
        let tickerIndex = alerts.findIndex(a => a.Ticker === alert.Ticker);

        if (alert.Timeframe === 'AI_5m') {
            // 5m alert overrides zone and updates time
            if (tickerIndex !== -1) {
                alerts[tickerIndex] = {
                    ...alerts[tickerIndex],
                    AI5m: alert.Alert,
                    Alert: alert.Alert, // main zone value for buy/sell
                    Time: alert.Time
                };
            } else {
                // Create new row
                const newRow = {
                    Ticker: alert.Ticker,
                    Timeframe: 'AI_5m',
                    Time: alert.Time,
                    PivotRel: '',
                    Trend: '',
                    AI5m: alert.Alert,
                    AI15m: '',
                    AI1h: '',
                    Price: '',
                    DayMid: '',
                    WeeklyMid: '',
                    MA20: '',
                    NCPR: '',
                    Pivot: '',
                    Alert: alert.Alert
                };
                alerts.push(newRow);
            }
        } else if (alert.Timeframe === 'AI_15m') {
            if (tickerIndex !== -1) {
                // Update only AI15m column, do not change Time
                alerts[tickerIndex].AI15m = alert.Alert;
            } else {
                // Create new row with AI15m, first signal determines zone
                const newRow = {
                    Ticker: alert.Ticker,
                    Timeframe: 'AI_15m',
                    Time: alert.Time,
                    PivotRel: '',
                    Trend: '',
                    AI5m: '',
                    AI15m: alert.Alert,
                    AI1h: '',
                    Price: '',
                    DayMid: '',
                    WeeklyMid: '',
                    MA20: '',
                    NCPR: '',
                    Pivot: '',
                    Alert: alert.Alert // initial zone based on first signal
                };
                alerts.push(newRow);
            }
        } else if (alert.Timeframe === 'AI_1h') {
            if (tickerIndex !== -1) {
                // Update only AI1h column, do not change Time
                alerts[tickerIndex].AI1h = alert.Alert;
            } else {
                // Create new row with AI1h, first signal determines zone
                const newRow = {
                    Ticker: alert.Ticker,
                    Timeframe: 'AI_1h',
                    Time: alert.Time,
                    PivotRel: '',
                    Trend: '',
                    AI5m: '',
                    AI15m: '',
                    AI1h: alert.Alert,
                    Price: '',
                    DayMid: '',
                    WeeklyMid: '',
                    MA20: '',
                    NCPR: '',
                    Pivot: '',
                    Alert: alert.Alert // initial zone based on first signal
                };
                alerts.push(newRow);
            }
        }

        // Sort alerts by Time descending
        alerts.sort((a, b) => {
            if (!a.Time || !b.Time) return 0;
            return b.Time.localeCompare(a.Time);
        });

        // Write back to alerts.json
        try {
            fs.writeFileSync(alertsFilePath, JSON.stringify(alerts, null, 2));
        } catch (err) {
            console.error('Error writing alerts.json:', err);
        }

        // Emit all alerts to client
        io.emit('alertsUpdate', alerts);

        res.status(200).send({ success: true });
    });
}

module.exports = { initAlertHandler };
