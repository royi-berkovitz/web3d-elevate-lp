# WEB3D Elevate — deploy

Upload the CONTENTS of this folder to the root of your GitHub repo, then import it in Vercel (Framework preset: **Other**, no build command, output directory: root).

- `/` → index.html — the Elevate experience (self-contained; demo mode by default)
- `/nfc/` → the Disconnected Data experience
- `/api/analyze` → OpenAI endpoint (serverless function)

## Turn on real AI
1. Vercel → Project → Settings → Environment Variables: `OPENAI_API_KEY`, `OPENAI_MODEL`.
2. In Claude Design, edit `elevate-config.js`: `provider: "server"` and `endpoints.analyze: "/api/analyze"`, then re-export.

Never commit the API key.
