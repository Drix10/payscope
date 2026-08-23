# PayScope — autonomous payment resolution

## Product contract

PayScope is an autonomous payment-resolution agent for Razorpay merchants. It receives signed payment signals, correlates them into tenant-scoped incidents, investigates their cause, chooses the best permitted recovery path, executes that path through provider adapters, verifies the resulting provider receipts, and records the entire decision and execution trail.

The dashboard is an execution ledger, not an operations inbox. A merchant uses it to understand what the AI did, what happened next, and the current result. The agent owns investigation, decisioning, outreach, recovery operations, dispute evidence, reconciliation, retries, and terminal incident handling. There is no approval queue or manual-resolution workflow.

## What autonomous execution means

For each incident, PayScope may autonomously:

1. Create or recover a Razorpay Payment Link with a causal PayScope reference.
2. Resolve an opted-in recipient email in a server-side vault and deliver one recovery email through Nodemailer over SMTP. Razorpay's own Payment Link notifications are disabled for this command.
3. Record SMTP acceptance separately from recovery. An ambiguous SMTP result is unreconciled and is never blindly resent; a verified payment-link payment is the recovery proof.
4. Capture an authorized payment, issue a refund, cancel an obsolete link, or create a new recovery link when the deterministic execution policy authorizes that Razorpay operation.
5. Prepare and submit a dispute-evidence package where the configured provider API supports submission.
6. Switch an incident into monitoring, resolved, dismissed, or dispute lifecycle states based on verified provider evidence.
7. Reconcile asynchronous Razorpay and communications callbacks back to the original action, then retry, compensate, or terminalize without waiting for an operator.

All external operations are merchant-authorized, tenant-scoped, and recorded with a concrete provider outcome. The model selects from structured capabilities; it never invents a recipient, an API operation, an amount, or an execution credential. Each provider capability has its own idempotency/reconciliation semantics—PayScope must not assume one generic HTTP header makes every provider write idempotent.

## End-to-end flow

```text
Razorpay event
  → HMAC verification + allowlist + durable tenant-scoped intake
  → leased queue job + enrichment + correlation
  → Supervisor → Risk Analyst → Recovery Planner (strict structured outputs)
  → deterministic execution policy
  → idempotent action command
  → Razorpay / Nodemailer SMTP adapter
  → provider receipt + callback reconciliation
  → execution audit, lifecycle update, metrics, dashboard
```

1. **Intake** verifies the raw-body HMAC, deduplicates provider events, normalizes privacy-reduced payment facts, and enqueues work atomically.
2. **Enrichment and correlation** record the provenance of every fact and join only same-organization events into one incident, including late capture, partial recovery, disputes, and duplicate delivery.
3. **Agent planning** turns a bounded incident context into a structured plan, causal risk analysis, alternative hypotheses, concrete action prerequisites, expected outcome, and no-action criteria.
4. **Policy** evaluates merchant configuration, payment state, fraud/dispute rules, contact consent, value limits, retry budget, provider capability, and execution idempotency. It is deterministic and is the authority that issues an action command.
5. **Execution** uses a typed adapter with an immutable PayScope command key. Every operation stores a request fingerprint, provider request ID, provider-specific idempotency data where supported, state, next reconciliation time, and an allowed terminal/compensation rule.
6. **Reconciliation** consumes Razorpay callbacks and matches them to an action. SMTP acceptance is not inbox delivery; only a verified `payment_link.paid` / payment event confirms recovery. It decides whether the action is complete, has an unreconciled email result, needs a permitted retry, or has reached terminal failure.
7. **Audit and dashboard** distinguish evidence, AI inference, policy decision, dispatched command, provider receipt, reconciliation result, and incident lifecycle. The browser remains read-only.

## Agent system and structured outputs

| Layer | Required structured output | Authority |
|---|---|---|
| Supervisor | objectives, evidence priorities, sub-agent plan, constraints, no-action criteria | directs bounded analysis only |
| Risk Analyst | causal narrative, confidence rationale, alternatives, evidence gaps, risk class, tool trace | reads tenant-scoped facts only |
| Recovery Planner | finite action type, prerequisites, expected outcome, amount/reference requirements, copy intent, compensation strategy | chooses from capability enum only |
| Execution Policy | exact permit/restrict/no-action result, validated action parameters, budget and consent gates | emits an executable command only when all gates pass |
| Execution Adapter | provider operation, PayScope command key, provider-specific idempotency data, normalized response | performs one configured provider capability |
| Reconciler | callback verification, action match, retry/compensation/final lifecycle result | closes the execution loop |

