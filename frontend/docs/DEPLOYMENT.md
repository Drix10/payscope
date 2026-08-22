# PayScope dashboard — Vercel deployment

This is a **single repo** (`backend/` + `frontend/`). The `frontend/` is deployed on **Vercel**; the `backend/` runs alongside (Vercel serverless or standalone Node). Legacy Intent Canvas stays in its own repos.

Build the dashboard with the API origin:

```env
VITE_API_BASE_URL=https://temp.coslynx.com
VITE_API_TIMEOUT_MS=20000
VITE_API_ACCESS_TOKEN=<temporary-browser-gate-only>
```

```bash
npm run build   # → frontend/dist/
```

- Set `VITE_API_BASE_URL` to `https://temp.coslynx.com` (or the final API origin if it changes).
- Add `https://payscope-ai.vercel.app` to the backend `CORS_ORIGINS`.
- `VITE_*` is baked into the bundle at build time — never put Razorpay `RAZORPAY_*`, Supabase service-role, or OpenAI keys in `VITE_*`.
- For local dev, `vite.config.ts` proxies `/api` to `http://localhost:25655` (or `VITE_API_PROXY_TARGET`).

Use `npm run build` and serve `dist/` via Vercel. A Vite environment value is part of the browser bundle, so `VITE_API_ACCESS_TOKEN` is never a production authentication mechanism. Add real user authentication before a public multi-tenant release.
