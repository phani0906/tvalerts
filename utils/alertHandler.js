const fs = require('fs');
const path = require('path');

const alertsFile = path.join(__dirname, '../data/alerts.json');

let alertsData = {};

// Load existing alerts
try {
    if (fs.existsSync(alertsFile)) {
        const fileData = fs.readFileSync(alertsFile, 'utf-8');
        alertsData = fileData ? JSON.parse(fileData) : {};
    }
} catch (err) {
    console.error("Error reading alerts file:", err.message);
    alertsData = {};
}

// Save alerts
function saveAlertsToFile() {
    fs.writeFileSync(alertsFile, JSON.stringify(alertsData, null, 2));
}

// Initialize with socket.io
function initAlertHandler(io) {

    function emitAlerts() {
        // Map data to all expected keys
        const payload = Object.values(alertsData).map(a => ({
            timestamp: a.timestamp || null,
            Ticker: a.Ticker || 'No value',
            Rel: a.Rel || 'No value',
            Trend: a.Trend || 'No value',
            AI5: a.AI_5m || 'No value',
            AI15: a.AI_15m || 'No value',
            AI1H: a.AI_1h || 'No value',
            Price: a.Price || 'No value',
            DayMid: a.DayMid || 'No value',
            WeeklyMid: a.WeeklyMid || 'No value',
            MA20: a.MA20 || 'No value',
            NCPR: a.NCPR || 'No value',
            Pivot: a.Pivot || 'No value'
        }));
        io.emit('newAlert', payload);
    }

    function handleNewAlert({ Ticker, Timeframe, Alert }) {
        if (!Ticker || !Timeframe || !Alert) return;

        // Initialize if not exists
        if (!alertsData[Ticker]) {
            alertsData[Ticker] = {
                Ticker,
                AI_5m: '',
                AI_15m: '',
                AI_1h: '',
                timestamp: '',
                Rel: '',
                Trend: '',
                Price: '',
                DayMid: '',
                WeeklyMid: '',
                MA20: '',
                NCPR: '',
                Pivot: ''
            };
        }

        // Update the relevant column
        alertsData[Ticker][Timeframe] = Alert;

        // Update timestamp only for 5m alerts
        if (Timeframe === 'AI_5m') {
            const now = new Date();
            const timestamp = now.getHours().toString().padStart(2, '0') + ':' +
                              now.getMinutes().toString().padStart(2,'0');
            alertsData[Ticker].timestamp = timestamp;
        }

        saveAlertsToFile();
        emitAlerts();
    }

    // Emit current alerts on client connect
    io.on('connection', socket => {
        console.log('Client connected');
        emitAlerts();

        socket.on('disconnect', () => console.log('Client disconnected'));
    });

    return { handleNewAlert };
}

module.exports = { initAlertHandler };
