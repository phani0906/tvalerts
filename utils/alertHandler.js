const fs = require('fs');
const path = require('path');

// Path to alerts.json in data folder
const alertsFilePath = path.join(__dirname, '..', 'data', 'alerts.json');

function initAlertHandler(app, io) {
    // POST endpoint to receive alerts
    app.post('/sendAlert', (req, res) => {
        const alert = req.body;

        // Validate alert
        if (!alert || !alert.Ticker || !alert.Timeframe || !alert.Alert || !alert.Time) {
            return res.status(400).send({ error: 'Invalid alert format' });
        }

        // Log received alert
        console.log('Received alert:', alert);

        // Read existing alerts from file
        let alerts = [];
        try {
            if (fs.existsSync(alertsFilePath)) {
                const data = fs.readFileSync(alertsFilePath, 'utf8').trim();
                if (data) {
                    alerts = JSON.parse(data);
                }
            }
        } catch (err) {
            console.error('Error reading alerts.json, initializing empty array:', err);
            alerts = [];
        }

        // Add new alert
        alerts.push(alert);

        // Write back to file
        try {
            fs.writeFileSync(alertsFilePath, JSON.stringify(alerts, null, 2));
        } catch (err) {
            console.error('Error writing to alerts.json:', err);
        }

        // Emit alert to clients via Socket.IO
        io.emit('newAlert', [alert]);

        res.status(200).send({ success: true });
    });
}

module.exports = { initAlertHandler };
