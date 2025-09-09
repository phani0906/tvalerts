// sendTestAlerts.js
const axios = require('axios');

// ----------------- CONFIG -----------------
const ENDPOINT = process.env.ALERT_URL || 'http://localhost:2709/sendAlert';
// e.g. ALERT_URL="https://fancy-ngrok.ngrok.io/tv-webhook?key=your_super_secret"
// or     ALERT_URL="http://localhost:2709/sendAlert"

const INTERVAL_MS = Number(process.env.INTERVAL_MS || 5000); // 5s default
const ONE_SHOT = process.env.ONE_SHOT === '1';                // send once & exit
const VERBOSE = process.env.VERBOSE === '1';

const tickers = ['AMD','NVDA','AMAT','ANET','PLTR','HOOD','AFRM','MRVL','HIMS','MP','MU','FIVE'];
const timeframes = ['AI_5m','AI_15m','AI_1h'];
const alerts = ['Buy','Sell'];

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function hhmm() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function buildPayload() {
  // Payload that your /sendAlert handler expects
  return {
    Ticker:    pick(tickers),
    Timeframe: pick(timeframes),
    Alert:     pick(alerts),
    Time:      hhmm(),   // your handler expects HH:MM
  };
}

async function sendOnce() {
  const payload = buildPayload();

  try {
    const res = await axios.post(ENDPOINT, payload, { timeout: 8000 });
    if (VERBOSE) console.log('POST', ENDPOINT);
    console.log(payload);        // print just the alert object
  } catch (err) {
    console.error('Error sending alert:', err.message);
  }
}

async function main() {
  if (ONE_SHOT) {
    await sendOnce();
    process.exit(0);
  }
  console.log('sendTestAlerts running...');
  await sendOnce();
  setInterval(sendOnce, INTERVAL_MS);

  // graceful shutdown
  process.on('SIGINT', () => { console.log('\nStopping...'); process.exit(0); });
}
main();
