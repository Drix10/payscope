# PayScope

PayScope is a Razorpay **Test Mode** payment-incident MVP. It receives a
verified webhook, stores only a bounded normalized record, processes it through
a durable queue, correlates it into an incident, and exposes a read-only React
operator workspace.

It is intentionally safe by default: no live payment operation, customer
message, refund, subscription change, or direct Vulcan claim exists.

## What runs today

```text
Razorpay Test Mode webhook
  -> raw-body HMAC verification and payload hashing
  -> Supabase atomic event + durable queue job
  -> VPS QueueWorker
  -> labelled Razorpay-field heuristic enrichment
  -> tenant-scoped correlation and incident lifecycle
  -> bounded model investigation, or audited human escalation
  -> React/Vite incident and audit workspace on Vercel
```

- Test Mode is enforced at backend startup.
- Customer identifiers become organization-specific HMAC hashes; raw webhook
  bodies and contact details are never persisted.
- Every API/database read injects the configured organization ID.
- If the Mesh key is absent or an agent response is invalid, the incident is
  escalated and audited—never turned into an action.
- The audit table is append-only and hash-chained per organization.

## Deliberate MVP limits

The dashboard exposes read-only incident data plus one token-gated,
simulated-only proposal approval. It does not have a user-management product,
browser session transport, live communications, payment execution, or a claim
of real recovered merchant revenue. Fixture metrics and remaining work are
tracked in [backend/CHECKPOINTS.md](./backend/CHECKPOINTS.md) and
[frontend/CHECKPOINTS.md](./frontend/CHECKPOINTS.md).

The incident read API is deliberately public for this one-merchant demo; CORS
only restricts which browser origins can read it and is not authentication.
Responses are reduced to presentation-safe Test Mode data and never include
customer hashes, provider payment/order IDs, or raw Razorpay payloads.

## Local setup

Requirements: Node.js 20+, npm, a Razorpay Test Mode account, and Supabase for
the durable path.

```powershell
cd backend
Copy-Item .env.example .env

cd ..\frontend
Copy-Item .env.example .env
```

Keep `PAYSCOPE_MVP_PIPELINE=false` while working without Supabase. The backend
will start in a deliberately degraded state and reject webhooks rather than
falling back to memory. To enable the durable pipeline, complete the next
section first.

### Enable the durable Test Mode pipeline

1. Authenticate the Supabase CLI, link the configured project, and push the
   canonical migration:

   ```powershell
   cd backend
   npx supabase login
   npx supabase link --project-ref oheegffhhtdudlbgrtso
   npx supabase db push
   ```

   The CLI is the canonical migration path. If a dashboard-only recovery is
   unavoidable, execute every SQL file in
   [`backend/supabase/migrations`](./backend/supabase/migrations) in filename
   order, then reconcile the migration history before any later CLI push.
2. Create one organization, then copy its ID into
   `PAYSCOPE_DEMO_ORGANIZATION_ID` and its Test Mode key ID into `razorpay_key_id`.
   Generate the customer hash secret locally; it must be at least 32 characters.

   ```sql
   insert into public.payscope_organizations (name, razorpay_key_id, customer_hash_secret)
   values ('PayScope Test Merchant', 'rzp_test_replace_me', 'replace_with_a_random_32_plus_character_secret')
   returning id;
   ```

3. Put the returned UUID, Supabase service-role key, Razorpay Test Mode keys,
   and webhook secret in `backend/.env`; set `PAYSCOPE_MVP_PIPELINE=true`.
   Add `MESH_API_KEY` to run the schema-constrained AI investigation path.
   Mesh calls use `response_format: json_schema` and local Zod validation.
4. Configure Razorpay Test Mode to deliver to
   `https://<your-vps-host>/webhooks/razorpay`, using the same webhook secret.
   PayScope persists only `payment.failed`, `payment.captured`, `order.paid`,
   and dispute-opening events (`created`, `under_review`, `action_required`).
   Other correctly signed Razorpay events are acknowledged with `200` and
   discarded: they create no event, queue job, audit entry, or incident.

The service-role key stays on the VPS. It must never appear in Vercel, frontend
files, or a `VITE_*` variable.

## Run and verify

```powershell
cd backend
npm ci
npm run build
npm run test:contracts
npm run test:database-client
npm run test:mvp-api
npm run test:webhook-intake
npm run test:agentic-webhook
npm run test:queue
npm run test:enrichment
npm run test:correlation
npm run test:agents
npm run test:investigation-runner
npm run start

cd ..\frontend
npm ci
npm run build
```

`GET /health` reports whether the durable pipeline is enabled. With it enabled,
the React app uses `GET /api/mvp/health`, `/incidents`, incident detail, and
audit history. Configure `CORS_ORIGINS` with the exact Vercel URL.

## Deployment

- **VPS:** deploy `backend/`; run `npm ci`, `npm run build`, then `npm run start`
  behind HTTPS. Use [backend deployment notes](./backend/docs/PRODUCTION_RAZORPAY_DEPLOYMENT.md).
- **Vercel:** deploy `frontend/` with `VITE_API_BASE_URL` set to the HTTPS VPS
  origin. Use [frontend deployment notes](./frontend/docs/DEPLOYMENT.md).

## Safety boundary

PayScope is a demo MVP, not a production financial-operations platform. It has
no Live Mode, payment execution, customer outreach, or production recovery
claim. Enrichment is labelled by its true source; no direct provider capability
is claimed unless that adapter is explicitly implemented and enabled.

The locked product contract remains in [Plan.md](./Plan.md).
