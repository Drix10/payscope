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

This project has the following active autonomous-lifecycle migrations before the pipeline is enabled:

- `202608230006_autonomous_simulated_execution.sql`
- `202608230007_autonomous_lifecycle_and_metrics.sql`
- `202608230008_investigation_trigger_idempotency.sql`
- `202608230009_direct_execution_email.sql` (required before direct email execution)
- `202608230010_direct_execution_complete.sql` (callback inbox, reconciliation, execution policy, transition graph)
- `202608230011_direct_only_enforcement.sql` (retire legacy simulation channels)
- `202608230012_internal_action_finalize.sql` (finalize non-provider actions without a provider receipt)

Create the merchant organization through the canonical migration/RPC workflow, copy its UUID to `PAYSCOPE_ORGANIZATION_ID`, and keep a separate `PAYSCOPE_INTEGRATION_ORGANIZATION_ID` for opt-in integration checks. Do not use an incident-bearing organization for destructive fixture cleanup; audit entries are append-only by design.

## 2. Configure server-only environment

Copy `backend/.env.example` to a private `backend/.env`. Set:

- `NODE_ENV=production`
- `PAYSCOPE_PIPELINE_ENABLED=true` only after migrations and organization setup succeed
- `PAYSCOPE_DIRECT_EXECUTION_ENABLED=false` until the direct migration, recipient vault, SMTP sender verification, and Phase-A proof have completed
- a unique `PAYSCOPE_WORKER_ID`
- `CORS_ORIGINS=https://<your-vercel-domain>`
- `RAZORPAY_ENVIRONMENT=live` or `test`, matching the `rzp_live_` or `rzp_test_` prefix of `RAZORPAY_KEY_ID`
- Razorpay key secret and webhook secret, Supabase URL/service-role key, Mesh API key, SMTP credentials, and `PAYSCOPE_EMAIL_ENCRYPTION_KEY` only on the VPS

If the service is behind exactly one trusted reverse proxy, set `TRUST_PROXY=true`. Do not set it when Node is directly internet-facing. Do not place any backend value in Vercel or a `VITE_*` variable.

When `PAYSCOPE_DIRECT_EXECUTION_ENABLED=true`, PayScope's Phase-A capability creates a Razorpay Payment Link with Razorpay notifications disabled and sends one recovery email through the configured SMTP relay. A recipient must be in the encrypted, consented email vault. The execution worker starts only after SMTP verification succeeds; otherwise direct execution reports unhealthy and actions remain queued. Immediately before the irreversible SMTP marker, the database rechecks active consent, a non-terminal incident, and a 24-hour command lifetime. SMTP acceptance is not delivery or recovery; only a verified `payment_link.paid` event confirms recovery. An ambiguous SMTP result is recorded as `unreconciled` and is never blindly resent.

Before enabling that value, configure the merchant policy for the Phase-A capability and enroll only a consented recipient from the VPS:

```sql
update public.payscope_merchant_policies
set enabled = true,
    merchant_opted_in_to_recovery = true,
    allowed_actions = array['deliver_recovery_link_email', 'record_risk_signal', 'resolve_infrastructure']::text[]
where organization_id = '<merchant-organization-uuid>';
```

```bash
# Run only on the VPS; remove the three temporary PAYSCOPE_RECIPIENT_* values
# from .env immediately after the encrypted write succeeds.
PAYSCOPE_RECIPIENT_CUSTOMER_ID=cust_... \
PAYSCOPE_RECIPIENT_EMAIL=customer@example.com \
PAYSCOPE_RECIPIENT_EMAIL_CONSENT=true \
npm run recipient:upsert
```

Set `PAYSCOPE_DIRECT_EXECUTION_ENABLED=true` only after the SMTP `verify()` readiness check succeeds and the Phase-A integration proof passes.

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
→ schema-validated AI investigation → deterministic policy → immutable email command
→ Razorpay Payment Link → SMTP acceptance/rejection → payment-link reconciliation → audit chain
```

## 5. Post-deploy checks

```bash
npm run build
npm run test
npm audit --omit=dev --audit-level=high
```

Run opt-in integration checks only against the dedicated integration organization. Exercise duplicate webhooks, stale/missing jobs, model timeout or invalid JSON, unavailable enrichment, fraud, dispute, contact limit, partial/full late capture, concurrent worker claims, SMTP rejection, and an execution-worker restart after the durable email-send marker. In every case confirm that the browser remains read-only and an ambiguous email is never sent twice.

Report direct recovery only from action → receipt → verified Razorpay event evidence; the legacy fixture benchmark has been removed.
