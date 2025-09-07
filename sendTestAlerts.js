// sendTestAlerts.js
const axios = require('axios');

const tickers = ['AMD', 'NVDA', 'AMAT', 'ANET', 'PLTR', 'HOOD', 'AFRM', 'MRVL', 'HIMS', 'MP', 'MU', 'FIVE'];
const timeframes = ['AI_5m', 'AI_15m', 'AI_1h'];
const alerts = ['Buy', 'Sell'];

function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

async function sendRandomAlert() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');

    const newAlert = {
        Ticker: getRandomItem(tickers),
        Timeframe: getRandomItem(timeframes),
        Alert: getRandomItem(alerts),
        Time: `${hours}:${minutes}`
    };

    try {
        await axios.post('http://localhost:786/sendAlert', newAlert);
        console.log(newAlert); // only show the alert object
    } catch (err) {
        console.error('Error sending alert:', err.message);
    }
}

// Send one alert every 5 seconds
setInterval(sendRandomAlert, 5000);

console.log('sendTestAlerts running...');
