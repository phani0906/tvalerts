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

        // Update or add alert for 5m only
        if (alert.Timeframe === 'AI_5m') {
            const index = alerts.findIndex(a => a.Ticker === alert.Ticker && a.Timeframe === 'AI_5m');
            if (index !== -1) {
                // Update existing alert
                alerts[index] = alert;
            } else {
                // Add new alert
                alerts.push(alert);
            }
        }

        // Write back
        try {
            fs.writeFileSync(alertsFilePath, JSON.stringify(alerts, null, 2));
        } catch (err) {
            console.error('Error writing alerts.json:', err);
        }

        // Emit only 5m alerts to clients
        io.emit('alertsUpdate', alerts.filter(a => a.Timeframe === 'AI_5m'));

        res.status(200).send({ success: true });
    });
}

module.exports = { initAlertHandler };
