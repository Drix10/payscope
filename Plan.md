# PayScope — Locked Implementation Specification
## All decisions made. All contradictions resolved. Build in this order.

> This document supersedes all prior plan versions on every point it touches.
> Nothing starts until every "Required decision" in the review is answered here.

---

## Part 0: Decision Log

These are the four gating decisions. Rationale follows each.

### Decision 1: Vulcan data access

**Decision: Heuristic provider now. Mock/fixture provider for demo. Real provider when Razorpay supplies a supported endpoint. Never fake the tier.**

We do not have Vulcan API credentials. We do not claim to. The plan's proposed field `razorpayClient.payments.fetchPaymentDowntime()` does not exist in the SDK — this was an error and it is removed from the specification.

Instead we implement a `VulcanEnrichmentProvider` interface with three concrete adapters:

| Adapter | When active | Audit label |
|---------|-------------|-------------|
| `HeuristicEnrichmentAdapter` | All Test Mode runs | `"source":"razorpay_fields_heuristic"` |
| `FixtureEnrichmentAdapter` | Demo scenarios with signed fixtures | `"source":"fixture_signed"` |
| `VulcanDirectAdapter` | Only if/when Razorpay supplies a supported endpoint | `"source":"vulcan_direct"` |

Every enrichment record carries its source label. Every investigation prompt says which source was used. Every dashboard display shows the label. Judges who know payments will respect this more than a fake direct API call, because it shows the architecture is ready for the real thing and honest about what it has now.

The `HeuristicEnrichmentAdapter` maps these publicly documented Razorpay payment fields to enrichment outputs:

```
error_source       → failure_attribution (gateway / bank / customer / network)
error_step         → failure_stage (authorization / authentication / processing)
error_reason       → failure_reason (string, bounded vocabulary)
acquirer_data.*    → gateway-level context (auth code, rrn, present/absent)
international      → cross_border_flag (boolean)
payment.method     → instrument_type
downtime API       → gateway_health_score (live, via GET /v1/payments/downtimes)
order.amount vs    → partial_recovery_possible (boolean)
  payment.amount
payment.attempts   → prior_attempt_count (integer)
```

The downtime API (`GET /v1/payments/downtimes`) **is** a real documented endpoint and returns active and scheduled downtimes. This is the best public proxy for Vulcan's routing health score and we use it.

### Decision 2: Customer contact / communications

**Decision: Propose-only mode for the entire buildathon scope. Execution through a CommunicationsProvider interface. PayScope never holds phone numbers or delivery credentials.**

The PII contradiction is real and irresolvable without a consented communications vault. PayScope will never hold raw phone numbers. The architecture resolves this cleanly:

1. PayScope generates an **action proposal**: a fully-specified intent record containing the message type, script content, payment link URL, merchant-defined template ID, and proposed delivery timing.
2. The proposal is shown to the operator in the dashboard. The operator clicks **Approve**.
3. Approval triggers a `CommunicationsProvider` call. The provider's adapter is responsible for delivery. For the buildathon, the only registered adapter is `LoggingCommunicationsAdapter`, which logs the proposal to the audit trail and marks it `delivered:simulated`. No real message is sent.
4. A future `RazorpayPaymentLinkAdapter` can generate a Razorpay Payment Link (which is a URL, not a phone-number operation) and hand it back to the operator to copy/paste or share through their own channel.
5. Voice recovery scripts (Hinglish) are generated as text output and shown in the dashboard. They are proposals, not deliveries. This satisfies the buildathon requirement of showing the capability without requiring ElevenLabs credentials in a demo environment.

**This is not a limitation. It is correct product design.** A payment operations system that sends messages without operator approval is a liability. The buildathon explicitly asks for "compliant escalation, stopping rules, and an audit trail." Propose-only with explicit approval is all three.

### Decision 3: Frontend stack

**Decision: Keep React/Vite. No migration to Next.js.**

Next.js migration adds at minimum 2–3 days of build-config risk and zero judging benefit. The buildathon panel evaluates AI depth, working product, and measured metrics — not whether the frontend uses SSR. React/Vite deploys fine to Vercel as a static site. This is the topology.

**Deployment topology (locked):**
- Frontend: Vercel static (React/Vite build)
- Backend: VPS (Node/Express, one instance for buildathon scope; deployed with
  `npm run build` then `npm run start`)
- Database: Supabase (managed PostgreSQL)
- Queue: Supabase `queue_jobs` + VPS `QueueWorker`; `pg_cron` reclaims stale
  jobs and schedules retries. Add Inngest only if the latency target is missed.

**MVP identity boundary:** seed one demo organization and one operator only. Keep
`organization_id` on every record and test isolation with a second fixture
organization, but do not build sign-up, provisioning, OAuth, roles, or an auth
management UI. Supabase Auth supplies only the minimal operator session needed
to exercise the RLS and approval path.

### Decision 4: Demo scope

**Decision: Single internal Test Mode merchant. Multi-tenant architecture in code, single tenant in demo.**