Every model call uses provider-enforced JSON Schema plus local Zod validation. Webhook fields, message text, gateway responses, and attached evidence are untrusted data—not instructions. Prompts must separate facts from inference, list alternatives, explain confidence, respect action preconditions, and return an explicit no-action plan when necessary information is unavailable.

## Bounded incident memory

PayScope keeps compact, organization-scoped memory for the incident rather than an unbounded chat transcript. Memory stores redacted event summaries, completed investigations, execution receipts, and the fact that a recovery email was accepted/rejected/unreconciled. The direct agent receives only the highest-priority twelve non-expired records; every record is treated as untrusted data, never as an instruction.

Recipient email, SMTP responses that could identify a mailbox, raw provider payloads, credentials, and message HTML are excluded from model memory and browser projections. The schema reserves `customer_reply` memory for a later authenticated inbound-email integration; the email-only MVP does not claim to receive or interpret customer replies.

### Prompt contract

- The model cannot select a tenant, recipient identifier, secret, credential, arbitrary URL, arbitrary payment amount, or arbitrary API endpoint.
- The Recovery Planner receives a capability catalogue and returns only valid enum values with arguments whose schemas are defined in code.
- Recipient resolution occurs after policy approval in a server-side encrypted contact adapter. The model receives only capability eligibility and delivery state.
- For recovery email, the model returns copy intent only. The server renders a fixed escaped template with a verified Razorpay URL, fixed `MAIL_FROM`, and recipient resolved from the encrypted vault; model output can never set SMTP headers, HTML, attachments, or the destination address.
- Financial commands require canonical payment/order/link IDs from verified Razorpay evidence, amount rules derived by policy, and a command key bound to the incident/action.
- The model must state a recovery hypothesis, evidence supporting it, alternative explanations, prerequisites, expected provider receipt, and compensation path for every proposed action.

## Execution capabilities

| Capability | Adapter operation | Completion evidence | Compensation / terminal rule |
|---|---|---|---|
| `deliver_recovery_link_email` | one immutable Phase-A saga: Razorpay Payment Link create/reuse with an action-derived unique reference of at most 40 characters and `notify=false`, then Nodemailer SMTP email | persisted link ID, SMTP `messageId`/accepted/rejected response, and `payment_link.*` / payment reconciliation | unknown link create reconciles by its stored reference; after the durable SMTP send-start marker, a timeout/connection loss becomes `unreconciled` and is never blindly resent |
| `capture_authorized_payment` | Razorpay capture only for canonical `authorized` payment and exact permitted amount/currency | fetch payment state plus `payment.captured` reconciliation | unknown response must fetch/reconcile before another capture; capture is never compensated by a reverse operation |
| `refund_payment` | Razorpay normal/instant refund with immutable body, receipt, and `X-Refund-Idempotency` key | refund ID, amount, and `refund.*` reconciliation | same-body retry only with the same key; a refund is never reversed by PayScope |
| `submit_dispute_evidence` | Razorpay document upload followed by contest submission with `action=submit` | document IDs, dispute response, and dispute-event reconciliation | retry only before provider deadline; preserve immutable evidence package and never resubmit an already-final dispute |
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
          SMTP ACCEPTED / PENDING_RECEIPT             MONITORING                                  TERMINAL NO-ACTION
              │                                             │                                            │
              ├─ verified recovery ───────────────→ RESOLVED                                      DISMISSED
              ├─ partial recovery ────────────────→ MONITORING                                    DISPUTE_OPENED
              └─ provider failure ──→ retry / compensate / FAILED_EXECUTION
