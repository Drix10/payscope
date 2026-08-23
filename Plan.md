# PayScope — autonomous payment operations

## Product contract

PayScope is an autonomous payment-operations system for Razorpay merchants. It consumes signed Razorpay events, turns related payment signals into tenant-scoped incidents, investigates them with bounded AI agents, applies deterministic safety policy, and records the outcome in a tamper-evident audit chain.

The dashboard is deliberately read-only. It answers: **what happened, what the AI concluded, why that conclusion was safe, and what the system recorded**. It is not an operator inbox and contains no approval, manual-resolution, outreach, or financial-action controls.

Razorpay credentials may target either `live` or `test` environments. This changes only the source of incoming webhook and enrichment data. It does not change PayScope's safety boundary: this version never sends a customer message, calls a customer, stores customer contact details, captures or refunds money, changes a Razorpay resource, or claims simulated recovery as merchant revenue.

## End-to-end operation

```text
Razorpay event
  → HMAC verification + allowlist + size limit
  → tenant-scoped idempotent durable intake
  → leased queue job with bounded retries/backoff
  → enrichment + correlation
  → structured AI investigation
  → deterministic policy evaluation
  → simulated action record or autonomous no-action outcome
  → append-only hash-chained audit trail
  → read-only API and dashboard
```

1. **Intake** verifies the raw-body HMAC before parsing, accepts only the supported event allowlist, deduplicates the provider event, normalizes a privacy-reduced payload, and atomically persists an event and queue job.
2. **Enrichment** reads documented Razorpay fields and the downtime endpoint. Each fact carries its source (`razorpay_fields_heuristic`, `vulcan_direct`, `fixture_signed`, or `unavailable`); unavailable enrichment remains explicit evidence, never a fabricated fact.
3. **Correlation** joins only same-organization events into an incident and handles duplicate delivery, late capture, partial recovery, full recovery, dispute transitions, and terminal cancellation.
4. **Investigation** runs the Supervisor, Risk Analyst, and Recovery Planner. Their outputs are strict schemas, not free-form instructions.
5. **Policy** is the final authority. AI output cannot bypass contact limits, fraud/dispute stops, merchant opt-in, evidence requirements, auto-resolution ceiling, or the finite action allowlist.
6. **Execution** is idempotent and non-financial: a permitted action becomes an automatically recorded simulation. Blocked or degraded cases become an audited autonomous no-action outcome; PayScope never waits for manual approval.
7. **Audit and display** expose presentation-safe facts, model reasoning, policy gates, action result, lifecycle, and chain integrity without raw provider payloads or customer identifiers.

## Autonomous lifecycle

```text
signed event → OPEN → enrich / correlate → investigate → policy
                                  │                         │
                                  ├─ full capture ───────────┴→ RESOLVED
                                  ├─ partial recovery ───────┴→ MONITORING
                                  ├─ dispute ────────────────┴→ DISPUTE_OPENED
                                  └─ unsafe / insufficient ─┴→ DISMISSED
```

`ESCALATED` and `HUMAN_RESOLVED` are retired. Historical rows remain readable only to preserve audit history; new pipeline writes never create those states.

## Agent system

| Layer | Structured responsibility | Hard boundary |
|---|---|---|
| Supervisor | objectives, evidence priorities, bounded sub-agent plan, constraints, no-action criteria | cannot access tools, PII, tenant identity, or choose an action |
| Risk Analyst | causal narrative, confidence rationale, alternatives, evidence gaps, risk category | only four server-scoped read tools; no customer data or action recommendation |
| Recovery Planner | finite action proposals, preconditions, expected outcomes, Hinglish copy when applicable | cannot invent action types, transmit communications, or execute money movement |
| Policy Evaluator | deterministic permit/restrict/no-action decision and gate trace | cannot call a model or override stopping rules |
| Simulation adapter | idempotent action-result record and audit event | cannot reach Razorpay write APIs or customer channels |

