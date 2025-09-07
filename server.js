const express = require('express');
const http = require('http');
const { initAlertHandler } = require('./utils/alertHandler');
const { startMarketDataUpdater } = require('./utils/marketData');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize alert handler
initAlertHandler(app, io);

// Start live market data updates
startMarketDataUpdater(io);

const PORT = 786;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
