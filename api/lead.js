// POST /api/lead — validate + deliver the complete lead record. Returns 2xx ONLY after ≥1 configured destination acknowledged it.
// Destinations (configure at least one before the event):
//   LEAD_WEBHOOK_URL (+ optional LEAD_WEBHOOK_SECRET)  → Zapier / Make / your CRM webhook
//   MONDAY_API_TOKEN + MONDAY_BOARD_ID                 → creates an item on a monday.com board (full record in an update)
//   RESEND_API_KEY + LEAD_NOTIFY_TO + LEAD_NOTIFY_FROM → sales notification email
import { cors, body, ip, limited, clean, arr, withTimeout } from '../lib/util.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const phoneOk = (p) => { const d = p.replace(/[^\d]/g, ''); return /^\+?[\d\s().\-]{7,24}$/.test(p) && d.length >= 7 && d.length <= 15; };

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (limited('lead:' + ip(req), 5, 30 * 60 * 1000)) return res.status(429).json({ error: 'rate_limited' });
  const b = body(req);
  if (clean(b.hp, 50)) return res.status(200).json({ ok: true }); // honeypot: silently drop bots
  const lead = {
    fullName: clean(b.fullName, 120), companyName: clean(b.companyName, 120), role: clean(b.role, 120),
    workEmail: clean(b.workEmail, 200).toLowerCase(), phone: clean(b.phone, 30), bestTime: clean(b.bestTime, 40), bestTimeNote: clean(b.bestTimeNote, 120),
    challenge: clean(b.challenge, 1000), companyUrl: clean(b.companyUrl, 300), researchStatus: clean(b.researchStatus, 40),
    plan: b.plan && typeof b.plan === 'object' ? JSON.parse(JSON.stringify(b.plan).slice(0, 20000)) : null,
    sources: (Array.isArray(b.sources) ? b.sources : []).slice(0, 12).map((s) => ({ title: clean(s.title, 200), url: clean(s.url, 400), retrievedAt: clean(s.retrievedAt, 40) })),
    source: clean(b.source, 80) || 'nfc_elevate_nyc_2026', campaign: 'monday Elevate NYC 2026 — NFC token',
    consent: { given: b.consent?.given === true, text: clean(b.consent?.text, 400), at: new Date().toISOString(), privacyUrl: clean(b.consent?.privacyUrl, 300) },
    receivedAt: new Date().toISOString(), userAgent: clean(req.headers['user-agent'], 200)
  };
  const errors = {};
  if (!lead.fullName) errors.fullName = 'required';
  if (!lead.companyName) errors.companyName = 'required';
  if (!EMAIL.test(lead.workEmail)) errors.workEmail = 'invalid';
  if (!phoneOk(lead.phone)) errors.phone = 'invalid';
  if (!lead.consent.given) errors.consent = 'required';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'invalid_input', fields: errors });

  const tasks = [];
  if (process.env.LEAD_WEBHOOK_URL) tasks.push(['webhook', () => fetch(process.env.LEAD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.LEAD_WEBHOOK_SECRET ? { 'X-Webhook-Secret': process.env.LEAD_WEBHOOK_SECRET } : {}) }, body: JSON.stringify(lead) }).then((r) => { if (!r.ok) throw new Error(r.status); })]);
  if (process.env.MONDAY_API_TOKEN && process.env.MONDAY_BOARD_ID) tasks.push(['monday', () => mondayCreate(lead)]);
  if (process.env.RESEND_API_KEY && process.env.LEAD_NOTIFY_TO && process.env.LEAD_NOTIFY_FROM) tasks.push(['email', () => notify(lead)]);
  if (!tasks.length) return res.status(503).json({ error: 'not_configured' });

  const results = await Promise.allSettled(tasks.map(([, fn]) => withTimeout(fn(), 8000)));
  const delivered = tasks.filter((_, i) => results[i].status === 'fulfilled').map(([n]) => n);
  if (!delivered.length) return res.status(502).json({ error: 'delivery_failed' });
  return res.status(200).json({ ok: true, delivered });
}

function summary(l) {
  const p = l.plan || {};
  return [
    `Lead — ${l.fullName}, ${l.role} at ${l.companyName}`, `Email: ${l.workEmail} · Phone: ${l.phone} · Best time: ${l.bestTime || '—'} ${l.bestTimeNote || ''}`,
    `Source: ${l.source} (${l.campaign}) · ${l.receivedAt}`, `Company URL: ${l.companyUrl || 'not verified'} · Research: ${l.researchStatus || 'n/a'}`, '',
    `Challenge: ${l.challenge}`, '', `Plan — challenge: ${p.challenge || ''}`,
    ...(p.actions || []).map((a, i) => `${i + 1}. ${a.action} — ${a.firstMove}`), '', 'Sources:', ...l.sources.map((s) => `- ${s.title} ${s.url}`),
    '', `Consent: ${l.consent.given} at ${l.consent.at} — "${l.consent.text}"`
  ].join('\n');
}
async function mondayCreate(l) {
  const q = 'mutation($b:ID!,$n:String!){create_item(board_id:$b,item_name:$n){id}}';
  const r = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: process.env.MONDAY_API_TOKEN, 'API-Version': '2024-10' }, body: JSON.stringify({ query: q, variables: { b: process.env.MONDAY_BOARD_ID, n: `${l.fullName} · ${l.companyName}` } }) });
  const d = await r.json(); const id = d?.data?.create_item?.id; if (!id) throw new Error('monday_create');
  const u = 'mutation($i:ID!,$t:String!){create_update(item_id:$i,body:$t){id}}';
  await fetch('https://api.monday.com/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: process.env.MONDAY_API_TOKEN, 'API-Version': '2024-10' }, body: JSON.stringify({ query: u, variables: { i: id, t: summary(l).replace(/\n/g, '<br>') } }) });
}
async function notify(l) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, body: JSON.stringify({ from: process.env.LEAD_NOTIFY_FROM, to: process.env.LEAD_NOTIFY_TO.split(','), subject: `Elevate lead: ${l.fullName} · ${l.companyName}`, text: summary(l) }) });
  if (!r.ok) throw new Error('resend_' + r.status);
}
