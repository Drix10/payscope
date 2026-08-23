# PayScope backend — autonomous execution checklist

**Canonical specification:** [`../Plan.md`](../Plan.md). This checklist separates completed incident intelligence from the direct provider execution work that remains. No box describes a provider capability as complete until a real adapter, receipt, reconciliation path, and adversarial verification exist.

## Completed foundation

- [x] Verify raw Razorpay HMAC before parsing, limit accepted payloads/events, deduplicate provider events, minimize normalized data, and atomically enqueue tenant-scoped durable work.
- [x] Implement leased queue claiming, bounded retry/backoff, timer cleanup, stale-job dead-lettering, terminal cancellation, trigger-event idempotency, and organization-scoped correlation.
- [x] Record enrichment provenance and use documented downtime data; represent unavailable enrichment as missing evidence rather than an invented signal.
- [x] Run Supervisor, Risk Analyst, and Recovery Planner through Mesh structured outputs plus local Zod validation and shared deadlines.
- [x] Require Supervisor objectives/evidence priorities/constraints/no-action criteria; Risk causal reasoning/confidence/alternatives/tool trace; and Recovery prerequisites/expected outcome.
- [x] Treat external payload text as untrusted data and enforce tenant isolation, no-secret model context, read-tool scoping, request timeouts, and output validation.
- [x] Keep deterministic policy evaluation, contact caps, fraud/dispute stops, merchant opt-in, organization budget, append-only audit chain, RLS, and read-only browser API.
- [x] Remove approval tokens, operator workflow, approval APIs, manual-resolution UI dependencies, retired communications adapter files, and retired lifecycle writes from active runtime code.

## Direct execution data model — required

- [ ] Add an `execution_actions` table with immutable action ID, organization/incident/proposal IDs, capability, canonical provider object IDs, normalized amount/currency, request fingerprint, idempotency key, command payload hash, state, retry count, next attempt, terminal reason, and timestamps.
- [ ] Add a durable transactionally-written outbox. Policy emits one outbox command in the same transaction as its action decision; workers dispatch only from that outbox.
- [ ] Add a provider-receipt model storing provider, provider request/operation ID, accepted/delivered/confirmed state, redacted receipt payload, receipt hash, and callback correlation key.
- [ ] Add a callback inbox with raw-body signature result, source, dedupe key, received timestamp, normalized callback, and action match result.
- [ ] Add reconciliation and compensation records, including a parent action link for retries, reversals, canceled links, and failed or pending refunds.
- [ ] Add organization execution policy with explicit configured capabilities, maximum amount per operation/currency, contact consent and quiet hours, delivery provider configuration, retry budgets, dispute deadlines, and emergency pause.
- [ ] Replace the current simulated-action schema/RPCs/statuses with direct execution states: `queued`, `dispatching`, `accepted`, `delivered`, `confirmed`, `retry_scheduled`, `compensating`, `failed`, and `cancelled`.
- [ ] Replace `flag_for_review` across contracts, prompts, policy, fixtures, audit labels, and frontend projections with autonomous `record_risk_signal`.

## Provider adapters — required

- [ ] Implement a typed Razorpay execution client with strict request schemas, canonical object validation, idempotency headers/keys, bounded timeout, response normalization, retry classification, and redacted logs.
- [ ] Implement Payment Link create/reuse/cancel capability with `ps:<action-id>` causal reference and reconciliation from `payment_link.*`/payment events.
- [ ] Implement authorized-payment capture with payment state/amount/currency validation and reconciliation from `payment.captured`.
- [ ] Implement refund creation with payment state/amount/currency validation and reconciliation from `refund.*` events.
- [ ] Implement a configured WhatsApp/SMS adapter with encrypted server-side recipient resolution, stable idempotency key, provider message ID, delivery callbacks, and bounded retry policy.
- [ ] Implement a configured Hinglish voice adapter with recipient resolution, call receipt, terminal call callback, redial policy, and compliance metadata.
- [ ] Implement merchant email/webhook adapters with signed outbound payloads, delivery receipt, retry semantics, and no browser credential.
- [ ] Implement dispute-evidence submission where configured provider APIs support it, with immutable evidence package hash, receipt, deadline handling, and callback reconciliation.
- [ ] Ensure providers receive only the minimum action data and no model/provider secret can reach logs, audit projection, model context, or frontend responses.

