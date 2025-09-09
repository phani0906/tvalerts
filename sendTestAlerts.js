// sendTestAlerts.js
const axios = require('axios');

/**
 * ----------------- CONFIG -----------------
 * Defaults to your Render URL but can be overridden via env or CLI.
 * Env vars:
 *  - ALERT_URL: full endpoint, e.g.
 *      https://tvscanner.onrender.com/sendAlert
 *      https://tvscanner.onrender.com/tv-webhook?key=YOUR_SECRET
 *  - INTERVAL_MS: ms between sends (default 5000)
 *  - ONE_SHOT=1: send one alert then exit
 *  - COUNT: send N alerts then exit
 *  - VERBOSE=1: log extra info
 */

const DEFAULT_URL = 'https://tvscanner.onrender.com/sendAlert';

// -------- CLI parsing --------
const argv = process.argv.slice(2);
function getFlag(name, def = undefined) {
  const ix = argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (ix === -1) return def;
  const a = argv[ix];
  const eq = a.indexOf('=');
  if (eq !== -1) return a.slice(eq + 1);
  return argv[ix + 1] && !argv[ix + 1].startsWith('--') ? argv[ix + 1] : true;
}

// URL / pacing
const ENDPOINT = process.env.ALERT_URL || getFlag('url', DEFAULT_URL);
const INTERVAL_MS = Number(process.env.INTERVAL_MS || getFlag('interval', 5000));
const ONE_SHOT = process.env.ONE_SHOT === '1' || getFlag('one', false) === true;
const COUNT = Number(process.env.COUNT || getFlag('count', 0)); // 0 = infinite
const VERBOSE = process.env.VERBOSE === '1' || getFlag('verbose', false) === true;

// Forced payload fields (optional)
const FORCE_TICKER = getFlag('ticker', null);
const FORCE_TF = getFlag('timeframe', null);
const FORCE_ALERT = getFlag('alert', null);
const TIME_FORMAT = (getFlag('timefmt', 'hhmm') || 'hhmm').toLowerCase();
// timefmt: hhmm | iso | epoch

// Universe
const tickers = ['AMD','NVDA','AMAT','ANET','PLTR','HOOD','AFRM','MRVL','HIMS','MP','MU','FIVE'];
const timeframes = ['AI_5m','AI_15m','AI_1h'];
const alerts = ['Buy','Sell'];

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function nowHHMM() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
function nowISO() { return new Date().toISOString(); }
function nowEpoch() { return Date.now(); }

function buildTime() {
  if (TIME_FORMAT === 'iso') return nowISO();
  if (TIME_FORMAT === 'epoch') return nowEpoch();
  return nowHHMM(); // default
}

function buildPayload() {
  return {
    Ticker:    (FORCE_TICKER || pick(tickers)).toUpperCase(),
    Timeframe: FORCE_TF || pick(timeframes),
    Alert:     FORCE_ALERT || pick(alerts),
    Time:      buildTime()
  };
}

async function sendOnce(seq = 1) {
  const payload = buildPayload();

  try {
    const res = await axios.post(ENDPOINT, payload, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
    if (VERBOSE) {
      console.log(`[${new Date().toISOString()}] POST ${ENDPOINT} -> ${res.status}`);
    }
    console.log(payload); // only show the alert object
  } catch (err) {
    const status = err.response?.status;
    console.error(`Error sending alert${status ? ` (HTTP ${status})` : ''}:`, err.message);
  }
}

async function main() {
  console.log('sendTestAlerts running...');
  console.log(`→ Endpoint: ${ENDPOINT}`);
  console.log(`→ Interval: ${INTERVAL_MS} ms`);

  if (FORCE_TICKER || FORCE_TF || FORCE_ALERT) {
    console.log(`→ Forced: ticker=${FORCE_TICKER || 'random'}, timeframe=${FORCE_TF || 'random'}, alert=${FORCE_ALERT || 'random'}`);
  }

  let sent = 0;

  const sendAndMaybeExit = async () => {
    sent += 1;
    await sendOnce(sent);
    if (ONE_SHOT || (COUNT && sent >= COUNT)) {
      if (VERBOSE) console.log('Done. Exiting.');
      process.exit(0);
    }
  };

  await sendAndMaybeExit();
  if (!ONE_SHOT && (!COUNT || sent < COUNT)) {
    const timer = setInterval(sendAndMaybeExit, INTERVAL_MS);
    // graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nStopping...');
      clearInterval(timer);
      process.exit(0);
    });
  }
}

main();
