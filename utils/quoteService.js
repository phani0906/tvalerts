// utils/quoteService.js
const https = require('https');

// How long to cache one quote (default 10 minutes)
const QUOTE_TTL_MS = Number(process.env.QUOTE_TTL_MS || 10 * 60 * 1000);

let cache = { at: 0, data: null };

function fetchQuote() {
  // You can keep your existing source; this is just a simple example hitting ZenQuotes.
  // If you already have a source, keep it and just keep the TTL logic.
  const url = 'https://zenquotes.io/api/random';
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const q = Array.isArray(json) && json[0] ? json[0] : {};
          resolve({
            text: q.q || 'Consistency compounds; small edges, repeated, become big wins.',
            author: q.a || 'Unknown'
          });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function getQuoteCached({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.data && now - cache.at < QUOTE_TTL_MS) {
    return cache.data;
  }
  const fresh = await fetchQuote();
  cache = { at: now, data: fresh };
  return fresh;
}

module.exports = { getQuoteCached };
