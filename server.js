const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { initAlertHandler } = require('./utils/alertHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server); // Socket.IO server

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize alert handler and pass Socket.IO instance
initAlertHandler(app, io);

// Serve scanner.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'scanner.html'));
});

server.listen(786, () => console.log('Server running on http://localhost:786'));
