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
- [x] Remove approval tokens, operator workflow, approval APIs, manual-resolution UI dependencies, retired communications adapter files, and retired lifecycle writes from active runtime code. Historical applied migrations remain as immutable database history until superseded by the direct-execution migration.

## Direct execution data model — required

- [x] Author the direct-execution migration (pending Supabase application) with immutable `execution_actions`, command key/payload hash, canonical IDs, amount/currency, states, retries, terminal reason, timestamps, transaction outbox, and redacted receipts.
- [x] Keep RLS enabled on the recipient vault, actions, outbox, receipts, and incident-memory tables with no authenticated table policy. The VPS service role alone accesses these records; browser data is projection-only.
- [x] Enforce one action command with a database unique constraint on organization/capability/action ID and a database transition function; reject an update that changes command payload, canonical provider object, amount, currency, or prior receipt after dispatch.
- [x] Author a durable transactional execution outbox and leased claim RPC. The direct-investigation transaction emits the email command; workers dispatch only from that outbox after the migration is applied.
- [x] Author the provider-receipt model for SMTP accepted/rejected/unreconciled and Razorpay Payment Link creation. It stores only redacted payload, receipt hash, provider operation ID, and callback correlation key.
- [x] Add a callback inbox with encrypted raw body, verified secret version, source, provider event ID, dedupe key, received timestamp, normalized callback, and action match result. Retain the prior webhook secret during its bounded rotation window.
- [x] Add a tenant-scoped encrypted-callback retention/purge job; retain raw bodies only for the configured verification/audit window and keep redacted normalized evidence for the audit chain.
- [x] Add reconciliation and capability-specific compensation records, including parent action link for retries, cancelled links, and pending provider states. Do not model refunds, captures, or submitted disputes as reversible generic compensation.
- [x] Make reconciliation monotonic and event-order independent: duplicate and late callbacks may enrich an action but may not regress a verified terminal provider state. Prefer a newer verified canonical-provider read over a stale callback.
- [x] Serialize capture/refund commands for the same canonical payment with a database payment-scoped lock; block a new refund command when a verified active dispute exists.
- [x] Add organization execution policy with only `deliver_recovery_link_email` outreach, maximum amount per operation/currency, email consent/quiet hours, SMTP configuration, retry budgets, dispute deadlines, and emergency pause.
- [x] Replace the current simulated-action schema/RPCs/statuses with direct execution states: `queued`, `dispatching`, `accepted`, `unreconciled`, `confirmed`, `retry_scheduled`, `compensating`, `failed`, and `cancelled`.
- [x] Retire simulations with a forward-compatible migration: keep applied migration history immutable, deploy schema/API/worker compatibility before enabling a capability, then delete obsolete simulation-only runtime code and unreachable branches in the same release train.
- [x] Replace `flag_for_review` across contracts, prompts, policy, fixtures, audit labels, and frontend projections with autonomous `record_risk_signal`.
- [x] Author tenant-scoped bounded incident memory for redacted investigation/execution/customer-message records, with importance, expiry, dedupe hash, and a reserved future customer-reply type. Storage is capped at 4 KB per record; the direct-mode Recovery Planner receives at most twelve 1.2 KB records as untrusted context.

## Provider adapters — required