### Prompt and output requirements

Every model call receives only a minimum, presentation-safe incident context. Payload text is treated as untrusted data, never as instructions. Prompts explicitly require the model to:

- output strict JSON matching the supplied schema and nothing else;
- separate observed evidence from inference and list meaningful alternatives;
- name confidence rationale and missing evidence instead of manufacturing certainty;
- select only supplied finite enums and never create tools, tenants, recipients, links, or financial actions;
- return a bounded no-action plan when policy-relevant evidence is absent, conflicting, fraudulent, disputed, or unsafe;
- omit PII, raw payloads, secrets, payment credentials, and customer outreach targets.

Schema validation occurs at the model boundary. Invalid output produces an audited safe no-action lifecycle outcome, not a retry that silently changes the decision. Existing persisted investigations are normalized through a compatibility reader so the dashboard remains available during staged deployments.

## Deterministic stopping rules

`backend/src/config/stopping-rules.ts` is the single source of truth:

```ts
MAX_CONTACT_ATTEMPTS_PER_INCIDENT: 2
MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_24H: 1
MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_7D: 3
NO_CONTACT_AFTER_DISPUTE_OPENED: true
NO_CONTACT_ON_FRAUD_CONFIRMED: true
NO_CONTACT_WITHOUT_MERCHANT_OPT_IN: true
AUTO_RESOLVE_RATE_CEILING_PER_ORG_PER_DAY: 0.90
```

The former human-review floor is removed. A policy block records its exact reason and moves to a bounded autonomous outcome; it never creates an invisible manual queue.

## Permitted action records

The Recovery Planner can propose only these records:

- `retry_link_whatsapp`, `retry_link_sms`, `hinglish_voice_script`
- `merchant_email_notification`, `merchant_webhook_notification`
- `flag_for_review`, `prepare_chargeback_evidence`, `auto_resolve_infrastructure`

Each is a simulated record in this version. Action content, evidence, policy rationale, preconditions, expected outcome, and simulation result are visible in the incident detail. No record implies delivery, financial execution, or a real recovery.

## Data, tenancy, and audit invariants

- Every database query, queue job, incident, audit entry, and model context is organization-scoped.
- RLS and tenant-filtered RPCs are the persistence boundary; browser routes are read-only.
- Payload storage is minimized; frontend responses use reduced presentation models and hashed identifiers.
- Queue claims use leases and bounded retries. Duplicate jobs and duplicate webhooks converge on the same durable records.
- Audit entries are append-only under database rules and hash-chained per organization. `verify_audit_chain()` detects mutation or sequence breaks. This is tamper-evident, not blockchain and not a claim of cryptographic signing by PayScope.
- Recovery metrics require a causal chain: simulated proposal → correlated later payment event in the valid window. They are labelled simulation evidence and never real-revenue proof.

## Deployment contract

- **Backend:** Node.js 20+ VPS process using `npm run build` then `npm run start`, behind HTTPS. `PAYSCOPE_PIPELINE_ENABLED=true` enables durable work only after database migrations are applied.
- **Frontend:** Vite static build on Vercel, configured only with the public API origin.
- **Database:** Supabase migration history is applied deliberately with `npx supabase db push`; migrations are never run automatically at application boot.
- **Secrets:** Razorpay key, webhook secret, Supabase service key, and Mesh credentials remain server-only. No frontend environment variable may contain any of them.

## Completion gates

Source implementation is complete only when the following remain true together:

1. TypeScript builds, contract tests, adversarial fixture tests, CORS test, dependency audit, and dead-code search pass.
2. The hosted environment proves signed event → durable queue → correlation → schema-validated agent pipeline → policy → simulation/no-action → intact audit chain.
3. Browser QA proves every dashboard interaction is read-only and desktop/mobile layouts preserve the evidence, decision, policy, and audit record.
4. The README, deployment guide, environment examples, and both checkpoints accurately describe the same bounded autonomous system.
