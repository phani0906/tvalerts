const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server); // ✅ this serves the client automatically

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'scanner.html'));
});

io.on('connection', (socket) => {
    console.log('Client connected');
    socket.emit('newAlert', []); // send initial empty alerts
    socket.on('disconnect', () => console.log('Client disconnected'));
});

server.listen(786, () => console.log('Server running on http://localhost:786'));
