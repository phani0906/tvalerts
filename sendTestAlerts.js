// sendTestAlerts.js
const axios = require('axios');

// Switch between local and hosted app easily:
const LOCAL_URL   = 'http://localhost:2709/sendAlert';
const RENDER_URL  = 'https://tvscanner.onrender.com/tv-webhook?key=test';

// Choose your endpoint here:
const ENDPOINT = process.env.USE_WEBHOOK === '1' ? RENDER_URL : LOCAL_URL;

const tickers = ['AMD','NVDA','AMAT','ANET','PLTR','HOOD','AFRM','MRVL','HIMS','MP','MU','FIVE'];
const timeframes = ['AI_5m','AI_15m','AI_1h'];
const alerts = ['Buy','Sell'];

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function buildPayload() {
  return {
    Ticker: pick(tickers),
    Timeframe: pick(timeframes),
    Alert: pick(alerts),
    Time: new Date().toISOString()   // use ISO, your UI formats to CST
  };
}

async function sendOnce() {
  const payload = buildPayload();
  try {
    await axios.post(ENDPOINT, payload, { headers: { 'Content-Type': 'application/json' } });
    console.log('OK ->', ENDPOINT, payload);
  } catch (err) {
    console.error('Error sending alert:', err.response?.data || err.message);
  }
}

// 🔁 Always fire every 5 seconds
console.log(`Sending alerts every 5s to ${ENDPOINT}...`);
setInterval(sendOnce, 5000);

// USE_WEBHOOK=1 node sendTestAlerts.js
