const fs = require('fs');
const path = require('path');

const ALERTS_FILE = path.join(__dirname, '..', 'data', 'alerts.json');

// Utility: read alerts.json safely
function readAlerts() {
    try {
        if (!fs.existsSync(ALERTS_FILE)) return {};
        const data = fs.readFileSync(ALERTS_FILE, 'utf-8');
        if (!data) return {};
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading alerts file:', err);
        return {};
    }
}

// Utility: write alerts.json
function writeAlerts(alerts) {
    try {
        fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2), 'utf-8');
    } catch (err) {
        console.error('Error writing alerts file:', err);
    }
}

// Main initializer
function initAlertHandler(app, io) {
    // Keep connected clients in sync
    io.on('connection', (socket) => {
        console.log('Client connected');

        // Send current alerts on connect
        const alerts = Object.values(readAlerts());
        socket.emit('newAlert', alerts);

        socket.on('disconnect', () => console.log('Client disconnected'));
    });

    // Webhook endpoint to receive new alerts
    app.post('/newAlert', (req, res) => {
        const { Ticker, Timeframe, Alert } = req.body;
        if (!Ticker || !Timeframe || !Alert) {
            return res.status(400).send('Invalid payload');
        }

        let alertsData = readAlerts();

        // If ticker already exists, replace previous alert
        if (!alertsData[Ticker]) {
            alertsData[Ticker] = {
                Ticker,
                AI_5m: '',
                AI_15m: '',
                AI_1h: '',
                timestamp: '' // only for 5m
            };
        }

        // Update relevant column
        alertsData[Ticker][Timeframe] = Alert;

        // Update timestamp only for 5m alerts
        if (Timeframe === 'AI_5m') {
            const now = new Date();
            const timestamp =
                now.getHours().toString().padStart(2, '0') + ':' +
                now.getMinutes().toString().padStart(2, '0');
            alertsData[Ticker].timestamp = timestamp;
        }

        // Save to alerts.json
        writeAlerts(alertsData);

        // Emit to all clients
        io.emit('newAlert', Object.values(alertsData));

        res.sendStatus(200);
    });
}

module.exports = { initAlertHandler };
