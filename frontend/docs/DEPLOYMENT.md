# PayScope frontend deployment (Vercel)

Deploy the `frontend/` directory as a Vite static application.

Set only these Vercel build variables:

```env
VITE_API_BASE_URL=https://<your-vps-host>
VITE_API_TIMEOUT_MS=20000
```

Run `npm ci` and `npm run build`; Vercel publishes `dist/`.

`VITE_*` variables are public bundle data. Never add Razorpay secrets, a
Razorpay key ID, Supabase credentials, Mesh credentials, API bearer token,
or communications credentials. The frontend reads only `/api/mvp` incident
data and cannot trigger an action; its configured Vercel origin must be present
in the backend `CORS_ORIGINS` value.

The deployed interface is read-only. It should be
used only with a backend whose `/health` endpoint reports `pipeline:
"autonomous"`.
