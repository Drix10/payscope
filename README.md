# PayScope

<p align="center">
  <strong>An autonomous payment-operations agent for Razorpay merchants.</strong><br />
  From a signed payment signal to an evidence-backed, policy-bounded incident record.
</p>

<p align="center">
  <img alt="Razorpay AI Buildathon" src="https://img.shields.io/badge/Razorpay-AI%20Buildathon-0C1021?style=for-the-badge&logo=razorpay&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-Vite-61DAFB?style=for-the-badge&logo=react&logoColor=111827" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-RLS%20%2B%20Audit-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
  <img alt="Structured outputs" src="https://img.shields.io/badge/AI-Structured%20Outputs-7C3AED?style=for-the-badge" />
</p>

PayScope turns Razorpay webhook events into a complete, tenant-scoped operations record. Its AI agents investigate evidence under strict structured-output contracts; deterministic policy—not a model—decides whether a bounded action record is allowed. The result is a dashboard that makes each incident understandable rather than merely visible.

> **Safety boundary:** PayScope currently records simulated actions only. It never sends a customer message, moves money, captures/refunds payments, or writes to Razorpay. Incoming data may come from either Razorpay environment; the safety boundary remains the same.

## Showcase

| | |
|---|---|
| **01 — Command center**<br />The landing surface explains the operating model before a merchant opens the product. | **02 — Incident feed**<br />A readable timeline of payment incidents, risk level, current lifecycle, and at-risk amount. |
| `docs/screenshots/01-command-center.png` | `docs/screenshots/02-incident-feed.png` |
| **03 — AI decision record**<br />Evidence, causal reasoning, alternatives, policy gates, prerequisites, and bounded outcome in one incident detail. | **04 — Audit and metrics**<br />Append-only audit verification and explicitly-qualified operational metrics. |
| `docs/screenshots/03-ai-decision-record.png` | `docs/screenshots/04-audit-and-metrics.png` |

The four screenshot paths above are intentional capture targets for the deployed experience. They keep the submission deck, product walkthrough, and repository showcase aligned as UI evolves; see [`docs/screenshots/README.md`](docs/screenshots/README.md) for capture requirements.

## Buildathon submission