## Autonomous policy and agent upgrades — required

- [ ] Extend action contracts to `create_recovery_link`, direct delivery, capture, refund, dispute evidence, `record_risk_signal`, and infrastructure resolution; delete retired simulation-only enums.
- [ ] Give the Recovery Planner a capability catalogue, canonical input facts, amount/reference constraints, recipient eligibility, expected receipt schema, retry/compensation strategy, and no-action behavior.
- [ ] Update Mesh prompts to choose direct execution capabilities without ever producing raw recipient details, provider secrets, arbitrary URLs, arbitrary monetary values, or arbitrary API operations.
- [ ] Extend deterministic policy to validate execution capability, provider health, merchant configuration, canonical payment state, amount/currency caps, consent/quiet hours, fraud/dispute conditions, duplicate action key, retry budget, and compensation eligibility.
- [ ] Make invalid model output, missing canonical payment evidence, missing provider configuration, expired dispute deadline, callback mismatch, or failed policy a fully audited autonomous terminal/reconciliation outcome.
- [ ] Store action decision input hashes and policy version so a later audit can reproduce why a direct provider command was issued.

## Reconciliation and metrics — required

- [ ] Verify signatures for Razorpay and every configured delivery/voice callback before parsing or matching a callback.
- [ ] Reconcile callbacks idempotently by organization, provider, and provider receipt ID; reject cross-tenant/replayed/unknown callbacks without creating a second action.
- [ ] Add a watchdog for accepted/pending actions that schedules reconciliation or bounded retry without duplicate dispatch.
- [ ] Implement compensation rules for expired/cancelled recovery links, delivery failures, failed refunds, capture races, and dispute deadlines.
- [ ] Replace simulation metrics with verified execution metrics: dispatched, provider-accepted, delivered, confirmed recovery, refunded, failed, retried, compensated, and unknown/unreconciled.
- [ ] Require a causal chain of PayScope action ID, provider receipt, and Razorpay event before assigning merchant recovery/revenue outcome.

## API, reliability, and security — required

- [ ] Extend read-only incident detail and metrics responses with redacted action command state, receipt state, reconciliation history, retry/compensation status, and final provider-confirmed outcome.
- [ ] Preserve browser read-only behavior; no client can issue provider actions or obtain action credentials.
- [ ] Add circuit breakers and bounded concurrency per provider/organization/capability so provider incidents cannot exhaust worker resources.
- [ ] Add encrypted configuration and recipient vault integration; rotate credentials without process-wide secret leakage.
- [ ] Add provider-specific timeout, retry-after, 4xx/5xx, rate-limit, and unknown-result handling. Unknown write results must reconcile before any retry.
- [ ] Add immutable audit entries for policy decision, outbox command, dispatch attempt, provider receipt, callback verification, reconciliation, retry, compensation, and terminal result.

## Verification completed

- [x] Backend TypeScript build, contract/schema, webhook, queue, enrichment, correlation, model, agent, investigation, API, dashboard, evaluation, attribution, fixture, CORS, and phase pipeline checks pass for the existing intelligence foundation.
- [x] Production dependency audit reports no high-severity vulnerability and `git diff --check` passes.
- [x] Static review covered queue timer lifecycle, timeout/abort behavior, trigger-event retries, stale missing-event jobs, tenant scope, CORS, schema compatibility, and API data projection.

## Environment and execution proof — required

- [ ] Apply `202608230006_autonomous_simulated_execution.sql`, `202608230007_autonomous_lifecycle_and_metrics.sql`, and `202608230008_investigation_trigger_idempotency.sql`, then add/apply the direct-execution migration set before redeploying the VPS.
- [ ] Configure a dedicated merchant organization, Razorpay write credentials, callback secrets, delivery/voice provider credentials, encrypted recipient vault, Mesh credentials, and provider-specific CORS/webhook origins on the VPS.
- [ ] Prove Payment Link, delivery, capture, refund, merchant notification, and dispute-evidence flows end to end with signed callbacks, receipt reconciliation, idempotent duplicate delivery, and intact audit chain.
- [ ] Prove adversarial cases: duplicate command, timeout after provider acceptance, callback replay, late callback, partial recovery, payment-link cancellation, refund failure, capture race, provider outage, contact cap, fraud, dispute, emergency pause, and worker restart.
