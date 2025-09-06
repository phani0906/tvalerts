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

// Helper: get current time in HH:MM format
function getCurrentTime() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Main initializer
function initAlertHandler(app, io) {
    // Keep connected clients in sync
    io.on('connection', (socket) => {
        console.log('Client connected');

        const alerts = Object.values(readAlerts())
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // descending
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
                timestamp: '' // only one timestamp per ticker
            };
        }

        // Update relevant column
        alertsData[Ticker][Timeframe] = Alert;

        // Update timestamp if not present
        if (!alertsData[Ticker].timestamp || Timeframe === 'AI_5m' || Timeframe === 'AI_15m' || Timeframe === 'AI_1h') {
            alertsData[Ticker].timestamp = getCurrentTime();
        }

        // Save to alerts.json
        writeAlerts(alertsData);

        // Emit sorted alerts to all clients
        const sortedAlerts = Object.values(alertsData)
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // descending
        io.emit('newAlert', sortedAlerts);

        res.sendStatus(200);
    });
}

module.exports = { initAlertHandler };
