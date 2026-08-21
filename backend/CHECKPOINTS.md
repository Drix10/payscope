# PayScope API: delivery record

> Single repo: `backend/` + `frontend/` → deploy `frontend/` on Vercel. Legacy Intent Canvas is in its own repos.

## Current product boundary

The API accepts verified Razorpay payment signals, optionally imports bounded payment history, groups related risk into incidents, creates an evidence-backed investigation, and records a human operator's decision — or an admin-configured **autonomy policy** auto-decision (monitor/prepare_follow_up/review within confidence/amount/severity thresholds; dismiss is strictly capped; escalate never auto without explicit opt-in). It does not contact customers, issue refunds, alter subscriptions, or execute financial actions.

## Implemented

- Raw-body Razorpay webhook signature verification.
- Idempotent event ingestion, duplicate delivery recovery, and serialized incident correlation.
- Test/live environment configuration with a Test Mode-first setup path.
- Optional Supabase persistence for events, incidents, investigations, and audit history.
- Bounded Razorpay payment-history import using `from`, `to`, `count`, and `skip`.
- Deterministic investigator with an optional structured-model layer. Burst events are batched before automatic investigation; the resulting run is evaluated against admin autonomy policies for threshold-gated auto-execution, otherwise requiring human approval.
- Incident lifecycle: review, monitor, escalate, dismiss, partial recovery, and fully verified recovery.
- Private raw webhook payload retention, bounded event/evidence/audit windows, atomic incident-audit writes, request limits, API token protection outside development, payload caps, CORS configuration, safe error responses, and graceful shutdown.

## Before a production launch

1. Apply `supabase/migrations/20260820_paymentops_sentinel.sql` and `supabase/migrations/20260821_auto_policies.sql` to an isolated Supabase project.
2. Configure a unique webhook secret and Test Mode Razorpay keys on the server only.
3. Deploy `frontend/` on Vercel; deploy `backend/` on Vercel serverless or standalone Node behind HTTPS and set `PAYMENT_OPS_PUBLIC_URL`, `CORS_ORIGINS`, `API_ACCESS_TOKEN`, and `REQUIRE_API_AUTH=true`.
4. Add authenticated user and organization scoping before allowing browser-direct database access or multiple tenants.
5. Replace in-process correlation and model scheduling with a durable queue before horizontally scaling webhook workers.

## Verification standard

- `npm run test:smoke`, TypeScript build, production bundle, and HTTP contract tests must pass before a release.
- Validate a real Test Mode signed webhook, a duplicate delivery, a recovery event, and a bounded history import with a non-production Razorpay account.
- Keep financial mutations out of the agent path; operator approval is an audit entry, not an execution trigger.
