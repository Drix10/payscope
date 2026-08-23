# PayScope — autonomous payment resolution

## Product contract

PayScope is an autonomous payment-resolution agent for Razorpay merchants. It receives signed payment signals, correlates them into tenant-scoped incidents, investigates their cause, chooses the best permitted recovery path, executes that path through provider adapters, verifies the resulting provider receipts, and records the entire decision and execution trail.

The dashboard is an execution ledger, not an operations inbox. A merchant uses it to understand what the AI did, what happened next, and the current result. The agent owns investigation, decisioning, outreach, recovery operations, dispute evidence, reconciliation, retries, and terminal incident handling. There is no approval queue or manual-resolution workflow.

## What autonomous execution means

For each incident, PayScope may autonomously:

1. Create or recover a Razorpay Payment Link with a causal PayScope reference.
2. Resolve the recipient in a server-side vault and deliver the selected WhatsApp, SMS, voice, email, or merchant-webhook communication.
3. Retry a transient provider delivery with the same idempotency key and stop once a provider receipt is final.
4. Capture an authorized payment, issue a refund, cancel an obsolete link, or create a new recovery link when the deterministic execution policy authorizes that Razorpay operation.
5. Prepare and submit a dispute-evidence package where the configured provider API supports submission.
6. Switch an incident into monitoring, resolved, dismissed, or dispute lifecycle states based on verified provider evidence.
7. Reconcile asynchronous Razorpay and communications callbacks back to the original action, then retry, compensate, or terminalize without waiting for an operator.

All external operations are merchant-authorized, tenant-scoped, idempotent, receipt-verified, and recorded with a concrete provider outcome. The model selects from structured capabilities; it never invents a recipient, an API operation, an amount, or an execution credential.

## End-to-end flow

```text
Razorpay event
  → HMAC verification + allowlist + durable tenant-scoped intake
  → leased queue job + enrichment + correlation
  → Supervisor → Risk Analyst → Recovery Planner (strict structured outputs)
  → deterministic execution policy
  → idempotent action command
  → Razorpay / communications provider adapter
  → provider receipt + callback reconciliation
  → execution audit, lifecycle update, metrics, dashboard
```

1. **Intake** verifies the raw-body HMAC, deduplicates provider events, normalizes privacy-reduced payment facts, and enqueues work atomically.
2. **Enrichment and correlation** record the provenance of every fact and join only same-organization events into one incident, including late capture, partial recovery, disputes, and duplicate delivery.
3. **Agent planning** turns a bounded incident context into a structured plan, causal risk analysis, alternative hypotheses, concrete action prerequisites, expected outcome, and no-action criteria.
4. **Policy** evaluates merchant configuration, payment state, fraud/dispute rules, contact consent, value limits, retry budget, provider capability, and execution idempotency. It is deterministic and is the authority that issues an action command.
5. **Execution** uses a typed adapter with an immutable idempotency key. Every operation stores a request fingerprint, provider request ID, receipt, status, next reconciliation time, and compensation rule.
6. **Reconciliation** consumes Razorpay and delivery-provider callbacks, verifies their signatures, matches them to an action, and decides whether the action is complete, needs a bounded retry, needs compensation, or has reached a terminal failure.
7. **Audit and dashboard** distinguish evidence, AI inference, policy decision, dispatched command, provider receipt, reconciliation result, and incident lifecycle. The browser remains read-only.

## Agent system and structured outputs

| Layer | Required structured output | Authority |
|---|---|---|
| Supervisor | objectives, evidence priorities, sub-agent plan, constraints, no-action criteria | directs bounded analysis only |
| Risk Analyst | causal narrative, confidence rationale, alternatives, evidence gaps, risk class, tool trace | reads tenant-scoped facts only |
| Recovery Planner | finite action type, prerequisites, expected outcome, amount/reference requirements, copy intent, compensation strategy | chooses from capability enum only |
| Execution Policy | exact permit/restrict/no-action result, validated action parameters, budget and consent gates | emits an executable command only when all gates pass |
| Execution Adapter | provider operation, idempotency key, provider receipt, normalized status | performs one configured provider capability |
| Reconciler | callback verification, action match, retry/compensation/final lifecycle result | closes the execution loop |

Every model call uses provider-enforced JSON Schema plus local Zod validation. Webhook fields, message text, gateway responses, and attached evidence are untrusted data—not instructions. Prompts must separate facts from inference, list alternatives, explain confidence, respect action preconditions, and return an explicit no-action plan when necessary information is unavailable.

### Prompt contract

- The model cannot select a tenant, recipient identifier, secret, credential, arbitrary URL, arbitrary payment amount, or arbitrary API endpoint.
- The Recovery Planner receives a capability catalogue and returns only valid enum values with arguments whose schemas are defined in code.
- Recipient resolution occurs after policy approval in a server-side encrypted contact adapter. The model receives only capability eligibility and delivery state.
- Financial commands require canonical payment/order/link IDs from verified Razorpay evidence, amount rules derived by policy, and an idempotency key bound to the incident/action.
- The model must state a recovery hypothesis, evidence supporting it, alternative explanations, prerequisites, expected provider receipt, and compensation path for every proposed action.

## Execution capabilities

