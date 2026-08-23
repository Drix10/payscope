# PayScope backend deployment

PayScope runs as a single Node.js process on a VPS with Supabase providing durable storage, queue state, RLS, and the audit chain. Use Node.js 20 or newer. The backend supplies a WebSocket transport for Supabase, so Node 20/21 images work as well as Node 22+.

## 1. Prepare Supabase deliberately

From `backend/`, authenticate and link the intended project, then inspect the migration plan before applying it:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push --dry-run
npx supabase db push
```

This project has two active autonomous-lifecycle migrations that must be present before the pipeline is enabled:

- `202608230006_autonomous_simulated_execution.sql`
- `202608230007_autonomous_lifecycle_and_metrics.sql`
- `202608230008_investigation_trigger_idempotency.sql`

Create the merchant organization through the canonical migration/RPC workflow, copy its UUID to `PAYSCOPE_ORGANIZATION_ID`, and keep a separate `PAYSCOPE_INTEGRATION_ORGANIZATION_ID` for opt-in integration checks. Do not use an incident-bearing organization for destructive fixture cleanup; audit entries are append-only by design.

## 2. Configure server-only environment

Copy `backend/.env.example` to a private `backend/.env`. Set:

- `NODE_ENV=production`
- `PAYSCOPE_PIPELINE_ENABLED=true` only after migrations and organization setup succeed
- a unique `PAYSCOPE_WORKER_ID`
- `CORS_ORIGINS=https://<your-vercel-domain>`
- `RAZORPAY_ENVIRONMENT=live` or `test`, matching the `rzp_live_` or `rzp_test_` prefix of `RAZORPAY_KEY_ID`
- Razorpay key secret and webhook secret, Supabase URL/service-role key, and Mesh API key only on the VPS

If the service is behind exactly one trusted reverse proxy, set `TRUST_PROXY=true`. Do not set it when Node is directly internet-facing. Do not place any backend value in Vercel or a `VITE_*` variable.

PayScope automatically records every policy-permitted **simulation** and every autonomous no-action outcome. It does not send a customer message or execute a payment action. No environment value changes that boundary.

## 3. Build and run

```bash
npm ci
npm run build
npm run start
```

Run the process under a supervisor appropriate for the VPS (for example systemd), put it behind HTTPS, and configure a health check against `GET /health`. A correct response reports `pipeline: "autonomous"` and the configured Razorpay environment. A disabled durable pipeline rejects webhooks with `503`; it never falls back to an in-memory queue.

## 4. Configure Razorpay webhook

Point the Razorpay webhook to:

```text
POST https://<your-api-domain>/webhooks/razorpay
```

Set its secret to the exact value of `RAZORPAY_WEBHOOK_SECRET`. The endpoint verifies the HMAC over the raw body before parsing it. It acknowledges supported signed events, then workers process only the event types needed for the bounded incident pipeline; extra signed event subscriptions are safely acknowledged rather than becoming false incidents.

After saving the webhook, send one known event and confirm this chain in server logs/database:

```text
accepted webhook → durable event + job → leased worker → enrichment → correlation
→ schema-validated AI investigation → deterministic policy → simulation/no-action → audit chain
```

## 5. Post-deploy checks

```bash
npm run build
npm run test:contracts
npm run test:schema
npm run test:agents
npm run test:investigation-runner
npm run test:phase3
npm run test:mvp-api
npm run test:cors
npm audit --omit=dev --audit-level=high
```

Run opt-in integration scripts only against the dedicated integration organization. Exercise duplicate webhooks, stale/missing jobs, model timeout or invalid JSON, unavailable enrichment, fraud, dispute, contact limit, partial/full late capture, and concurrent worker claims. In every case confirm that the browser remains read-only and no customer/provider write occurs.

For signed fixture evaluation reports, set a unique 32+ character `PAYSCOPE_FIXTURE_SIGNING_SECRET` and run `PAYSCOPE_RUN_EVALUATION=true npm run run:evaluation`. Run `development` before `held_out`; held-out reports are database-locked per fixture version. Their recovery figures remain simulation evidence, never real-revenue claims.
