# PayScope backend deployment (VPS, Test Mode MVP)

This is a single-instance Test Mode deployment, not a Live Mode payment system.
Use Node.js 20 or newer. The API supplies its own WebSocket transport for
Supabase, so Node 20/21 VPS images are supported as well as Node 22+.

1. Copy `backend/.env.example` to `backend/.env` and configure the server-only
   values. Authenticate the Supabase CLI, run `supabase link --project-ref
   oheegffhhtdudlbgrtso`, then run `supabase db push`. Seed the organization
   before setting `PAYSCOPE_MVP_PIPELINE=true`.
2. Set `NODE_ENV=production`, a unique `PAYSCOPE_WORKER_ID`, and
   `CORS_ORIGINS=https://<your-vercel-domain>`. If the VPS is behind exactly
   one trusted reverse proxy, set `TRUST_PROXY=true`; do not enable it when the
   Node service is directly internet-facing. To use the proposal-approval
   demo, also set a random 32+ character `PAYSCOPE_DEMO_APPROVAL_TOKEN` and
   optional `PAYSCOPE_DEMO_OPERATOR_ID`. The token remains on the VPS; the
   operator types it for the one approval action and it is never persisted in
   the browser. Set a separate 32+ character `PAYSCOPE_FIXTURE_SIGNING_SECRET`
   only when recording signed fixture evaluation reports; it never belongs in
   Vercel. Set `PAYSCOPE_TEST_ORGANIZATION_ID` only to a separate fixture
   tenant for hosted integration tests; never point it to the public demo
   organization, because approval/cancellation evidence is append-only.
3. Install and start:

   ```bash
   npm ci
   npm run build
   npm run start
   ```

4. Put the service behind HTTPS, then point the Razorpay **Test Mode** webhook
   at `https://<your-vps-host>/webhooks/razorpay`. The endpoint verifies HMAC
   before reading event data. It persists only payment failure/capture,
   `payment_link.paid`, `order.paid`, and dispute-opening events; all other
   correctly signed events are acknowledged and ignored, so enabling a broader
   Razorpay event list cannot create a false incident.

The VPS alone receives `SUPABASE_SERVICE_ROLE_KEY`, Razorpay secrets, and the
optional Mesh API key. Mesh uses provider-enforced JSON Schema structured
outputs plus local Zod validation. Do not add these values to Vercel or a
`VITE_*` variable.

The current React MVP uses a one-session demo approval token instead of a full
auth product. Do not expose its PII-reduced demo API publicly beyond the
intended review audience; adding real authentication is a tracked follow-up.

Verify `GET /health` after deployment. It must report `pipeline: "agentic_mvp"`
before configuring Razorpay deliveries. A disabled pipeline rejects webhooks
with `503` rather than losing them in an in-memory fallback.

For a fixture report, run `PAYSCOPE_RUN_EVALUATION=true npm run run:evaluation`
on the VPS after build. Run `development` before `held_out`; the latter is
database-locked to one report per fixture version. Reports and causal recovery
counts are Test Mode evidence only, never real-revenue claims.
