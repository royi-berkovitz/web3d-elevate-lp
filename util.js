// Shared helpers for WEB3D Elevate serverless functions (Vercel, Node 18+).
import dns from 'node:dns/promises';
import net from 'node:net';

export const clean = (v, n = 500) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, n);
export const arr = (v, n, len = 400) => (Array.isArray(v) ? v : []).map((x) => clean(x, len)).filter(Boolean).slice(0, n);

export function cors(req, res) {
  const origin = process.env.ALLOWED_ORIGIN || '';
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return true; }
  return false;
}
export function body(req) { try { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { return {}; } }
export function ip(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'; }

// Best-effort per-instance limiter. For the event, back this with a shared store (Upstash/Vercel KV).
const buckets = new Map();
export function limited(key, max, windowMs) {
  const now = Date.now(); const a = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  a.push(now); buckets.set(key, a); return a.length > max;
}

export async function withTimeout(promise, ms, label = 'timeout') {
  let t; const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label)), ms); });
  try { return await Promise.race([promise, timer]); } finally { clearTimeout(t); }
}

// ---------- SSRF-safe public HTTPS fetch ----------
function privateIp(addr) {
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = addr.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.');
}
export function normalizeUrl(u) {
  let s = clean(u, 300); if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let url; try { url = new URL(s); } catch { return null; }
  url.protocol = 'https:'; url.hash = ''; url.username = ''; url.password = '';
  if (url.port && url.port !== '443') return null;
  if (!/\./.test(url.hostname) || /^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname) || net.isIP(url.hostname)) return null;
  return url;
}
async function assertPublic(url) {
  const addrs = await withTimeout(dns.lookup(url.hostname, { all: true }), 2500, 'dns');
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('blocked_host');
}
export async function safeFetchText(input, { maxBytes = 400_000, timeoutMs = 6000, maxRedirects = 3 } = {}) {
  let url = normalizeUrl(input); if (!url) throw new Error('bad_url');
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublic(url);
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let r;
    try { r = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'WEB3D-Elevate-Research/1.0 (+https://web3d-studio.com)', Accept: 'text/html' } }); }
    finally { clearTimeout(t); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      const next = normalizeUrl(new URL(r.headers.get('location'), url).toString()); if (!next) throw new Error('bad_redirect');
      url = next; continue;
    }
    if (!r.ok) throw new Error('http_' + r.status);
    if (!/text\/html|text\/plain/i.test(r.headers.get('content-type') || '')) throw new Error('not_html');
    const reader = r.body.getReader(); let size = 0; const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) { try { reader.cancel(); } catch {} break; } chunks.push(value); }
    const html = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    return { url: url.toString(), html };
  }
  throw new Error('too_many_redirects');
}
export function extract(html, base) {
  const title = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '', 200).replace(/\s+/g, ' ');
  const desc = clean((html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || [])[1] || '', 300);
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 6000);
  const links = [];
  const re = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html)) && links.length < 200) {
    try { const u = new URL(m[1], base); if (u.hostname === new URL(base).hostname) links.push({ url: u.toString().split('#')[0], label: clean(m[2].replace(/<[^>]+>/g, ''), 60) }); } catch {}
  }
  return { title, desc, text, links };
}