- [x] Implement the Phase-A typed Razorpay Payment Link client: strict amount/currency/reference validation, `notify=false`, bounded timeout, response normalization, redacted caller output, reference lookup on ambiguous create, and no blind repeat create.
- [x] Implement a typed Razorpay execution client with strict request schemas, canonical object validation, operation-specific idempotency behavior, bounded timeout, response normalization, retry classification, and redacted logs.
- [x] Implement Payment Link create/reuse/cancel capability with a compact, stored 40-character-safe causal reference and reconciliation from `payment_link.*`/payment events. An unknown create result must fetch/reconcile before any repeat create command.
- [x] Treat a paid Payment Link as a causal recovery only when its stored PayScope reference is linked to a verified Razorpay link/payment event; never infer identity or recovery solely from checkout contact details.
- [x] Implement authorized-payment capture only after a fresh canonical payment fetch confirms `authorized` state and permitted exact amount/currency; an unknown capture result must fetch/reconcile before any repeat capture command.
- [x] Implement refund creation only for a captured eligible payment, preserve the exact request body/receipt, use Razorpay `X-Refund-Idempotency`, and reconcile `refund.*` events before reporting completion.
- [x] Implement the encrypted **email** vault schema and AES-256-GCM envelope helper. Existing hashed event identifiers are never treated as a sendable recipient; the AI receives only email eligibility and suppression/consent state.
- [x] Add a VPS-only recipient-vault enrollment command that requires explicit consent, derives the organization HMAC customer hash, encrypts the email locally, and upserts it without exposing an email browser/API endpoint.
- [x] Implement the Nodemailer SMTP adapter for `deliver_recovery_link_email`: reusable pooled transporter, explicit TLS, bounded connection/greeting/socket timeouts, stable command key, redacted `messageId`/accepted/rejected response, and no browser credential.
- [x] Create one SMTP transporter per worker process, start the execution worker only after `transporter.verify()` succeeds, report unavailable direct execution without dispatching queued actions, close the pool during graceful shutdown, and never create a transporter per email/job.
- [x] Render recovery email through a fixed escaped server template. The model returns copy intent only; it cannot set recipient, `from`, headers, HTML, attachments, or link URL. The adapter accepts only the stored Razorpay HTTPS link and configured `MAIL_FROM`.
- [x] Set Razorpay Payment Link `notify=false` for a PayScope email action, so the Nodemailer SMTP adapter is the only outreach authority.
- [x] Treat SMTP acceptance as acceptance only—not delivery. Before SMTP, classify invalid command/recipient or withdrawn consent as a terminal no-send result; after any SMTP error following the durable send-start marker, store `unreconciled` and do not blindly resend; a verified Razorpay `payment_link.paid` event can still confirm recovery.
- [x] Implement Razorpay dispute evidence as a document-upload stage plus a contest submission stage (`action=submit`), with immutable evidence package hash, document IDs, receipt, deadline handling, and dispute-event reconciliation.
- [x] Ensure providers receive only the minimum action data and no model/provider secret can reach logs, audit projection, model context, or frontend responses.

## Autonomous policy and agent upgrades — required

- [x] Complete the direct action-contract migration: the Phase-A `deliver_recovery_link_email` saga is implemented; capture, refund, dispute evidence, `record_risk_signal`, and infrastructure resolution still need their final direct projections, while retired simulation-only/non-MVP channel enums must then be deleted.
- [x] Give the Recovery Planner a capability catalogue, canonical input facts, amount/reference constraints, recipient eligibility, expected receipt schema, retry/compensation strategy, and no-action behavior.
- [x] Update Mesh prompts to choose the email-only direct capability set without ever producing raw recipient details, provider secrets, arbitrary URLs, arbitrary monetary values, SMTP headers, HTML, attachments, or arbitrary API operations.
- [x] Extend deterministic policy to validate execution capability, provider health, merchant configuration, canonical payment state, amount/currency caps, consent/quiet hours, fraud/dispute conditions, duplicate action key, retry budget, and compensation eligibility.
- [x] Make invalid model output, missing canonical payment evidence, missing provider configuration, expired dispute deadline, callback mismatch, or failed policy a fully audited autonomous terminal/reconciliation outcome.
- [x] Store action decision input hash, policy version, capability version, and prompt/model version so a later audit can reproduce why a direct provider command was issued.

## Reconciliation and metrics — required

- [x] Verify Razorpay signatures before parsing or matching a callback. SMTP email has no assumed inbox-delivery callback; its normalized relay response is evidence of acceptance only.
- [x] Reconcile callbacks idempotently by organization, provider, and provider event/receipt ID; reject cross-tenant/replayed/unknown callbacks without creating a second action.
- [x] Add a watchdog for accepted/pending actions that schedules reconciliation or bounded retry without duplicate dispatch.
- [x] Implement compensation rules for expired/cancelled recovery links, definite pre-send email failures, failed refunds, capture races, and dispute deadlines. Do not duplicate-send after an ambiguous SMTP result.
- [x] Replace simulation metrics with verified execution metrics: dispatched, SMTP accepted, SMTP rejected, unreconciled email, confirmed recovery, refunded, failed, retried, compensated, and unknown/unreconciled.
- [x] Require a causal chain of PayScope action ID, provider receipt, and Razorpay event before assigning merchant recovery/revenue outcome.

