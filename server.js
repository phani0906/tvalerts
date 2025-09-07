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

// Root endpoint showing link to scanner.html with background image
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>TV Alerts Home</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    font-family: Arial, sans-serif;
                    background-image: url('/images/background.jpg'); /* local image */
                    background-size: cover;
                    background-position: center;
                    color: white;
                    text-shadow: 2px 2px 4px #000;
                }
                a {
                    padding: 20px 40px;
                    background-color: rgba(0,0,0,0.5);
                    color: #fff;
                    text-decoration: none;
                    font-size: 24px;
                    border-radius: 8px;
                    transition: background 0.3s;
                }
                a:hover {
                    background-color: rgba(0,0,0,0.8);
                }
            </style>
        </head>
        <body>
            <a href="/scanner.html">Go to Scanner</a>
        </body>
        </html>
    `);
});

const PORT = 2709;
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
