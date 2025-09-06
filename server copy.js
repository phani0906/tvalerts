const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // scanner.html and CSS

// Store latest alerts for display
let alertsData = {}; // { ticker: {Ticker, AI_5m, AI_15m, AI_1h, timestamp} }

app.post('/newAlert', (req, res) => {
    const { Ticker, Timeframe, Alert } = req.body;
    if (!Ticker || !Timeframe || !Alert) return res.status(400).send('Invalid payload');

    // Initialize ticker if not present
    if (!alertsData[Ticker]) {
        alertsData[Ticker] = {
            Ticker,
            AI_5m: '',
            AI_15m: '',
            AI_1h: '',
            timestamp: ''  // will hold time of last 5m alert
        };
    }

    // Update the relevant column
    alertsData[Ticker][Timeframe] = Alert;

    // Update time ONLY for AI_5m alerts
    if (Timeframe === 'AI_5m') {
        const now = new Date();
        const timestamp = now.getHours().toString().padStart(2,'0') + ':' +
                          now.getMinutes().toString().padStart(2,'0');
        alertsData[Ticker].timestamp = timestamp;
    }

    // Emit updated alerts to all clients
    io.emit('updateAlerts', Object.values(alertsData).sort((a,b) => {
        // sort by timestamp descending; empty timestamps go last
        const timeA = a.timestamp || '00:00';
        const timeB = b.timestamp || '00:00';
        return timeB.localeCompare(timeA);
    }));

    res.sendStatus(200);
});

// Serve scanner page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/scanner.html');
});

io.on('connection', (socket) => {
    console.log('Client connected');
    // Send current alerts on connect
    socket.emit('updateAlerts', Object.values(alertsData).sort((a,b) => {
        const timeA = a.timestamp || '00:00';
        const timeB = b.timestamp || '00:00';
        return timeB.localeCompare(timeA);
    }));

    socket.on('disconnect', () => console.log('Client disconnected'));
});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