| Capability | Adapter operation | Completion evidence | Compensation / terminal rule |
|---|---|---|---|
| `create_recovery_link` | Razorpay Payment Link create/reuse with `ps:<action-id>` reference | link ID and provider receipt | cancel unused/expired link; reconcile `payment_link.*` events |
| `deliver_retry_link_whatsapp` / `deliver_retry_link_sms` | configured delivery provider send | accepted provider message ID and delivery callback | bounded retry with the same idempotency key; terminal delivery failure |
| `place_hinglish_recovery_call` | configured voice provider call | call ID and terminal call status | bounded redial policy; terminal no-contact result |
| `notify_merchant_email` / `notify_merchant_webhook` | merchant channel delivery | provider receipt or signed webhook acknowledgement | retry according to provider semantics |
| `capture_authorized_payment` | Razorpay authorized-payment capture | Razorpay capture receipt and `payment.captured` reconciliation | no duplicate capture; terminal provider refusal |
| `refund_payment` | Razorpay refund create | refund ID, amount, and `refund.*` reconciliation | no duplicate refund; reconcile pending/failed refund |
| `submit_dispute_evidence` | configured dispute-evidence submission | provider case/receipt | retry only before provider deadline; preserve immutable evidence package |
| `record_risk_signal` / `resolve_infrastructure` | internal lifecycle command | durable audit entry and lifecycle update | terminal internal action |

The retired `flag_for_review` name is replaced by `record_risk_signal`; it does not create a human task.

## Autonomous execution policy

`backend/src/config/stopping-rules.ts` remains the source of truth for contact caps and organization automation budget. The direct-execution policy extends it with merchant-specific operation permissions, consent/quiet-hour configuration, maximum financial amount, currency constraints, provider availability, dispute deadlines, retry/compensation policies, and an organization emergency pause.

```ts
MAX_CONTACT_ATTEMPTS_PER_INCIDENT: 2
MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_24H: 1
MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_7D: 3
NO_CONTACT_AFTER_DISPUTE_OPENED: true
NO_CONTACT_ON_FRAUD_CONFIRMED: true
NO_CONTACT_WITHOUT_MERCHANT_OPT_IN: true
AUTO_RESOLVE_RATE_CEILING_PER_ORG_PER_DAY: 0.90
```

A policy block is still an autonomous decision: the agent records the reason, schedules the relevant reconciliation when appropriate, and sets a final lifecycle state. It does not create hidden manual work.

## Lifecycle and execution state

```text
OPEN → enriched / correlated → investigating → policy evaluated → EXECUTING
                                                            │
              ┌─────────────────────────────────────────────┼────────────────────────────────────────────┐
              ▼                                             ▼                                            ▼
          DELIVERED / PENDING_RECEIPT                 MONITORING                                  TERMINAL NO-ACTION
              │                                             │                                            │
              ├─ verified recovery ───────────────→ RESOLVED                                      DISMISSED
              ├─ partial recovery ────────────────→ MONITORING                                    DISPUTE_OPENED
              └─ provider failure ──→ retry / compensate / FAILED_EXECUTION
```

Provider-facing action state is independent from incident lifecycle: `queued`, `dispatching`, `accepted`, `delivered`, `confirmed`, `retry_scheduled`, `compensating`, `failed`, or `cancelled`. Every transition is append-only audited and keyed by action ID and provider receipt.

## Data, tenancy, and audit invariants

- Every event, queue job, agent context, action, provider receipt, callback, query, and audit entry is organization-scoped under RLS.
- Secrets, recipient details, and provider credentials remain server-only. The dashboard exposes only presentation-safe status and redacted execution evidence.
- Database-level idempotency prevents duplicate external commands when workers retry, restart, or receive duplicate webhooks.
- A durable outbox separates policy approval from provider dispatch; an inbox records and deduplicates callbacks before reconciliation.
- Audit entries are append-only and hash-chained per organization. `verify_audit_chain()` detects mutation or sequence breaks.
- Recovery metrics use a causal action → provider receipt → Razorpay payment/refund/capture chain. They report verified merchant outcome, unknown where evidence is incomplete, and never treat an uncorrelated event as recovery.

## Implementation sequence

1. Apply and verify the existing durable queue/lifecycle migrations, then add direct-execution action, outbox, receipt, callback-inbox, and reconciliation migrations.
2. Replace the current internal action recorder with typed Razorpay, communications, and voice adapters; add encrypted server-side recipient resolution.
3. Extend contracts, Mesh prompts, policy evaluator, model tests, and fixtures for capability selection, amount/reference validation, provider receipts, retries, and compensation.
4. Add webhook/callback verification for each configured provider and reconcile all asynchronous state transitions.
5. Rebuild dashboard cards, metrics, landing copy, and API projections around dispatched, delivered, confirmed, retried, compensated, and failed execution states.
6. Prove each capability end-to-end against dedicated merchant configuration, including duplicate delivery, provider timeout, partial success, late callback, callback replay, canceled link, refund failure, capture race, dispute deadline, and worker restart.

## Completion gates

The direct-execution release is complete only when:

1. Every action capability has a typed adapter, policy gate, idempotency key, durable outbox, provider receipt model, callback verifier, reconciliation path, retry policy, compensation rule, and adversarial test.
2. The hosted environment proves signed event → investigation → action command → provider receipt → callback reconciliation → final lifecycle → intact audit chain for each configured capability.
3. The dashboard clearly presents what the AI executed and its final provider-confirmed result without exposing secrets or recipient data.
4. The README, deployment guide, environment examples, and both checkpoints describe the same autonomous execution model.
