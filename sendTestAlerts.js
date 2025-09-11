// sendTestAlerts.js
const axios = require('axios');

const ENDPOINT = process.env.ALERT_URL || 'http://localhost:2709/sendAlert';
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 5000);
const ONE_SHOT = process.env.ONE_SHOT === '1';
const VERBOSE = process.env.VERBOSE === '1';

const tickers = ['AMD','NVDA','AMAT','ANET','PLTR','HOOD','AFRM','MRVL','HIMS','MP','MU','FIVE'];
const timeframes = ['AI_5m','AI_15m','AI_1h'];
const alerts = ['Buy','Sell'];

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function hhmm(){ const n=new Date(); return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`; }

function buildPayload() {
  return { Ticker: pick(tickers), Timeframe: pick(timeframes), Alert: pick(alerts), Time: hhmm() };
}

async function sendOnce() {
  const payload = buildPayload();
  try {
    await axios.post(ENDPOINT, payload, { timeout: 8000 });
    if (VERBOSE) console.log('POST', ENDPOINT);
    console.log(payload);
  } catch (err) {
    console.error('Error sending alert:', err.message);
  }
}

(async function main() {
  if (ONE_SHOT) { await sendOnce(); process.exit(0); }
  console.log('sendTestAlerts running...');
  await sendOnce();
  setInterval(sendOnce, INTERVAL_MS);
})();
