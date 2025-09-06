const axios = require('axios');

const tickers = ['AMD','NVDA','AMAT','ANET','PLTR','HOOD','AFRM','MRVL','HIMS','MP','MU','FIVE'];
const timeframes = ['AI_5m','AI_15m','AI_1h'];

function getRandomAlert() {
    return Math.random() > 0.5 ? 'Buy' : 'Sell';
}

function fireRandomAlert() {
    const ticker = tickers[Math.floor(Math.random() * tickers.length)];
    const timeframe = timeframes[Math.floor(Math.random() * timeframes.length)];
    const alert = getRandomAlert();

    const payload = { Ticker: ticker, Timeframe: timeframe, Alert: alert };

    axios.post('http://localhost:786/newAlert', payload)
        .then(() => console.log('Fired alert:', payload))
        .catch(err => console.log('Error sending alert:', err.message));
}

// Fire an alert every 5 seconds
setInterval(fireRandomAlert, 5000);

console.log('sendTestAlerts running...');
