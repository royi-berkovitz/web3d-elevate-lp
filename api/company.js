// POST /api/company — find likely OFFICIAL website candidates via a real search API. Never guesses a domain.
import { cors, body, ip, limited, clean, webSearch, normalizeUrl } from '../lib/util.js';

const NOISE = /(linkedin|facebook|instagram|twitter|x\.com|youtube|crunchbase|zoominfo|bloomberg|glassdoor|indeed|wikipedia|yelp|bbb\.org|dnb\.com|apollo\.io|rocketreach|pitchbook)/i;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (limited('company:' + ip(req), 10, 10 * 60 * 1000)) return res.status(429).json({ error: 'rate_limited' });
  const b = body(req);
  const name = clean(b.companyName, 120); if (name.length < 2) return res.status(400).json({ error: 'invalid_input' });
  const hint = clean(b.context?.title, 80);
  try {
    const results = await webSearch(`"${name}" official website`, 8);
    const seen = new Set(); const candidates = [];
    for (const r of results) {
      const u = normalizeUrl(r.url); if (!u || NOISE.test(u.hostname)) continue;
      const host = u.hostname.replace(/^www\./, ''); if (seen.has(host)) continue; seen.add(host);
      candidates.push({ name: r.title.split(/[|\-–—:]/)[0].trim() || name, url: 'https://' + u.hostname + '/', snippet: r.snippet });
      if (candidates.length >= 3) break;
    }
    return res.status(200).json({ query: name, hint, candidates, retrievedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(e.message === 'search_not_configured' ? 503 : 502).json({ error: e.message === 'search_not_configured' ? 'not_configured' : 'search_failed' });
  }
}
