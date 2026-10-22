# WEB3D Elevate — LIVE build

This build calls the real server functions. It will show "Something went wrong" until the keys below are set in Vercel.

Vercel → Project → Settings → Environment Variables (Production), then **Redeploy**:
- `OPENAI_API_KEY`, `OPENAI_MODEL` — required (AI plan)
- `SEARCH_PROVIDER` = `tavily` + `TAVILY_API_KEY` (or `brave` + `BRAVE_API_KEY`) — required for company research
- Lead destination, at least one: `LEAD_WEBHOOK_URL` · or `MONDAY_API_TOKEN` + `MONDAY_BOARD_ID` · or `RESEND_API_KEY` + `LEAD_NOTIFY_TO` + `LEAD_NOTIFY_FROM`

Test after deploy: open `/`, submit a real company you know, confirm the website, check the source links, then submit a test lead and confirm it arrived.