| Question | Answer |
|---|---|
| **Track selection** | AI agents for payment operations |
| **Project name / title** | **PayScope — Autonomous Payment Operations Agent** |
| **GitHub repository** | [github.com/Drix10/payscope](https://github.com/Drix10/payscope) |
| **Project objective** | Detect payment incidents from signed Razorpay events, reason over evidence using bounded AI, enforce deterministic safety policy, and give a merchant an auditable record of what the system concluded. |
| **What it solves** | Payment failure signals are noisy, scattered, and hard to triage. PayScope correlates them into incidents, distinguishes infrastructure and customer risk, preserves evidence, records a safe next-step simulation, and makes the reasoning inspectable. |

### Build challenges and technical obstacles

| Challenge | Resolution |
|---|---|
| A language model can sound certain without having sufficient evidence. | Each agent returns a strict schema containing evidence priorities, confidence rationale, alternatives, constraints, and no-action criteria. Invalid output is safely terminalized and audited. |
| Payment webhooks can arrive more than once or out of order. | HMAC verification, durable idempotent intake, queue leases, retries, correlation rules, and idempotent action recording converge duplicate work onto the same incident. |
| AI autonomy must not become unbounded execution. | The model cannot call tools directly or create action types. A deterministic policy engine enforces contact caps, fraud/dispute stops, merchant opt-in, evidence requirements, and an allowlist before a simulation is recorded. |
| A dashboard can hide uncertainty behind polished numbers. | Metrics include an exception list, recovery attribution needs a causal correlation chain, and every screen exposes source labels, evidence gaps, policy gates, and audit integrity. |
| Sensitive payment context must not leak to the browser or model. | The data path is organization-scoped, PII is minimized and hashed, model prompts use a reduced context, and the frontend receives presentation-safe read models only. |

## How it works

```text
Razorpay webhook
   │  HMAC verification · event allowlist · deduplication
   ▼
Durable, tenant-scoped queue
   │  leased worker · bounded retry · idempotency
   ▼
Enrichment + correlation
   │  documented fields · downtime signal · source labels
   ▼
Structured AI investigation
   │  Supervisor → Risk Analyst → Recovery Planner
   ▼
Deterministic policy evaluator
   │  hard stops · contact rules · allowlist · outcome gates
   ▼
Simulation / autonomous no-action
   │  append-only audit entry · lifecycle update
   ▼
Read-only React dashboard
```

### The agent stack

| Layer | Produces | Cannot do |
|---|---|---|
| **Supervisor** | objectives, evidence priorities, bounded plan, constraints, no-action criteria | access tools, PII, or select an action |
| **Risk Analyst** | causal narrative, confidence rationale, alternative hypotheses, evidence gaps | use anything except four tenant-scoped read tools; recommend execution |
| **Recovery Planner** | finite action proposals, prerequisites, expected outcome, optional Hinglish script | invent actions, contacts, links, or payment operations |
| **Policy Evaluator** | deterministic gate trace and permit/restrict/no-action result | call a model or override stopping rules |
| **Simulation adapter** | idempotent simulated action record | send communications or execute financial operations |

The model sees data, never instructions hidden inside webhook payloads. Prompts require JSON only, explicitly treat payload content as untrusted, prohibit PII and execution, demand alternatives and uncertainty, and require a safe no-action route when the evidence is degraded.

### What an incident can become

```text
OPEN → enrichment / correlation → investigation → policy
                                           ├── RESOLVED          (full recovery signal)
                                           ├── MONITORING        (partial recovery)
                                           ├── DISPUTE_OPENED    (terminal safeguard)
                                           └── DISMISSED         (bounded no-action)
```

The legacy `ESCALATED` and `HUMAN_RESOLVED` states are retired. PayScope does not place work in an invisible manual queue: if it cannot safely proceed, it records the reason and ends in a bounded autonomous state.

## Technical guarantees

- **Tenant isolation:** every event, job, query, incident, audit entry, and agent context is organization-scoped; Supabase RLS and RPC boundaries enforce it.
- **Evidence integrity:** every enrichment fact names its source. Missing evidence stays missing—no fabricated completion or confidence.
- **Auditability:** database rules make audit entries append-only and hash-chain them per organization. Verification detects a broken chain.
- **Safe metrics:** attributed recovery requires a simulated proposal and a correlated later payment event within the valid window. It is labelled simulation evidence, not merchant revenue.
- **Browser safety:** the dashboard API is read-only. It exposes neither provider payloads, secrets, contact data, nor any approval/action endpoint.
- **Failure behavior:** invalid model output, unavailable evidence, queue retry exhaustion, duplicate delivery, policy blocks, fraud, and disputes resolve to explicit, auditable outcomes rather than unsafe execution.

## Repository map

```text
backend/
  src/pipeline/          agent prompts, orchestration, policy, correlation
  src/domain/            Zod contracts and finite action/lifecycle definitions
  src/db/                tenant-scoped repository and Supabase RPC boundary
  supabase/migrations/   ordered schema, queue, RLS, audit, and lifecycle changes
  CHECKPOINTS.md         backend completion and hosted-proof gates
frontend/
  src/                   landing experience and read-only operations dashboard
  CHECKPOINTS.md         UX, accessibility, and deployment gates
Plan.md                  canonical product, safety, and agent specification
```

## Run locally

### Prerequisites

- Node.js 20 or newer
- npm
- A Supabase project
- Razorpay API credentials and webhook secret (server only)
- Mesh model API credentials (server only)

### Backend

```bash
cd backend
copy .env.example .env
npm install
npm run build
npm run start
```

Set `PAYSCOPE_PIPELINE_ENABLED=true` only after the Supabase migrations have been applied. See [`backend/.env.example`](backend/.env.example) and the [backend deployment guide](backend/docs/PRODUCTION_RAZORPAY_DEPLOYMENT.md) for the complete server-side configuration.

### Frontend

```bash
cd frontend
copy .env.example .env
npm install
npm run build
npm run dev
```

The frontend needs only the public backend origin. It must never contain Razorpay, Supabase service-role, webhook, or Mesh secrets.

## Database and webhook setup

Apply migrations deliberately—application startup never mutates production schema:

```bash
cd backend
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Create one organization with the provided SQL/RPC workflow in the deployment guide, set its UUID as `PAYSCOPE_ORGANIZATION_ID`, then deploy the backend behind HTTPS. Configure Razorpay to send its supported payment, dispute, downtime, order, invoice, refund, settlement, fund-account, payment-link, and account events to:

```text
POST https://<your-api-domain>/webhooks/razorpay
```

Use the same webhook secret as `RAZORPAY_WEBHOOK_SECRET`; HMAC verification happens over the raw request body before the payload is trusted. `RAZORPAY_ENVIRONMENT` must match the prefix of `RAZORPAY_KEY_ID` (`rzp_live_` or `rzp_test_`).

## Verification

```bash
# backend
npm run build
npm run test:contracts
npm run test:schema
npm run test:agents
npm run test:investigation-runner
npm run test:phase3
npm run test:mvp-api
npm audit --omit=dev --audit-level=high

# frontend
npm run build
npm audit --omit=dev --audit-level=high
```

The repository’s canonical implementation details and remaining environment-level proof steps live in [`Plan.md`](Plan.md), [`backend/CHECKPOINTS.md`](backend/CHECKPOINTS.md), and [`frontend/CHECKPOINTS.md`](frontend/CHECKPOINTS.md).

## Product boundary

PayScope is built as a high-integrity autonomous operations layer, not a payment executor. Before enabling any real customer communication or financial write, the product would require a separately designed consent model, recipient resolution, delivery provider, regulatory review, live-action idempotency model, reconciliation, kill switch, and independent security assessment. None of those capabilities are hidden behind an environment variable in this repository.

---

Designed for the Razorpay AI Buildathon — make payment operations explainable, bounded, and genuinely autonomous.
