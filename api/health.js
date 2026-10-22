// GET /api/health — shows which integrations are configured (booleans only, never values).
export default function handler(req, res) {
  const has = (k) => !!process.env[k];
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    openai: { key: has('OPENAI_API_KEY'), model: process.env.OPENAI_MODEL || null },
    search: { provider: process.env.SEARCH_PROVIDER || null, tavily: has('TAVILY_API_KEY'), brave: has('BRAVE_API_KEY') },
    lead: { webhook: has('LEAD_WEBHOOK_URL'), monday: has('MONDAY_API_TOKEN') && has('MONDAY_BOARD_ID'), resend: has('RESEND_API_KEY') && has('LEAD_NOTIFY_TO') && has('LEAD_NOTIFY_FROM') },
    node: process.version
  });
}
