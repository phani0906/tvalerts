const fs = require('fs').promises;
const path = require('path');

const alertsFilePath = path.join(__dirname, '..', 'data', 'alerts.json');

function normTicker(t) {
  if (!t) return '';
  return String(t).toUpperCase().split(':').pop().trim(); // NASDAQ:AMD -> AMD
}
function normAlert(a) {
  const v = String(a || '').toLowerCase();
  return v === 'sell' ? 'Sell' : 'Buy'; // default Buy if unknown
}
async function readAlerts() {
  try {
    const raw = await fs.readFile(alertsFilePath, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('read alerts.json error:', e);
    return [];
  }
}
async function writeAlerts(arr) {
  try {
    await fs.writeFile(alertsFilePath, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('write alerts.json error:', e);
  }
}

function initAlertHandler(app, io) {
  app.post('/sendAlert', async (req, res) => {
    try {
      // Optional shared secret (uncomment if you want it)
      // if (process.env.TV_SECRET && req.query.key !== process.env.TV_SECRET) {
      //   return res.status(403).send({ error: 'Forbidden' });
      // }

      // Handle text/plain from TradingView
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

      // Normalize incoming fields
      const ticker     = normTicker(body.Ticker || body.ticker);
      const timeframe  = String(body.Timeframe || body.timeframe || '').trim();
      const alertText  = normAlert(body.Alert || body.alert);
      const timeStr    = String(body.Time || body.time || '').trim();

      // Only keep AI_5m alerts by design
      if (!ticker || timeframe !== 'AI_5m' || !alertText || !timeStr) {
        return res.status(400).send({ error: 'Invalid or non-5m alert' });
      }

      // Zone is AUTOMATIC from Buy/Sell
      const zone = (alertText === 'Buy') ? 'green' : 'red';

      const incoming = {
        Ticker: ticker,
        Time: timeStr,   // store whatever TV sends; UI just shows it
        AI_5m: alertText,
        Zone: zone
      };

      console.log('Received alert:', JSON.stringify(incoming));

      // Upsert one row per ticker
      let alerts = await readAlerts();
      const idx = alerts.findIndex(r => r.Ticker === ticker);

      if (idx !== -1) {
        // update row
        alerts[idx].AI_5m = incoming.AI_5m;
        alerts[idx].Time  = incoming.Time;
        alerts[idx].Zone  = incoming.Zone;
      } else {
        // add new to the top
        alerts.unshift(incoming);
      }

      // Persist and broadcast
      await writeAlerts(alerts);
      io.emit('alertsUpdate', alerts);

      res.json({ success: true });
    } catch (e) {
      console.error('sendAlert error:', e);
      res.status(500).send({ error: 'Internal error' });
    }
  });
}

module.exports = { initAlertHandler };
