// utils/quoteService.js
// Lightweight quote fetcher with caching + multi-API support.
// Works with Node 18+ (global fetch). If you're on older Node, install undici or node-fetch.

/*
  ENV knobs (all optional):
    QUOTES_API_URL   = https://api.themotivate365.com/stoic-quote
                       or https://api.quotable.io/random
                       or https://zenquotes.io/api/quotes
    QUOTES_TAGS      = stoicism|philosophy               (used for Quotable; pipe-separated)
    QUOTE_TTL_MS     = 3600000                           (cache time in ms; default 1 hour)
*/

const DEFAULTS = {
    URL: process.env.QUOTES_API_URL?.trim() || 'https://api.quotable.io/random',
    TAGS: process.env.QUOTES_TAGS || 'inspirational|wisdom|success',
    TTL: Math.max(1, Number(process.env.QUOTE_TTL_MS || 3600000)), // 1h default
  };
  
  // --- local cache ---
  let _cache = {
    text: 'The impediment to action advances action. What stands in the way becomes the way.',
    author: 'Marcus Aurelius',
    ts: Date.now(),
  };
  
  /** Normalize various APIs into { text, author } */
  function normalizeQuotePayload(url, payload) {
    // Quotable: { content, author }
    if (payload && typeof payload === 'object' && payload.content && payload.author) {
      return { text: String(payload.content), author: String(payload.author) };
    }
  
    // TheMotivate365 Stoic: { quote, author }
    if (payload && typeof payload === 'object' && payload.quote && payload.author) {
      return { text: String(payload.quote), author: String(payload.author) };
    }
  
    // ZenQuotes: Array of { q, a } or single { q, a }
    if (Array.isArray(payload) && payload.length > 0) {
      const first = payload[0];
      if (first && (first.q || first.quote)) {
        return { text: String(first.q || first.quote), author: String(first.a || first.author || '') };
      }
    }
    if (payload && typeof payload === 'object' && (payload.q || payload.quote)) {
      return { text: String(payload.q || payload.quote), author: String(payload.a || payload.author || '') };
    }
  
    // Fallback if the API gives a plain string
    if (typeof payload === 'string' && payload.trim()) {
      return { text: payload.trim(), author: '' };
    }
  
    // Unknown format -> null to trigger fallback
    return null;
  }
  
  /** Build a URL with tags for Quotable if applicable */
  function buildUrlWithTags(baseUrl, tagsPipe) {
    try {
      const u = new URL(baseUrl);
      // Only add tags for Quotable
      if (/quotable\.io\/random/.test(baseUrl) && tagsPipe) {
        // Quotable accepts comma-separated list in 'tags'
        const csv = tagsPipe.split('|').map(s => s.trim()).filter(Boolean).join(',');
        if (csv) u.searchParams.set('tags', csv);
      }
      return u.toString();
    } catch {
      return baseUrl; // if invalid, just return as-is
    }
  }
  
  /** Fetch from configured source with 8s timeout */
  async function fetchFromSource() {
    const url = buildUrlWithTags(DEFAULTS.URL, DEFAULTS.TAGS);
  
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
  
    try {
      const r = await fetch(url, { signal: controller.signal, headers: { 'accept': 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ct = r.headers.get('content-type') || '';
      const isJson = ct.includes('application/json') || ct.includes('text/json');
  
      const payload = isJson ? await r.json() : await r.text();
      const norm = normalizeQuotePayload(url, payload);
      if (!norm || !norm.text) throw new Error('Unrecognized quote payload');
  
      return { text: norm.text, author: norm.author || '', ts: Date.now() };
    } finally {
      clearTimeout(timer);
    }
  }
  
  /** Static fallback list (Stoic-heavy) */
  function fallbackQuote() {
    const pool = [
      ['Waste no more time arguing what a good man should be. Be one.', 'Marcus Aurelius'],
      ['We suffer more often in imagination than in reality.', 'Seneca'],
      ['Man is disturbed not by things, but by the views he takes of them.', 'Epictetus'],
      ['If it is not right, do not do it; if it is not true, do not say it.', 'Marcus Aurelius'],
      ['How long are you going to wait before you demand the best for yourself?', 'Epictetus'],
    ];
    const [text, author] = pool[Math.floor(Math.random() * pool.length)];
    return { text, author, ts: Date.now() };
  }
  
  /** Refresh the cache now (ignores TTL). */
  async function _refreshQuote() {
    try {
      const q = await fetchFromSource();
      _cache = q;
      return _cache;
    } catch (err) {
      // fallback but keep previous if it exists
      const fb = fallbackQuote();
      // If previous cache exists and is recent, prefer keeping the old author/text
      if (_cache?.text) {
        // only update timestamp so TTL logic doesn’t hammer API after failure
        _cache = { ..._cache, ts: Date.now() };
        return _cache;
      }
      _cache = fb;
      return _cache;
    }
  }
  
  /**
   * Get a quote with caching.
   * @param {object} opts
   * @param {boolean} [opts.force] - bypass TTL and refetch now
   * @returns {Promise<{text:string, author:string, ts:number}>}
   */
  async function getQuoteCached(opts = {}) {
    const { force = false } = opts;
    const age = Date.now() - (_cache?.ts || 0);
  
    if (force || age > DEFAULTS.TTL || !_cache?.text) {
      return _refreshQuote();
    }
    return _cache;
  }
  
  /**
   * Optional: auto-refresh on an interval (defaults to TTL). If you pass an io instance,
   * it will emit 'quoteUpdate' so the client can re-render without a full page reload.
   * Usage (in server.js):
   *   const { startQuoteAutoRefresh } = require('./utils/quoteService');
   *   startQuoteAutoRefresh(io); // or startQuoteAutoRefresh();
   */
  function startQuoteAutoRefresh(io, intervalMs = DEFAULTS.TTL) {
    // trigger an immediate warm-up
    _refreshQuote().catch(() => {});
    setInterval(() => {
      _refreshQuote()
        .then(q => { if (io) io.emit('quoteUpdate', q); })
        .catch(() => {});
    }, Math.max(60000, Number(intervalMs) || DEFAULTS.TTL)); // minimum 1 min
  }
  
  module.exports = {
    getQuoteCached,
    _refreshQuote,
    startQuoteAutoRefresh,
  };
  