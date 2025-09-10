// sendTestAlerts.js
const axios = require('axios');

/**
 * ----------------- CONFIG -----------------
 * You can now provide MULTIPLE endpoints.
 * Options (priority order):
 *  1) multiple --url flags:
 *       --url http://localhost:2709/sendAlert --url https://tvscanner.onrender.com/sendAlert
 *  2) ALERT_URLS env (comma-separated):
 *       ALERT_URLS="http://localhost:2709/sendAlert,https://tvscanner.onrender.com/sendAlert"
 *  3) single ALERT_URL env or single --url flag
 *
 * Other env/flags:
 *  - INTERVAL_MS / --interval  (default 5000)
 *  - ONE_SHOT=1 or --one
 *  - COUNT / --count (send N alerts total)
 *  - VERBOSE=1 or --verbose
 *  - --ticker AMD  --timeframe AI_5m  --alert Buy
 *  - --timefmt hhmm|iso|epoch
 */

const DEFAULT_URL = 'https://tvscanner.onrender.com/sendAlert';

// -------- CLI parsing helpers --------
const argv = process.argv.slice(2);
const getFlag = (name, def = undefined) => {
  // supports --name value OR --name=value OR --name (boolean true)
  const hits = argv.filter(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hits.length === 0) {
    const ix = argv.findIndex(a => a === `--${name}`);
    if (ix !== -1) {
      return argv[ix + 1] && !argv[ix + 1].startsWith('--') ? argv[ix + 1] : true;
    }
    return def;
  }
  const a = hits[0];
  const eq = a.indexOf('=');
  if (eq !== -1) return a.slice(eq + 1);
  const ix = argv.indexOf(a);
  return argv[ix + 1] && !argv[ix + 1].startsWith('--') ? argv[ix + 1] : true;
};

const getAllFlags = (name) => {
  // collect multiple --url flags
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) {
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      if (val !== true) out.push(val);
    } else if (a.startsWith(`--${name}=`)) {
      out.push(a.split('=').slice(1).join('=')); // keep any '=' in value
    }
  }
  return out;
};

// -------- Endpoints resolution --------
function resolveEndpoints() {
  // 1) many --url flags
  const multi = getAllFlags('url');
  if (multi.length > 0) return multi;

  // 2) ALERT_URLS comma-separated
  if (process.env.ALERT_URLS) {
    return process.env.ALERT_URLS
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  // 3) single ALERT_URL or single --url, else default
  const single = process.env.ALERT_URL || getFlag('url', DEFAULT_URL);
  return [single].filter(Boolean);
}

const ENDPOINTS = resolveEndpoints();
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

async function postToEndpoint(url, payload) {
  try {
    const res = await axios.post(url, payload, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
    if (VERBOSE) console.log(`[${new Date().toISOString()}] POST ${url} -> ${res.status}`);
  } catch (err) {
    const status = err.response?.status;
    console.error(`Error to ${url}${status ? ` (HTTP ${status})` : ''}: ${err.message}`);
  }
}

async function sendOnce(seq = 1) {
  const payload = buildPayload();
  // Mirror to ALL endpoints
  await Promise.all(ENDPOINTS.map(u => postToEndpoint(u, payload)));
  console.log(payload); // print the alert object once
}

async function main() {
  console.log('sendTestAlerts running...');
  console.log(`→ Endpoints:`);
  ENDPOINTS.forEach(u => console.log(`   - ${u}`));
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
    process.on('SIGINT', () => {
      console.log('\nStopping...');
      clearInterval(timer);
      process.exit(0);
    });
  }
}

main();
