# WEB3D Elevate — deploy

Upload the CONTENTS of this folder to the root of your GitHub repo, then import it in Vercel (Framework preset: **Other**, no build command).

- `/` → index.html (self-contained; demo mode by default)
- `/nfc/` → Disconnected Data experience
- `/api/analyze` stage-1 quick plan · `/api/company` official-site lookup · `/api/research` stage-2 sourced research · `/api/lead` lead capture

## Environment variables (Vercel → Settings → Environment Variables)
- AI (required for live plans): `OPENAI_API_KEY`, `OPENAI_MODEL`
- Web search (required for research): `SEARCH_PROVIDER` = `tavily` or `brave`, plus `TAVILY_API_KEY` or `BRAVE_API_KEY`
- Lead destination (at least one): `LEAD_WEBHOOK_URL` (+ `LEAD_WEBHOOK_SECRET`) · or `MONDAY_API_TOKEN` + `MONDAY_BOARD_ID` · or `RESEND_API_KEY` + `LEAD_NOTIFY_TO` + `LEAD_NOTIFY_FROM`
- Optional: `ALLOWED_ORIGIN`

## Switch from demo to live
In Claude Design edit `elevate-config.js`: `provider: "server"`, set `endpoints` to `/api/analyze`, `/api/company`, `/api/research`, `/api/lead`, and set `lead.privacyUrl`. Re-export.

Lead capture returns success only after a configured destination acknowledges it. The in-memory rate limiter is per-instance — back it with Vercel KV/Upstash before the event. Never commit keys.
