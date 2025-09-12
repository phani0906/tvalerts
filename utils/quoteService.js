// utils/quoteService.js
// Hourly-cached quotes from an external API (default: Quotable).
// Uses Node's global fetch (Node 18+). If you run older Node, install undici and import it.

const DEFAULT_API = process.env.QUOTES_API_URL || 'https://api.quotable.io/random';
const DEFAULT_TAGS = process.env.QUOTES_TAGS || 'inspirational|wisdom|success|happiness|health|money|perseverance|discipline';
const TTL_MS = Number(process.env.QUOTES_TTL_MS || 3600_000); // 1 hour

let _cache = { ts: 0, quote: null };

async function fetchQuoteFromAPI() {
  // Example uses Quotable (free, no key). Docs: https://github.com/lukePeavey/quotable
  // We filter by tags to keep it relevant to stocks/money/health/consistency themes.
  const url = new URL(DEFAULT_API);
  // Quotable supports comma-separated or | for OR; we’ll pass as comma.
  url.searchParams.set('tags', DEFAULT_TAGS.replace(/\|/g, ','));
  url.searchParams.set('maxLength', '160');

  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Quote API HTTP ${res.status}`);
  const j = await res.json();

  // Normalize shape { text, author, source }
  let text = '';
  let author = '';
  if (j && typeof j === 'object') {
    if (j.content && j.author) {
      text = j.content;
      author = j.author;
    } else if (Array.isArray(j) && j[0] && (j[0].q || j[0].quote)) { // zenquotes style fallback
      text = j[0].q || j[0].quote;
      author = j[0].a || j[0].author || '';
    }
  }
  if (!text) throw new Error('Quote API returned empty');

  return { text, author, source: url.origin };
}

async function getQuoteCached() {
  const now = Date.now();
  if (_cache.quote && (now - _cache.ts) < TTL_MS) return _cache.quote;

  try {
    const q = await fetchQuoteFromAPI();
    _cache = { ts: now, quote: q };
    return q;
  } catch (e) {
    // Graceful fallback if API is down
    const fallback = {
      text: 'Consistency compounds; small edges, repeated, become big wins.',
      author: 'Unknown',
      source: 'local-fallback'
    };
    _cache = { ts: now, quote: fallback };
    return fallback;
  }
}

module.exports = { getQuoteCached };