// ---------- Search provider (real web search; pick one with env SEARCH_PROVIDER) ----------
// tavily: TAVILY_API_KEY · brave: BRAVE_API_KEY
export async function webSearch(q, n = 5) {
  const p = (process.env.SEARCH_PROVIDER || '').toLowerCase();
  if (p === 'tavily' && process.env.TAVILY_API_KEY) {
    const r = await withTimeout(fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` }, body: JSON.stringify({ query: q, max_results: n, search_depth: 'basic' }) }), 8000, 'search_timeout');
    if (!r.ok) throw new Error('search_http_' + r.status);
    const d = await r.json();
    return (d.results || []).map((x) => ({ title: clean(x.title, 200), url: clean(x.url, 400), snippet: clean(x.content, 400) }));
  }
  if (p === 'brave' && process.env.BRAVE_API_KEY) {
    const r = await withTimeout(fetch('https://api.search.brave.com/res/v1/web/search?count=' + n + '&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_API_KEY } }), 8000, 'search_timeout');
    if (!r.ok) throw new Error('search_http_' + r.status);
    const d = await r.json();
    return ((d.web && d.web.results) || []).map((x) => ({ title: clean(x.title, 200), url: clean(x.url, 400), snippet: clean((x.description || '').replace(/<[^>]+>/g, ''), 400) }));
  }
  throw new Error('search_not_configured');
}

// ---------- OpenAI structured call ----------
export async function openaiJSON({ system, user, schema, name, timeoutMs = 20000, retries = 1 }) {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) throw new Error('not_configured');
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await withTimeout(fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: process.env.OPENAI_MODEL, temperature: 0.3, max_tokens: 1400, response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
      }), timeoutMs, 'ai_timeout');
      if (!r.ok) {
        let msg = ''; try { const j = await r.json(); msg = clean(j?.error?.message || '', 200); } catch {}
        const err = new Error('upstream_' + r.status); err.detail = msg;
        if (r.status === 429 || r.status >= 500) { last = err; continue; }
        throw err;
      }
      const d = await r.json();
      return JSON.parse(d.choices?.[0]?.message?.content || '{}');
    } catch (e) { last = e; if (e.message === 'not_configured') throw e; }
  }
  throw last || new Error('ai_failed');
}

export const CAPABILITIES = [
  'Business process and workflow analysis',
  'monday.com implementation and customization (only where it fits)',
  'Software and system integrations (CRM, ERP, marketing tools)',
  'Workflow and marketing automation',
  'Custom software and application development',
  'Digital operations, reporting and measurement',
  'Website design, development and maintenance',
  'Digital marketing (SEO, paid media, social)'
];

const ACTION = { type: 'object', additionalProperties: false, required: ['action', 'why', 'firstMove', 'owner'], properties: { action: { type: 'string' }, why: { type: 'string' }, firstMove: { type: 'string' }, owner: { type: 'string', description: 'Suggested owner role, or empty string if not reasonably inferable' } } };
export const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['challenge', 'assumptions', 'opportunity', 'actions', 'web3dHelp', 'helpAreas', 'clarify'],
  properties: {
    challenge: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    opportunity: { type: 'array', items: { type: 'string' } },
    actions: { type: 'array', items: ACTION },
    web3dHelp: { type: 'string', description: 'One sentence: where WEB3D could potentially help, tied to the challenge' },
    helpAreas: { type: 'array', description: '2-3 items, most relevant first', items: { type: 'object', additionalProperties: false, required: ['area', 'how', 'steps'], properties: { area: { type: 'string', enum: CAPABILITIES }, how: { type: 'string', description: 'How this capability applies to THIS challenge, one sentence, no promises or metrics' }, steps: { type: 'array', items: { type: 'integer' }, description: 'Action step numbers (1-based) this supports' } } } },
    clarify: { type: 'array', items: { type: 'string' } }
  }
};
export function normPlan(p) {
  return {
    challenge: clean(p.challenge, 700), assumptions: arr(p.assumptions, 3), opportunity: arr(p.opportunity, 2),
    actions: (Array.isArray(p.actions) ? p.actions : []).slice(0, 5).map((a) => ({ action: clean(a.action, 140), why: clean(a.why, 300), firstMove: clean(a.firstMove, 300), owner: clean(a.owner, 80) })).filter((a) => a.action),
    web3dHelp: clean(p.web3dHelp, 500), helpAreas: (Array.isArray(p.helpAreas) ? p.helpAreas : []).filter((h) => h && CAPABILITIES.includes(h.area)).slice(0, 3).map((h) => ({ area: h.area, how: clean(h.how, 240), steps: (Array.isArray(h.steps) ? h.steps : []).map(Number).filter((x) => x >= 1 && x <= 5).slice(0, 3) })), clarify: arr(p.clarify, 3)
  };
}
export const CONSULTANT = `You are WEB3D's preliminary Business Solutions Consultant for US business decision-makers.
Lead with the business challenge, not WEB3D's service catalog. Restate the visitor's challenge in their terms, separate assumptions from facts,
and give 3-5 PRIORITIZED actions (most important first), each with "why" and a concrete "firstMove". Add a suggested owner role only if reasonably inferable.
Do not infer facts about the company from its name or the visitor's title. Never invent results, KPIs, ROI, deadlines, research, benchmarks or sources.
Do not default to website development; recommend monday.com only when clearly relevant. Plain, concise US English.
Approved WEB3D capabilities (only reference these): ${CAPABILITIES.join('; ')}.`;