The database schema, RLS policies, queue messages, and API routes are all written as if there are N tenants. But for the buildathon demo, exactly one `organization_id` (the test merchant's Razorpay Test Mode account) is registered. Supabase Auth is implemented (one user, one org). No Razorpay OAuth for the demo — the webhook secret is configured directly in the VPS environment. A comment in the codebase marks where OAuth would be added for production.

The isolation tests still run and still pass. They prove Org A cannot see Org B's data. The fact that in the demo Org B has no data is fine; the guarantee is what matters.

---

## Part 1: Contradiction Resolutions

Every conflict from the review resolved to a single source of truth.

### Contact attempt limits
**Resolved: max 2 per incident, 1 per 24 hours. No other number exists in the codebase.**
The number 3 is removed everywhere. One file owns this: `src/config/stopping-rules.ts`.

```typescript
// src/config/stopping-rules.ts — THE single source of truth
export const STOPPING_RULES = {
  MAX_CONTACT_ATTEMPTS_PER_INCIDENT: 2,
  MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_24H: 1,
  MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_7D: 3,
  NO_CONTACT_AFTER_DISPUTE_OPENED: true,
  NO_CONTACT_ON_FRAUD_CONFIRMED: true,
  NO_CONTACT_WITHOUT_MERCHANT_OPT_IN: true,
  AUTO_RESOLVE_RATE_CEILING_PER_ORG_PER_DAY: 0.90,  // was 0.95; tightened
  MIN_HUMAN_REVIEW_FRACTION_PER_ORG_PER_DAY: 0.10,  // new: force at least 10%
} as const;
```

### Auto-resolution floor
**Resolved: minimum 10% of incidents per org per day must reach a human operator.**
The ceiling (90%) and the floor (10%) are both hard-coded in `stopping-rules.ts` and enforced in the Policy Evaluator before any auto-action. When the floor is not yet reached in a given day, the Policy Evaluator escalates borderline incidents that would otherwise auto-resolve. This is honest and defensible: no production risk system should auto-resolve everything.

### Safety scope / external effects
**Resolved: Release 1 has no live external effects. Everything is a proposal. Execution is simulated.**
The `CommunicationsProvider` interface exists. The `LoggingCommunicationsAdapter` is the only registered implementation. No real message is sent. The plan's language about "executing" actions is replaced throughout by "proposing" and "approving."

### Stack
**Resolved: React/Vite frontend, VPS Node/Express backend, Supabase database. Documented in `DEPLOY.md`.**

### Deployment topology
**Resolved: Vercel (frontend) + VPS (backend). Inngest is a future dependency if needed. No ambiguity.**

### Audit terminology
**Resolved with exact definitions:**

| Term used | Exact guarantee |
|-----------|----------------|
| Append-only | Supabase RLS plus rejecting database triggers on `audit_entries` — SELECT and INSERT only; UPDATE and DELETE fail at the database level, not just application level |
| Hash-chained | Each `audit_entries` row stores `SHA-256(prev_entry_hash \|\| this_entry_canonical_json)` where `prev_entry_hash` is the hash of the immediately prior row **in the same `organization_id` partition** |
| Tamper-evident | A `verify_audit_chain(organization_id)` function recomputes every hash and returns any broken links |
| Event-sourced | **Dropped entirely from all documentation.** PayScope does not implement event sourcing. It implements an append-only tamper-evident audit log. These are different things. |
| Cryptographically signed | **Dropped.** We use SHA-256 hashing for tamper evidence. We do not hold private keys for signing. |

### Correlation method check bug
**Resolved: method check removed. Any payment method that covers the amount within the recovery window counts as recovery.**

```typescript
function doesSuccessCoverFailure(
  success: PaymentCapturedEvent,
  incident: OpenIncident,
): CoverageResult {
  const amountCovers = success.amount_paise >= incident.remaining_amount_paise;
  const withinWindow = (success.created_at - incident.opened_at_ms)
    <= RECOVERY_WINDOW_MS; // 72 hours for the buildathon

  if (amountCovers && withinWindow) {
    return { covered: true, remaining_paise: 0 };
  }
  if (success.amount_paise > 0 && withinWindow) {
    return {
      covered: false,
      remaining_paise: incident.remaining_amount_paise - success.amount_paise
    };
  }
  return { covered: false, remaining_paise: incident.remaining_amount_paise };
}
```

### Incident state machine
**Resolved: one canonical state machine. No ambiguity.**

```
              ┌─────────────────────────────────────┐
              │             OPEN                    │
              │  risk_tier: CRITICAL/HIGH/MEDIUM     │
              │  remaining_amount_paise: N           │
              └──────┬────────────────┬─────────────┘
                     │                │
          partial     │                │  policy evaluator
          recovery    │                │  → auto-resolve or
          received    │                │  → escalate
                     ▼                ▼
              ┌──────────┐    ┌──────────────┐
              │MONITORING│    │  ESCALATED   │
              │(reduced  │    │ (human inbox)│
              │ amount)  │    └──────┬───────┘
              └──────┬───┘          │ operator decision
                     │              ▼
                     │    ┌──────────────────┐
                     │    │  HUMAN_RESOLVED  │
                     │    │  or DISMISSED    │
                     │    └──────────────────┘
                     │
          full        │
          recovery    │
          received    ▼
              ┌──────────────┐
              │  RESOLVED    │  (terminal)
              └──────────────┘

  Any state can transition to DISPUTE_OPENED if dispute.created arrives.
  DISPUTE_OPENED is terminal for auto-resolve; always escalates to human.
```

---

## Part 2: Provider Interfaces

All external dependencies are behind interfaces. No production code imports an adapter directly. Adapters are injected at startup.

### EnrichmentProvider

```typescript
// src/providers/enrichment/interface.ts
export interface VulcanEnrichment {
  // Failure attribution — derived from error_source + error_step
  failure_attribution:
    | 'gateway_degraded'     // downtime API + error_source=gateway
    | 'issuer_timeout'       // error_source=bank, error_step=authorization
    | 'fraud_block'          // error_source=bank, error_reason contains fraud
    | 'insufficient_funds'   // error_reason=insufficient_balance
    | 'customer_drop'        // error_step=payment, user closed/timed out
    | 'routing_suboptimal'   // downtime score < threshold, no error_source=bank
    | 'unknown';

  // Gateway health — from downtime API at event timestamp
  gateway_health_score: number;         // 0=fully degraded, 1=fully healthy
  gateway_in_downtime: boolean;
  downtime_scheduled: boolean;

  // Risk signals — from payment fields
  cross_border_flag: boolean;           // payment.international
  prior_attempt_count: number;          // payment.attempts
  partial_recovery_possible: boolean;

  // Recommended retry — heuristic based on failure_attribution
  recommended_retry_method: string | null;

  // Metadata
  source: 'razorpay_fields_heuristic' | 'fixture_signed' | 'vulcan_direct';
  enriched_at: string;                  // ISO 8601
  signals_used: string[];               // which fields contributed (audit trail)
}

export interface EnrichmentProvider {
  enrich(paymentId: string, eventPayload: NormalizedEvent): Promise<VulcanEnrichment>;
  isAvailable(): Promise<boolean>;
}
```

### ModelProvider

```typescript
// src/providers/model/interface.ts
export interface ModelProvider {
  complete(
    systemPrompt: string,
    userContent: string,
    options: {
      maxTokens: number;
      responseSchema: ZodSchema;           // enforce structured output
      tenantId: string;                    // logged, never sent to model
    }
  ): Promise<{ content: unknown; usage: TokenUsage; modelId: string }>;
}

// Concrete adapters:
// AnthropicModelAdapter    — production, uses claude-sonnet-4-6
// EchoModelAdapter         — tests, returns fixture outputs without API call
```

### CommunicationsProvider

```typescript
// src/providers/communications/interface.ts
export type ActionProposal = {
  proposal_id: string;
  incident_id: string;
  organization_id: string;
  action_type:
    | 'retry_link_whatsapp'
    | 'retry_link_sms'
    | 'hinglish_voice_script'
    | 'merchant_email_notification'
    | 'merchant_webhook_notification'
    | 'flag_for_manual_review';
  content: {
    script?: string;              // voice/message content
    payment_link_url?: string;    // Razorpay Payment Link, not customer PII
    subject?: string;             // for email
    template_id?: string;         // merchant-defined template
  };
  proposed_at: string;
  approved_at: string | null;
  approved_by_user_id: string | null;
  delivery_result: DeliveryResult | null;
};

export type DeliveryResult =
  | { status: 'simulated'; note: string }         // LoggingAdapter
  | { status: 'delivered'; provider_ref: string } // future live adapter
  | { status: 'failed'; reason: string };

export interface CommunicationsProvider {
  // Records the proposal; returns immediately
  proposeAction(proposal: Omit<ActionProposal, 'proposal_id' | 'delivery_result'>):
    Promise<ActionProposal>;

  // Called after operator approval; executes delivery
  executeApprovedAction(proposalId: string, approvedByUserId: string):
    Promise<ActionProposal>;

  // Checks contact limits before proposal creation
  checkStoppingRules(
    incidentId: string,
    customerHash: string,
    organizationId: string
  ): Promise<StoppingRuleResult>;
}
```

### AgentStudioProvider

```typescript
// src/providers/agentstudio/interface.ts
// No real integration for buildathon. Adapter is NotConnectedAdapter (no-op).
// The interface specifies what would connect if Razorpay provides the extension contract.
export interface AgentStudioProvider {
  publishIncidentCard(incident: Incident, enrichment: VulcanEnrichment): Promise<void>;
  receiveOperatorCommand(command: AgentStudioCommand): Promise<void>;
  isConnected(): boolean;
}

// LoggingAgentStudioAdapter: logs what would be published; isConnected() = false
```

---

## Part 3: Database Schema

All tables are tenant-scoped. RLS is enforced at the database level. Schema is applied in order.

### Migration 001: core tables

```sql
-- All timestamps are TIMESTAMPTZ (UTC). No VARCHAR timestamps.
-- All money is INTEGER paise. No NUMERIC/DECIMAL for amounts.

CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  razorpay_key_id TEXT NOT NULL,  -- Razorpay Test Mode key ID
  customer_hash_secret TEXT NOT NULL,
  customer_hash_secret_version SMALLINT NOT NULL DEFAULT 1,
  -- webhook_secret stored in VPS env, never in DB
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  razorpay_event_id TEXT NOT NULL,   -- deduplication key
  event_type        TEXT NOT NULL,   -- payment.failed, dispute.created, etc.
  payload_hash      TEXT NOT NULL,   -- SHA-256 of raw body; raw body never stored
  normalized        JSONB NOT NULL,  -- NormalizedEvent schema
  enrichment        JSONB,           -- VulcanEnrichment, nullable until enriched
  enrichment_source TEXT,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, razorpay_event_id)  -- idempotency
);

CREATE TABLE incidents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id),
  risk_tier             TEXT NOT NULL CHECK (risk_tier IN ('CRITICAL','HIGH','MEDIUM','MONITOR')),
  status                TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','MONITORING','ESCALATED','DISPUTE_OPENED',
                      'RESOLVED','HUMAN_RESOLVED','DISMISSED')),
  total_failed_amount_paise   INTEGER NOT NULL,
  recovered_amount_paise      INTEGER NOT NULL DEFAULT 0,
  remaining_amount_paise      INTEGER GENERATED ALWAYS AS
    (total_failed_amount_paise - recovered_amount_paise) STORED,
  correlated_event_ids        UUID[] NOT NULL DEFAULT '{}',
  opened_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE investigations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  incident_id       UUID NOT NULL REFERENCES incidents(id),
  status            TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','RUNNING','COMPLETE','FAILED')),
  plan              JSONB,         -- InvestigationPlan from Supervisor
  risk_analysis     JSONB,         -- RiskAnalysis from Risk Analyst
  recovery_plan     JSONB,         -- RecoveryPlan from Recovery Planner
  policy_decision   JSONB,         -- PolicyDecision from Evaluator
  model_id          TEXT,          -- which model was used
  tokens_used       INTEGER,
  latency_ms        INTEGER,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE TABLE action_proposals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  incident_id       UUID NOT NULL REFERENCES incidents(id),
  action_type       TEXT NOT NULL,
  content           JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','simulated','cancelled_by_dispute','cancelled_by_recovery','failed')),
  proposed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at       TIMESTAMPTZ,
  approved_by       UUID REFERENCES users(id),
  delivery_result   JSONB         -- DeliveryResult, null until approved + executed
);

CREATE TABLE audit_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  incident_id         UUID REFERENCES incidents(id),
  sequence_number     BIGINT NOT NULL,  -- monotonically increasing per org
  event_type          TEXT NOT NULL,
  actor_type          TEXT NOT NULL CHECK (actor_type IN ('system','human')),
  actor_id            TEXT NOT NULL,    -- agent name or user UUID
  actor_session_hash  TEXT,             -- SHA-256 of session token, for human actors
  decision            TEXT NOT NULL,
  rationale           TEXT NOT NULL,
  confidence          NUMERIC(4,3),     -- 0.000 to 1.000
  enrichment_snapshot JSONB,            -- VulcanEnrichment at decision time
  prev_entry_hash     TEXT NOT NULL,    -- hash of prior entry in this org's chain
  entry_hash          TEXT NOT NULL,    -- SHA-256(prev_entry_hash || this canonical json)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX audit_entries_org_sequence_idx
  ON audit_entries (organization_id, sequence_number);

-- Prevent updates and deletes on audit_entries at DB level
CREATE RULE audit_no_update AS ON UPDATE TO audit_entries DO INSTEAD NOTHING;
CREATE RULE audit_no_delete AS ON DELETE TO audit_entries DO INSTEAD NOTHING;
-- Also enforced via RLS below
```

### Migration 002: RLS policies

```sql
-- Enable RLS on all tenant-scoped tables
ALTER TABLE events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE investigations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_entries   ENABLE ROW LEVEL SECURITY;

-- Service role (backend) bypasses RLS
-- Anon role (public) has no access
-- Authenticated role (operator) sees only their org

CREATE POLICY org_isolation_events ON events
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Same pattern for incidents, investigations, action_proposals, audit_entries

-- Audit entries: authenticated users can SELECT and INSERT only
CREATE POLICY audit_read ON audit_entries
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));

CREATE POLICY audit_insert ON audit_entries
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));

-- No UPDATE or DELETE policy = UPDATE and DELETE are blocked for authenticated
```

### Migration 003: supporting infrastructure

```sql
-- Contact attempt tracking (durable, not in-process)
CREATE TABLE contact_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  customer_hash   TEXT NOT NULL,   -- SHA-256(org_secret || normalized_customer_id)
  incident_id     UUID NOT NULL REFERENCES incidents(id),
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency for queue jobs
CREATE TABLE processed_jobs (
  job_key         TEXT PRIMARY KEY,   -- e.g. 'enrich:event_id' or 'investigate:incident_id'
  organization_id UUID NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  result_summary  TEXT
);

CREATE TABLE queue_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  job_type        TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','complete','failed','dead')),
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at       TIMESTAMPTZ,
  locked_by       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit chain genesis (one per org; hash = SHA-256("genesis"))
INSERT INTO audit_entries
  (organization_id, sequence_number, event_type, actor_type, actor_id,
   decision, rationale, prev_entry_hash, entry_hash, created_at)
-- Inserted once per org at creation time with well-known genesis hash
```

---

## Part 4: Queue Architecture

Webhook receipt to pipeline completion is asynchronous. The webhook endpoint must respond `200 OK` within 5 seconds of receipt (Razorpay's timeout). The full investigation pipeline takes up to 30 seconds.

### Queue design

```
Webhook received
  │ (1) verify HMAC
  │ (2) check razorpay_event_id for duplicate (SELECT from events)
  │ (3) INSERT event record (status: raw)
  │ (4) enqueue EnrichmentJob
  │ (5) return 200 OK ← must happen by here
  │
  └── EnrichmentJob
        (1) call EnrichmentProvider.enrich()
        (2) UPDATE event with enrichment
        (3) enqueue CorrelationJob
        │   on failure → DLQ with full context + retry count
        │
        └── CorrelationJob
              (1) query open incidents for this order/customer/subscription
              (2) apply state machine transitions
              (3) INSERT or UPDATE incident
              (4) enqueue InvestigationJob
              │
              └── InvestigationJob
                    (1) check processed_jobs idempotency
                    (2) run Supervisor → Risk Analyst → Recovery Planner
                    (3) run Policy Evaluator
                    (4) INSERT investigation record
                    (5) INSERT action_proposals (if any)
                    (6) INSERT audit_entry
                    (7) UPDATE incident status
```

### Job message schema

```typescript
interface BaseJob {
  job_id: string;              // UUID, idempotency key
  organization_id: string;     // enforced tenant scope
  attempt_number: number;      // 1-indexed
  max_attempts: 3;
  created_at: string;
}

interface EnrichmentJob extends BaseJob {
  type: 'enrich_event';
  event_id: string;
}

interface CorrelationJob extends BaseJob {
  type: 'correlate_event';
  event_id: string;
  enriched_event: NormalizedEvent & { enrichment: VulcanEnrichment };
}

interface InvestigationJob extends BaseJob {
  type: 'investigate_incident';
  incident_id: string;
  trigger_event_id: string;
}
```

### Failure handling

| Failure | Behaviour |
|---------|----------|
| EnrichmentProvider timeout (>5s) | Proceed with `enrichment: null, source: 'unavailable'`; investigation uses lower-confidence heuristics; flagged in audit |
| CorrelationJob failure | Retry ×3 with 1s/5s/30s backoff; after 3 failures → DLQ + alert + incident left in raw state |
| InvestigationJob failure | Retry ×3; after 3 failures → incident status = `ESCALATED` with reason `investigation_failed`; human sees it |
| Duplicate job delivery | `processed_jobs` upsert; second delivery is a no-op |
| Out-of-order events | Correlation reads all events for the incident on each run; ordering is derived from event timestamps, not queue arrival order |
| Late success event (incident already RESOLVED) | Logged, no state change, audit entry written |
| Dispute created after recovery proposal generated | DISPUTE_OPENED transition cancels pending proposals; `action_proposals` status set to `cancelled_by_dispute`; audit entry written |

### Implementation for buildathon (Supabase pg_cron approach)

For the buildathon single-instance setup, the queue is implemented as a
`queue_jobs` table. A VPS `QueueWorker` claims one job at a time with
`FOR UPDATE SKIP LOCKED` and polls every five seconds; `pg_cron` requeues stale
locks and scheduled retries. This keeps Node-only provider and LLM work out of
Postgres while avoiding Inngest unless the P99 latency target is missed.

```sql
-- VPS QueueWorker atomically claims due jobs with FOR UPDATE SKIP LOCKED.
-- pg_cron periodically requeues stale locks and schedules retries.
```

---

## Part 5: Agent Specifications

Each agent is fully specified. System prompts are final. Input/output schemas are final. Tools are exhaustive.

### 5.1 Investigation Supervisor Agent

**Model:** `claude-sonnet-4-6`
**Max input tokens:** 2,048
**Max output tokens:** 512
**Temperature:** 0 (deterministic planning)

**System prompt:**
```
You are the PayScope Investigation Supervisor. You receive a structured payment
incident record and must produce an investigation plan.

Your job: decide which sub-agents to invoke, in what order, with what specific
question to answer, and what context fields each may access.

You are NOT allowed to:
- Access any external system
- Produce final risk scores
- Recommend specific actions
- Access PII (you will not see any)
- Reference any field not present in the incident record

You MUST produce valid JSON matching the InvestigationPlan schema.
You MUST include a hypothesis for the most likely failure cause.
You MUST flag requires_human_review = true if enrichment.source = 'unavailable'.

If the incident is clearly infrastructure (gateway_health_score < 0.3 and
no fraud signals), you may set sub_agents to [] and
estimated_auto_resolvable to true. Explain in reasoning.
```

**Input schema:**
```typescript
interface SupervisorInput {
  incident: {
    id: string;
    risk_tier: string;
    status: string;
    total_failed_amount_paise: number;
    correlated_event_count: number;
    opened_at: string;
  };
  enrichment: VulcanEnrichment | null;
  merchant_policy_count: number;   // how many policies configured (not their content)
  auto_resolve_budget_remaining: number; // today's remaining auto-resolve budget
}
```

**Output schema (enforced with Zod):**
```typescript
interface InvestigationPlan {
  hypothesis: string;                          // ≤ 100 chars
  primary_failure_category:
    | 'infrastructure'
    | 'fraud_suspected'
    | 'fraud_confirmed'
    | 'customer_error'
    | 'subscription_issue'
    | 'unknown';
  sub_agents: Array<{
    agent: 'risk_analyst' | 'recovery_planner';
    question: string;                          // ≤ 80 chars
    priority: 1 | 2;
    allowed_context_fields: string[];          // explicit allowlist
  }>;
  estimated_auto_resolvable: boolean;
  requires_human_review: boolean;
  confidence: number;                          // 0–1, two decimal places
  reasoning: string;                           // ≤ 200 chars, for audit log
}
```

### 5.2 Risk Analyst Agent

**Model:** `claude-sonnet-4-6`
**Max input tokens:** 3,072
**Max output tokens:** 768
**Temperature:** 0

**System prompt:**
```
You are the PayScope Risk Analyst. You receive a payment incident with enrichment
data and must produce a structured risk analysis.

You have access to four read-only tools. You MUST use them before concluding.
All tool calls are tenant-scoped server-side; you cannot override scope.

You are NOT allowed to:
- Recommend specific actions to take
- Access PII, raw customer data, or any field not in your allowed context
- Make financial assessments (refund amounts, dispute values)
- Call any tool not in your tool list

Your analysis MUST include:
- A false_positive_cost_estimate_paise (what it costs if this is a false fraud flag)
- An evidence_strength assessment
- Explicit statement of what evidence is MISSING that would change your conclusion

When fraud_probability from enrichment is absent, state this explicitly.
Never infer fraud probability from a single data point.
```

**Tools (exhaustive — agent may call only these):**
```typescript
const RISK_ANALYST_TOOLS = [
  {
    name: 'get_incident_timeline',
    description: 'Returns all correlated events for this incident in chronological order',
    input: { incident_id: string },
    // Server enforces: incident must belong to request's organization_id
  },
  {
    name: 'get_merchant_failure_rate',
    description: 'Returns aggregated failure rate for this merchant in a time window. No PII.',
    input: { window_hours: 1 | 4 | 24 },
  },
  {
    name: 'get_network_failure_rate',
    description: 'Returns Razorpay network-level failure rate for the same gateway/period.',
    input: { gateway: string; window_hours: 1 | 4 | 24 },
  },
  {
    name: 'get_customer_incident_count',
    description: 'Returns count of prior incidents for this customer hash. Returns integer only. No PII, no amounts.',
    input: { customer_hash: string },  // agent receives hash from incident, not raw ID
  },
];
```

**Output schema:**
```typescript
interface RiskAnalysis {
  failure_root_cause:
    | 'gateway_degraded'
    | 'issuer_block'
    | 'fraud_confirmed'       // only if cross_border_flag AND high failure pattern
    | 'fraud_suspected'       // single strong signal
    | 'customer_error'
    | 'subscription_lapse'
    | 'unknown';
  evidence_strength: 'strong' | 'moderate' | 'weak';
  confidence: number;
  false_positive_cost_estimate_paise: number;
  missing_evidence: string[];          // what would change the conclusion
  chargeback_evidence_ready: boolean;
  evidence_items: string[];            // facts, NOT raw data
  recommended_action_category:         // category only; not specific action
    | 'auto_resolve_no_action'
    | 'prepare_chargeback_evidence'
    | 'flag_for_review'
    | 'propose_recovery'
    | 'escalate_fraud';
}
```

### 5.3 Recovery Planner Agent

**Model:** `claude-sonnet-4-6`
**Max input tokens:** 2,048
**Max output tokens:** 512
**Temperature:** 0

**System prompt:**
```
You are the PayScope Recovery Planner. You receive a risk analysis and merchant
configuration. You must propose a bounded recovery plan.

You may only propose actions from APPROVED_ACTIONS. You may not invent new
action types. You may not include phone numbers, emails, or any PII in your
output. Payment links are URLs only, generated by the system after your plan
is approved.

For voice/message scripts, write in plain Hindi-English mix (Hinglish) suitable
for Indian consumers. Keep scripts under 30 seconds when spoken (≈ 75 words).
Always include a polite opt-out instruction in the script.

STOPPING_RULES are already checked before your output is used. You do not
need to enforce them. State the rationale for each proposed action.

If fraud_root_cause = 'fraud_confirmed' or 'fraud_suspected', you MUST
propose only 'flag_for_review'. No outreach actions.
If a dispute is open on this incident, propose NOTHING.
```

**Approved actions (only these strings are valid):**
```typescript
const APPROVED_ACTIONS = [
  'retry_link_whatsapp',
  'retry_link_sms',
  'hinglish_voice_script',
  'merchant_email_notification',
  'merchant_webhook_notification',
  'flag_for_review',
  'prepare_chargeback_evidence',
  'auto_resolve_infrastructure',
] as const;
```

**Output schema:**
```typescript
interface RecoveryPlan {
  proposed_actions: Array<{
    action_type: typeof APPROVED_ACTIONS[number];
    rationale: string;            // ≤ 100 chars
    estimated_recovery_paise: number | null;
    script_content?: string;      // for voice/message actions, Hinglish ≤ 75 words
    requires_operator_approval: true;  // always true; cannot be false
  }>;
  no_action_reason?: string;      // if proposed_actions is empty
  recovery_probability: number;   // 0–1, agent's estimate
  confidence: number;
}
```

### 5.4 Policy Evaluator (deterministic)

No LLM. Pure TypeScript. This is the gate between analysis and action.

```typescript
// src/pipeline/policy-evaluator.ts
export function evaluatePolicy(
  incident: Incident,
  riskAnalysis: RiskAnalysis,
  recoveryPlan: RecoveryPlan,
  merchantPolicies: Policy[],
  orgDailyStats: OrgDailyStats,
  customerContactStats: CustomerContactStats,
): PolicyDecision {

  // Gate 1: Hard fraud stop
  if (riskAnalysis.failure_root_cause === 'fraud_confirmed') {
    return escalate('FRAUD_CONFIRMED_HARD_STOP', incident, riskAnalysis);
  }

  // Gate 2: Dispute open
  if (incident.status === 'DISPUTE_OPENED') {
    return escalate('DISPUTE_OPEN_HARD_STOP', incident, riskAnalysis);
  }

  // Gate 3: Auto-resolve ceiling
  if (orgDailyStats.auto_resolve_fraction >= STOPPING_RULES.AUTO_RESOLVE_RATE_CEILING_PER_ORG_PER_DAY) {
    return escalate('AUTO_RESOLVE_CEILING_REACHED', incident, riskAnalysis);
  }

  // Gate 4: Human review floor
  if (orgDailyStats.human_review_fraction < STOPPING_RULES.MIN_HUMAN_REVIEW_FRACTION_PER_ORG_PER_DAY) {
    // Force escalation until the floor is met
    return escalate('HUMAN_REVIEW_FLOOR_NOT_MET', incident, riskAnalysis);
  }

  // Gate 5: Critical tier always escalates
  if (incident.risk_tier === 'CRITICAL') {
    return escalate('CRITICAL_RISK_TIER', incident, riskAnalysis);
  }

  // Gate 6: Contact limits (checked before any outreach proposal)
  const contactLimitViolations = recoveryPlan.proposed_actions
    .filter(a => OUTREACH_ACTIONS.includes(a.action_type))
    .filter(a => !customerContactAllowed(customerContactStats, STOPPING_RULES));

  // Gate 7: Policy match required for auto-action
  const matchedPolicy = merchantPolicies.find(p => matches(p, riskAnalysis));
  if (!matchedPolicy && recoveryPlan.proposed_actions.length > 0) {
    return escalate('NO_POLICY_MATCH', incident, riskAnalysis);
  }

  // Filter to safe actions only (remove any outreach that failed contact limits)
  const permittedActions = recoveryPlan.proposed_actions
    .filter(a => !contactLimitViolations.includes(a))
    .filter(a => NON_FINANCIAL_SAFE_ACTIONS.includes(a.action_type));

  return {
    outcome: permittedActions.length > 0 ? 'auto_with_proposals' : 'auto_no_action',
    permitted_proposals: permittedActions,
    escalation_reason: null,
    matched_policy_id: matchedPolicy?.id ?? null,
    evaluated_at: new Date().toISOString(),
  };
}
```

---

## Part 6: Edge Case Designs

Every edge case from the review is handled explicitly.

| Edge case | Design |
|-----------|--------|
| Razorpay retries arrive while enrichment is running | `razorpay_event_id` UNIQUE constraint rejects the duplicate at INSERT; returns 200 (idempotent) |
| Event INSERT succeeds but queue INSERT fails | `queue_jobs` INSERT is in the same DB transaction as event status update; rolled back together |
| Queue delivery succeeds but processing fails | `processed_jobs` not written until processing completes; next delivery re-runs the job |
| Stale enrichment / provider timeout | `enrichment: null, source: 'unavailable'`; Supervisor forced to `requires_human_review: true`; investigation proceeds at lower confidence |
| Malformed provider response | Zod parsing; if invalid, enrichment = null + alert logged |
| Contradictory risk signals | Risk Analyst required to state contradiction in `missing_evidence`; evidence_strength forced to 'weak' |
| Dispute created after recovery proposal generated | Correlation engine detects DISPUTE_OPENED; sets all pending proposals status = 'cancelled_by_dispute'; audit entry written |
| Payment succeeds before recovery message is delivered | Correlation engine processes success event; incident transitions to RESOLVED; any pending proposals cancelled |
| Voice/SMS delivery succeeds but callback is lost | `delivery_result` remains null; operator can manually mark confirmed in dashboard; audit entry for manual confirmation |
| One customer across multiple merchants | `customer_hash = SHA256(organization_id + ":" + normalized_customer_id)`; tenant_id in hash prevents cross-tenant collision |
| Customer ID hashing | Per-org secret (stored in Supabase `organizations.customer_hash_secret`, not in VPS env); normalization: lowercase, trim, strip country code for phone |
| Hash secret rotation | New hash key added; old key retained for verification only; all new hashes use new key; `customer_hash_version` field on contact_attempts |
| Concurrent audit writes / hash chain ordering | `sequence_number` uses `SELECT MAX(sequence_number) FOR UPDATE` within the org partition; serialized per org |
| Audit correction | A `compensating_audit_entry` event type is inserted; original entry is never modified; the compensation references the original entry's ID |
| LLM input injection | All provider-controlled strings (error_reason, error_description) are extracted to a separate `provider_data` object, never interpolated into the main prompt string. System prompt is static. |
| Agent tool calls escaping tenant scope | All tool handlers run `WHERE organization_id = $request.organization_id`; the LLM never provides an organization_id — the server injects it |
| Contact limit counter in process memory | `contact_attempts` table in Supabase; `SELECT COUNT(*) FOR UPDATE` before any proposal; durable across restarts |
| P99 latency budget breach | Latency budget: verify(200ms) + enrich(2000ms) + correlate(500ms) + supervisor(2000ms) + analyst(3000ms) + planner(2000ms) + policy(100ms) + audit(200ms) = ~10s. Target 8s P99 requires: parallel Risk Analyst + Recovery Planner when Supervisor deems it safe; 3000ms hard timeout per LLM call; degraded mode skips planner if analyst returns estimated_auto_resolvable=true |
| Webhook fast acknowledgement | Express handler returns 200 after DB event INSERT + queue_jobs INSERT (single transaction). Max 500ms to acknowledgement. Full pipeline runs async. |
| RTO/COD scenarios | Out of scope for buildathon (order/shipping data not in event model). `fixture_cod_rto_risk.json` exists but routes to `flag_for_review` only. Documented in exception list. |
| Dispute evidence: IP/device consistency | Not available in normalized schema. Evidence package states "device signal: not available in Test Mode" explicitly. Never fabricated. |
| Dispute evidence: prior payment history | Available via `get_customer_incident_count` tool (integer only). "Customer has 7 prior successful payments" is derivable from this. |
| LLM produces action not in APPROVED_ACTIONS | Zod parse fails; investigation status = 'FAILED'; incident escalated; error logged |

---

## Part 7: Metrics Methodology

The buildathon demands honest metrics. Here is the exact methodology. It is written into `src/evaluation/` before the demo runs.

### Precision and recall (Track 02)

**Positive class definition:** An incident where at least one event has `failure_root_cause` labelled as `fraud_suspected` or `fraud_confirmed` in the fixture's ground truth label.

**Label source:** Manually curated. Each of the 500 demo fixtures has a `ground_truth_label` field in the fixture file, set by us before running evaluation. This is the training/adjudication split; the held-out set is never used to tune thresholds.

**Split:**
- 300 fixtures: development (used to tune stopping rules and prompt iterations)
- 200 fixtures: held-out evaluation (never seen during development)

**Metrics computed:**
```
TP = incidents where PayScope = fraud_suspected/confirmed AND ground_truth = fraud
FP = incidents where PayScope = fraud_suspected/confirmed AND ground_truth = not_fraud
FN = incidents where PayScope = not_fraud AND ground_truth = fraud
TN = everything else

precision = TP / (TP + FP)
recall    = TP / (TP + FN)
f1        = 2 * precision * recall / (precision + recall)

false_positive_cost_paise = FP_count * median_incident_amount_paise
```

**This is a fixture evaluation, not a real-merchant evaluation. This is stated explicitly in the demo.**

### Money recovered (Track 03)

**Attribution rule (defensible):** A payment is credited as "recovered by PayScope" only if:
1. PayScope generated a recovery proposal for the incident, AND
2. The operator approved the proposal, AND
3. A successful payment was captured within 24 hours of proposal approval, AND
4. The proposal_id appears as a tag on the Razorpay Payment Link (for retry_link actions) or the incident is correlated to the successful payment

Rule 4 requires generating Razorpay Payment Links with a `reference_id` that includes the `proposal_id`. This creates a causal chain. Without it, attribution is coincidence. This is implemented before any recovery metric is claimed.

**Computed metrics:**
```
total_at_risk_paise     = sum of remaining_amount_paise for all incidents
proposals_generated     = count of recovery proposals created
proposals_approved      = count approved by operator
attributed_recoveries   = payments matching attribution rule
recovered_paise         = sum of captured amounts in attributed recoveries
recovery_rate           = recovered_paise / total_at_risk_paise
contact_to_recover      = proposals_approved / attributed_recoveries (lower is better)
```

**Exception list (stated before metrics are shown):**
- COD/RTO incidents: not processed (no shipping data)
- Disputes opened: not eligible for recovery proposals
- Fraud_confirmed: not eligible for any outreach
- Incidents without policy match: escalated to human, not auto-recovered
- Communications delivery: simulated in buildathon (no real messages sent; no real money recovered)

The last point means the recovery rate in the demo is a **simulation on Test Mode data, not a real merchant outcome.** This is stated in bold on the metrics slide and in the README.

---

## Part 8: Dependency-Ordered Implementation Checklist

Do not start a phase until every acceptance criterion in the prior phase passes.

### Phase 1: Foundation (Days 1–5)
**Gate: live Razorpay Test Mode webhook → persisted event → health check passes**

- [ ] Supabase project created; migrations 001, 002, 003 applied and verified
- [ ] `GET /health` returns `{ database: true, queue: true, enrichment_provider: 'heuristic' }`
- [ ] Webhook endpoint verifies HMAC, inserts event record, returns 200 in < 500ms
- [ ] Duplicate `razorpay_event_id` inserts a second time → no second row; returns 200
- [ ] Malformed HMAC → 401; event not persisted; structured log entry with `rejection_reason`
- [ ] `queue_jobs` INSERT in same transaction as event INSERT confirmed with a forced failure test
- [ ] One real Razorpay Test Mode payment (any type) → event appears in Supabase

### Phase 2: Enrichment + Correlation (Days 6–9)
**Gate: event enriched with heuristic Vulcan data → correlated into incident → risk tier assigned**

- [ ] `HeuristicEnrichmentAdapter` maps all documented Razorpay error fields to `VulcanEnrichment`
- [ ] `GET /v1/payments/downtimes` called successfully; response mapped to `gateway_health_score`
- [ ] Enrichment source label `'razorpay_fields_heuristic'` appears in event record
- [ ] Enrichment timeout (> 5s) → `enrichment: null, source: 'unavailable'`; job continues
- [ ] Three related payment.failed events for same order_id → one incident, three correlated_event_ids
- [ ] `payment.captured` with full amount within window → incident status = RESOLVED
- [ ] `payment.captured` with partial amount → incident MONITORING with updated remaining_amount_paise
- [ ] `dispute.created` → incident status = DISPUTE_OPENED; risk_tier = CRITICAL
- [ ] All Fixture Set A events (infrastructure failures) produce MONITOR or MEDIUM tier incidents
- [ ] All Fixture Set B events (fraud signals) produce HIGH or CRITICAL tier incidents

### Phase 3: Agent pipeline (Days 10–16)
**Gate: investigation completes end-to-end in < 10s P99; every output validates against schema**

- [ ] Supervisor produces valid `InvestigationPlan` JSON for each fixture category
- [ ] Supervisor short-circuits to `sub_agents: []` for clear infrastructure incidents
- [ ] Risk Analyst calls each tool at least once on a non-trivial incident
- [ ] Risk Analyst output includes `false_positive_cost_estimate_paise` for every run
- [ ] Risk Analyst `missing_evidence` is non-empty when enrichment is unavailable
- [ ] Recovery Planner output contains only actions from `APPROVED_ACTIONS`
- [ ] Recovery Planner produces Hinglish voice script ≤ 75 words for subscription_lapse fixture
- [ ] Recovery Planner produces `no_action_reason` (not action proposals) for fraud_confirmed fixture
- [ ] Policy Evaluator rejects fraud_confirmed incidents at Gate 1 (zero proposals permitted through)
- [ ] Policy Evaluator enforces human review floor (10% floor test with synthetic daily stats)
- [ ] Full pipeline: `fixture_gateway_degraded.json` → `status: RESOLVED` → `auto_resolve_infrastructure` proposal → audit entry — under 10 seconds
- [ ] Full pipeline: `fixture_cross_merchant_card.json` → status: ESCALATED → audit entry — under 10 seconds
- [ ] `EchoModelAdapter` substituted → entire pipeline runs without Anthropic API call (for offline tests)

### Phase 4: Audit + operator surface (Days 17–20)
**Gate: audit chain verifies; operator sees incident + approves proposal; isolation test passes**

- [ ] `verify_audit_chain(organization_id)` returns no broken links after 50 sequential entries
- [ ] Forced duplicate sequence number → second insert rejected; first entry unchanged
- [ ] Operator dashboard loads incidents filtered to own org only
- [ ] Operator approves action proposal → `approved_at`, `approved_by` set; audit entry written
- [ ] `LoggingCommunicationsAdapter` logs proposal content; marks `delivery_result: { status: 'simulated' }`
- [ ] Isolation test: authenticated Org A user calls `GET /incidents` → zero results for Org B incidents (automated, in CI)
- [ ] Agentic Dashboard: `GET /dashboard/query` with natural language input → structured incident summary response

### Phase 5: Metrics + demo (Days 21–28)
**Gate: 200-event held-out set produces honest precision/recall; exception list is displayed**

- [ ] 300-event development set run; precision/recall computed; thresholds locked
- [ ] 200-event held-out set run; final metrics computed; results not used to adjust thresholds
- [ ] `recovered_paise` computation validated with explicit attribution chain
- [ ] Exception list rendered in dashboard and in README
- [ ] Public deployment (Vercel frontend + VPS backend) reachable from external URL
- [ ] End-to-end demo: Razorpay Test Mode failed payment → investigation_complete → escalated incident visible in operator dashboard — live, not recorded
- [ ] Pitch video: 5 minutes, matches structure in Appendix C of the prior plan
- [ ] README includes: architecture diagram, provider interface explanation, metric methodology, exception list, "what it would take to go Live Mode" section

---

## Part 9: What Stays Unchanged from Prior Architecture

- PayScope does not issue refunds, modify subscriptions, debit any account, or hold customer payment credentials.
- PayScope does not contact customers directly. Action proposals are the boundary.
- PayScope does not use Razorpay Live Mode. All testing is Test Mode only.
- PayScope does not fine-tune on merchant data. Inference only.
- Every LLM call is bounded in tokens, schema-validated on output, and logged in the investigation record.
- All external side effects require explicit operator approval. No silent actions.
- The audit log is the authoritative record. The dashboard is a view over it.

---

## Part 10: Files to Create (in dependency order)

```
src/
├── config/
│   └── stopping-rules.ts              ← Phase 1, Day 1. Single source of truth.
├── providers/
│   ├── enrichment/
│   │   ├── interface.ts               ← Phase 1, Day 2
│   │   ├── heuristic-adapter.ts       ← Phase 2, Day 6
│   │   └── fixture-adapter.ts         ← Phase 2, Day 7
│   ├── model/
│   │   ├── interface.ts               ← Phase 3, Day 10
│   │   ├── anthropic-adapter.ts       ← Phase 3, Day 10
│   │   └── echo-adapter.ts            ← Phase 3, Day 10
│   ├── communications/
│   │   ├── interface.ts               ← Phase 4, Day 17
│   │   └── logging-adapter.ts         ← Phase 4, Day 17
│   └── agentstudio/
│       ├── interface.ts               ← Phase 4, Day 17
│       └── logging-adapter.ts         ← Phase 4, Day 17
├── db/
│   ├── migrations/
│   │   ├── 001_core_tables.sql        ← Phase 1, Day 1
│   │   ├── 002_rls_policies.sql       ← Phase 1, Day 1
│   │   └── 003_support_tables.sql     ← Phase 1, Day 1
│   └── client.ts                      ← Phase 1, Day 1
├── pipeline/
│   ├── webhook-handler.ts             ← Phase 1, Day 3
│   ├── enrichment-job.ts              ← Phase 2, Day 6
│   ├── correlation-engine.ts          ← Phase 2, Day 7
│   │   └── state-machine.ts
│   ├── investigation-supervisor.ts    ← Phase 3, Day 10
│   ├── risk-analyst.ts               ← Phase 3, Day 12
│   ├── recovery-planner.ts           ← Phase 3, Day 14
│   ├── policy-evaluator.ts           ← Phase 3, Day 15
│   └── audit-writer.ts               ← Phase 4, Day 17
├── queue/
│   └── pg-queue.ts                   ← Phase 1, Day 4
├── api/
│   ├── incidents.ts                  ← Phase 4, Day 18
│   ├── proposals.ts                  ← Phase 4, Day 18
│   ├── audit.ts                      ← Phase 4, Day 19
│   └── dashboard-query.ts            ← Phase 4, Day 19
├── evaluation/
│   ├── metrics.ts                    ← Phase 5, Day 21
│   ├── attribution.ts                ← Phase 5, Day 21
│   └── run-evaluation.ts             ← Phase 5, Day 22
└── fixtures/
    ├── set-a-infrastructure/          ← Phase 2, Day 9
    ├── set-b-fraud/                   ← Phase 2, Day 9
    ├── set-c-recovery/                ← Phase 3, Day 16
    └── set-d-edge-cases/              ← Phase 3, Day 16
```

---

*All blockers resolved. All contradictions eliminated. Build in phase order.*
*Next document: the first fixture schema and the stopping-rules.ts file.*