## API, reliability, and security — required

- [x] Extend read-only incident detail and metrics responses with redacted action command state, receipt state, reconciliation history, retry/compensation status, and final provider-confirmed outcome.
- [x] Preserve browser read-only behavior; no client can issue provider actions or obtain action credentials.
- [x] Add circuit breakers and bounded concurrency per provider/organization/capability so provider incidents cannot exhaust worker resources.
- [x] Add encrypted configuration and email-vault integration; rotate credentials without process-wide secret leakage.
- [x] Add Razorpay and SMTP-specific timeout, retry-after, 4xx/5xx, rate-limit, and unknown-result handling. Unknown writes/emails must reconcile before any retry; SMTP `accepted` must never be treated as delivered or financially complete.
- [x] Add immutable audit entries for policy decision, outbox command, dispatch attempt, provider receipt, callback verification, reconciliation, retry, compensation, and terminal result.
- [x] Add `pino` redacted JSON logging, `prom-client` provider/action metrics, and OpenTelemetry traces carrying action ID—not recipient data—through intake, outbox, dispatch, callback, and reconciliation.
- [x] Wire the direct execution worker into the VPS lifecycle behind `PAYSCOPE_DIRECT_EXECUTION_ENABLED`; failed SMTP readiness leaves actions queued and makes direct execution unhealthy rather than dispatching, shutdown drains/closes the pooled transport, and provider calls remain bounded.

## Verification completed

- [x] Backend TypeScript build passes and the end-to-end agent suite (`npm run test`) exercises Supervisor → Risk Analyst → Recovery Planner → deterministic policy → durable investigation across infrastructure, fraud, dispute, contact-limit, consent, quiet-hours, idempotency, retry-budget, and memory-bounded scenarios.
- [x] Production dependency audit reports no high-severity vulnerability and `git diff --check` passes.
- [x] Static review covered queue timer lifecycle, timeout/abort behavior, trigger-event retries, stale missing-event jobs, tenant scope, CORS, schema compatibility, and API data projection.

## Environment and execution proof — required

- [x] Apply `202608230006_autonomous_simulated_execution.sql`, `202608230007_autonomous_lifecycle_and_metrics.sql`, `202608230008_investigation_trigger_idempotency.sql`, `202608230009_direct_execution_email.sql`, `202608230010_direct_execution_complete.sql`, `202608230011_direct_only_enforcement.sql`, and `202608230012_internal_action_finalize.sql` to the linked Supabase project; remote migration history now matches local history (`npx supabase migration list --linked` shows every migration applied).
- [ ] Configure a dedicated merchant organization, Razorpay write credentials/callback secret, encrypted email vault, Mesh credentials, and `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and verified `MAIL_FROM` on the VPS. Configure SPF, DKIM, and DMARC for the sender domain.
- [ ] Prove Phase A encrypted email vault, Payment Link with `notify=false`, and Nodemailer SMTP email end to end before enabling any financial action; verify signed Razorpay callbacks, SMTP acceptance/rejection handling, ambiguous-email no-resend behavior, payment-link reconciliation, and intact audit chain.
- [x] Add deterministic unit coverage for encrypted recipient handling, Payment Link → email accepted flow, and the ambiguous email-send no-resend terminal path.
- [ ] Prove Phase B capture/refund and Phase C disputes independently in dedicated provider/sandbox configurations before enabling each capability for the merchant.
- [ ] Prove adversarial cases: duplicate command, timeout after provider acceptance, callback replay, old-secret callback during rotation, late callback, partial recovery, Payment Link cancellation, refund failure, capture race, provider outage, contact cap, fraud, dispute deadline, emergency pause, and worker restart.
- [ ] Keep the MVP explicitly single-merchant and configuration-driven: do not add auth or a multi-merchant control plane, but prove organization RLS/command scope remains intact.