```

Provider-facing action state is independent from incident lifecycle: `queued`, `dispatching`, `accepted`, `unreconciled`, `confirmed`, `retry_scheduled`, `compensating`, `failed`, or `cancelled`. Every transition is append-only audited and keyed by action ID and provider receipt.

`accepted` means SMTP accepted an email or Razorpay accepted a command; it is not a recovery claim. SMTP does not provide inbox-delivery proof. `confirmed` means the action-specific terminal fact was reconciled: for example a captured payment, processed refund, paid Payment Link, or submitted dispute contest. `unreconciled` means a provider response was ambiguous and a duplicate write/contact must not be attempted blindly.

## Data, tenancy, and audit invariants

- Every event, queue job, agent context, action, provider receipt, callback, query, and audit entry is organization-scoped under RLS.
- Secrets, recipient details, and provider credentials remain server-only. The encrypted recipient vault and direct-execution tables keep RLS enabled with no browser/authenticated table policy; the dashboard exposes only presentation-safe API projections and redacted execution evidence.
- Encrypted raw callbacks are retained only for the configured verification/audit window and then purged by a tenant-scoped retention job; normalized redacted evidence remains for the audit trail.
- Database-level idempotency prevents duplicate external commands when workers retry, restart, or receive duplicate webhooks.
- A durable outbox separates policy approval from provider dispatch; an inbox records and deduplicates callbacks before reconciliation. An unknown write result always becomes a reconciliation job before any repeat command.
- Provider callbacks are inherently asynchronous and may be duplicated or arrive out of order. Reconciliation is therefore monotonic and evidence-driven, never dependent on callback arrival order; a newer verified canonical-provider read wins over a stale callback.
- Financial operations on one canonical payment are serialized under a database payment-scoped lock. Capture and refund cannot be dispatched concurrently for the same payment, and an active dispute blocks a new refund command.
- Audit entries are append-only and hash-chained per organization. `verify_audit_chain()` detects mutation or sequence breaks.
- Recovery metrics use a causal action → provider receipt → Razorpay payment/refund/capture chain. They report verified merchant outcome, unknown where evidence is incomplete, and never treat an uncorrelated event as recovery.

## Pre-implementation decisions and execution sequence

### Decisions locked before code

1. **MVP outreach is email only.** Phase A delivers one end-to-end recovery path: Payment Link creation with Razorpay `notify` disabled, then one Nodemailer SMTP recovery email. SMS, WhatsApp, voice, merchant webhook, and Razorpay-managed notifications are explicitly out of MVP scope.
2. **Recipient data has a separate source of truth.** Existing normalized Razorpay events contain hashes, not sendable email addresses. A merchant-controlled encrypted email vault is required before direct email can be enabled. The AI receives eligibility and delivery state, never email data.
3. **Command identity is immutable.** `action_id` is generated before policy persistence. `command_key = organization_id + capability + action_id` is unique. Payload hash, provider object IDs, and outcome are immutable after first dispatch; retries reference the same command, not a fresh proposal.
4. **Payment Link reference is compact.** `ps_<uuid-without-hyphens>` is 35 characters and fits Razorpay's 40-character unique `reference_id` limit. The exact reference is stored before dispatch and is never regenerated on retry.
5. **Provider-specific write handling is explicit.** Razorpay refunds use `X-Refund-Idempotency` with the same request body on retry. Capture and Payment Link create do not receive blind retries after network ambiguity: the worker fetches/reconciles provider state under the stored canonical object/reference first.
6. **Email has one authority per action.** A recovery link email is sent only by the Nodemailer SMTP adapter; the associated Razorpay Payment Link sets `notify=false`. The policy records that choice before dispatch.
7. **Compensation is capability-specific.** Expired links may be cancelled; the MVP does not automatically retry an SMTP send after its durable send-start marker; refunds, captures, and submitted disputes are never “reversed” by a generic compensation routine.
8. **Webhook verification supports secret rotation.** Callback verification must try the active and still-valid previous secret, retain the verified secret version with the inbox row, and deduplicate by provider event ID before enqueueing reconciliation.
9. **The MVP has one configured merchant, not a user-management product.** No authentication or multi-merchant control plane is added for this build. Every table and command remains organization-scoped so the later control plane does not require a data-model rewrite.
10. **A Payment Link is not identity proof.** Customer contact supplied during a payment-link checkout is never treated as an identity assertion. Attribution requires the stored causal reference plus a verified provider payment/link event.
11. **Legacy removal is a forward migration, not history rewriting.** Applied Supabase migration files remain immutable. A new compatible migration retires simulated RPCs/statuses, source code switches atomically to the new projection, and only then are unused runtime files and unreachable branches deleted.
12. **SMTP cannot prove delivery or provide universal idempotency.** A successful SMTP response means the relay accepted the message, not that the recipient inbox received it. A connection failure after send starts is `unreconciled`, not a retry: a second email risks duplicate contact.
13. **Memory is bounded and evidence-led.** Incident memory is capped at 4 KB per durable record and 1.2 KB per record returned to the model, redacted, tenant-scoped, and ordered by importance/recency. It improves later investigation context but never overrides canonical Razorpay evidence or deterministic policy.
14. **A queued email command must be fresh and still eligible.** Before any Payment Link call, the worker resolves the still-consented encrypted recipient; an unavailable/invalid recipient or command records a terminal no-send result rather than retrying. Immediately before the irreversible SMTP send marker, the database rechecks that the incident is non-terminal, recipient consent remains active, and the command is younger than 24 hours. A failed recheck records a no-send terminal outcome; a pre-existing send marker is always treated as ambiguous and never resent.

### Phased implementation

1. **Phase A — shared execution core:** apply existing migrations; add actions/outbox/receipts/inbox/reconciliation tables; DB-enforced transition graph; command-key uniqueness; encrypted raw callback storage with retention; monotonic reconciliation; payment-scoped locking; observability; encrypted email vault; and Payment Link create/reuse/cancel plus the Nodemailer SMTP email adapter. Deploy it capability-disabled until the compatible API projection and worker are live, then remove simulation runtime code through a forward migration.
2. **Phase B — financial operations:** add read-before-write canonical payment fetch, exact capture validation, native refund idempotency, refund/capture reconciliation, amount/currency handling, and action-specific failure rules.
3. **Phase C — disputes:** add document ingestion/hash, Razorpay document upload, dispute contest submission, deadline state machine, and immutable evidence package.
4. **Phase D — product and proof:** rebuild dashboard metrics/projections for execution state, run adversarial suites, exercise each active capability in a dedicated merchant configuration, and capture the complete audit/reconciliation evidence.

## Technology choices

| Need | Choice | Why |
|---|---|---|
| API and workers | Existing Node.js 20 + TypeScript + Express process | Keeps one VPS runtime and the current deployment model. |
| Durable command queue | Existing Supabase Postgres queue plus transactional outbox/inbox RPCs | Avoids adding Redis/BullMQ; `FOR UPDATE SKIP LOCKED` lease claims already exist. |
| Persistence | Supabase Postgres + RLS + append-only audit hash chain | Reuses tenant isolation and durable migrations already in the repository. |
| Execution contracts | Zod + `zod-to-json-schema` + TypeScript discriminated unions | One schema drives Mesh structured output, policy checks, adapters, and API projections. |
| AI | Existing Mesh structured-output adapter | Supervisor/Risk/Recovery remain reasoning components; deterministic policy creates commands. |
| Razorpay | Typed server-side REST client built on native `fetch` | Keeps per-operation timeout, response parsing, idempotency, redaction, and reconciliation behavior explicit. |
| Recovery email | `nodemailer` over an SMTP relay with a verified merchant sender domain | The only outreach adapter in this MVP. A reusable pooled transporter gives bounded connections, startup health verification, graceful shutdown, and vendor-neutral SMTP configuration. |
| Recipient/config encryption | Versioned envelope encryption using Node `crypto` AES-256-GCM with a VPS-held master key; move to cloud KMS when the deployment has one | Supports encrypted recipient records and key rotation without adding an unrelated database. |
| Observability | `pino` redacted JSON logs, `prom-client` metrics, and OpenTelemetry traces | Correlates action ID across webhook, outbox, provider request, callback, and reconciliation. |
| Validation | Node built-in test runner plus existing contract/fixture scripts; add provider sandbox contract tests | Keeps current test workflow while adding recorded HTTP fixtures and callback replay tests. |

## Completion gates

The direct-execution release is complete only when:

1. Every action capability has a typed adapter, policy gate, idempotency key, durable outbox, provider receipt model, callback verifier, reconciliation path, retry policy, compensation rule, and adversarial test.
2. The hosted environment proves signed event → investigation → action command → provider receipt → callback reconciliation → final lifecycle → intact audit chain for each configured capability.
3. The dashboard clearly presents what the AI executed and its final provider-confirmed result without exposing secrets or recipient data.
4. The README, deployment guide, environment examples, and both checkpoints describe the same autonomous execution model.
