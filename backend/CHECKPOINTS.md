# PayScope backend — locked MVP execution checklist

**Canonical specification:** [`../Plan.md`](../Plan.md). This checklist replaces
the legacy PaymentOps delivery record. It is a build checklist, not a claim that
the work below has shipped.

## MVP boundary

- Build a Test Mode, one-merchant demo with multi-tenant fields, database RLS,
  and a two-organization isolation test.
- Use one seeded demo operator/session only. Do **not** build user management,
  onboarding, OAuth, roles, billing, Live Mode, or production operations.
- Enrichment is labelled `razorpay_fields_heuristic` or `fixture_signed`; never
  imply direct Vulcan access without a supported Razorpay API.
- Communications are proposal-only. The sole MVP adapter records a simulated
  delivery after operator approval; no customer phone number, credentials, SMS,
  WhatsApp, email, or voice call is sent.
- The system never refunds, captures a payment, changes a subscription, or
  debits an account.

Do not start a phase until its previous gate is green. Preserve the current raw
HMAC verification and safe correlation behaviour while replacing the old
single-process persistence/scheduling path.

## Mandatory legacy removal and replacement map

The new MVP must not run two incompatible payment-operations systems in
parallel. Before declaring any phase complete, remove the superseded behaviour,
its dead API/UI contract, its tests, and its documentation—or explicitly adapt
it to the canonical contract below.

| Legacy item | Required disposition | Replacement / proof |
|---|---|---|
| Process-local event, incident, idempotency, rate, and debounce state | **Deleted.** No in-memory persistence fallback remains. | Supabase records + `queue_jobs` + durable idempotency and worker tests. |
| Old `PaymentOpsEvent`/`PaymentOpsIncident` types and repository contract | **Deleted.** | Canonical tenant-scoped schemas and a source search with no old consumers. |
| `rules-v1` investigation as the product path | **Deleted.** Echo remains only as the named deterministic model adapter. | Supervisor/Risk/Recovery/Policy pipeline persists an investigation for every fixture. |
| Old auto-policy endpoints and direct automatic operator actions | **Deleted.** | Proposal API, deterministic policy audit, and simulated-approval test. |
| Memory/Supabase dual persistence fallback | Remove the in-memory Test Mode fallback once Phase 1 is enabled. Fail closed/readiness-unhealthy when durable storage is unavailable. | Restart and database-outage tests; `/health` reports durable readiness. |
| Old history import/demo/replay semantics | **Deleted.** | Route-contract tests: no bypass path exists. |
| Old audit-log shape and mutable upsert behaviour | **Deleted with the legacy migrations.** | Append-only, per-org chained `audit_entries` and verification test. |
| Old README, deployment guide, environment examples, and smoke-test claims | Update or delete after their replacement is tested. | Documentation search contains no claim of browser API tokens, live automation, direct Vulcan access, or obsolete routes. |

**Removal verification:** before the final demo, run a repository-wide search for
the retired route/type/provider names, exercise every surviving route, and
verify each one uses the tenant-scoped queue pipeline rather than a legacy
memory path.

- [x] Replace the root README and both deployment guides with the locked
  Test-Mode/VPS/Vercel architecture. They no longer advertise memory fallback,
  Live Mode, `rules-v1`, browser bearer tokens, automatic actions, or a Vercel
  backend. The final source search found those names only in this explicit
  removal record, never in runnable or public product code.
- [x] Replace backend and frontend `.env.example` templates and migrate the
  ignored local `.env` files to the canonical Test Mode keys. Retired browser
  token, checkout, OpenAI, and public-URL keys have no remaining consumer.
- [x] Initialize the Supabase CLI configuration at `backend/supabase` with the
  configured remote project reference and canonical migrations enabled. The
  authenticated project link is local CLI state; no account credential is
  stored in the repository.
- [x] Link the CLI to the configured hosted project, apply the foundation and
  audit-schema repair migrations, seed the Test Mode organization, and verify
  its database-generated audit genesis entry with `payscope_verify_audit_chain`.
  The hosted Org A/Org B RLS test now also passes with disposable operators.
- [x] Make the VPS database client compatible with Node 20/21 by injecting the
  `ws` transport into Supabase Realtime (which initializes eagerly even though
  this MVP makes no Realtime subscription). The no-native-WebSocket regression
  test constructs the client without making a network request; it also passed
  under Node 21.7.3, the deployed VPS runtime.
- [x] Delete the old PaymentOps/direct-checkout API routes, service, types,
  persistence repository, migrations, and smoke test after the `/api/mvp`
  replacement workspace built. The durable webhook is now the only event
  authority and the smoke test proves an old route is `404`.

## Phase 0 — repo and contract reset

- [x] Record the canonical source-path mapping: backend code lives under
  `backend/src`, database migrations under `backend/supabase/migrations`, and
  signed fixtures under `backend/src/fixtures`; production instructions live in
  `backend/docs/PRODUCTION_RAZORPAY_DEPLOYMENT.md` and the root README.
- [x] Remove or revise backend documentation and API descriptions that promise
  the old `rules-v1`-only workflow, browser access token, or automatic policy
  action semantics. The remaining legacy-name references are this explicit
  deletion record, not runnable or public product documentation.
- [x] Define Zod schemas and TypeScript types for normalized events, heuristic
  enrichment, incident state, investigations, plans, analyses, recovery plans,
  policy decisions, proposals, queue jobs, and audit entries. Runtime contract
  tests now cover valid policy/proposal/audit rows as well as invalid event and
  incident invariants; evaluation labels remain a Phase 5 fixture concern.
- [x] Add a configuration module with explicit Test Mode guards, timeouts,
  token budgets, queue lock timeout, recovery window (72 hours), and the one
  `STOPPING_RULES` source file.
- [x] Put the exact limits in `stopping-rules.ts`: 2 contacts/incident, 1
  contact/customer/24h, 3 contacts/customer/7d, fraud/dispute/opt-in stops,
  90% daily auto-resolve ceiling, and 10% daily human-review floor.
- [x] Add environment validation for Supabase, Razorpay Test Mode, optional
  Mesh model access, seed organization, worker identity, and token-gated demo
  operator approval. The retired model provider has no remaining runtime
  configuration path.
- [x] Enforce Razorpay Test Mode at server startup and replace timestamp-array
  request limits with capped constant-space token buckets; cleanup removes idle
  identities, so a request flood cannot grow rate-limit memory by request
  count.
  No browser environment variable may contain a provider secret.
- [x] Remove the unused static bearer-token path from the backend as well as
  the browser. The current MVP has no authentication transport; its read-only
  demo API is limited by exact CORS origin and request throttling until the
  planned minimal operator session is implemented.
- [x] Inventory every current route, service, repository method, environment
  variable, test, and dashboard response. The replacement map above and the
  package/source search record the deleted PaymentOps, checkout, bearer-token,
  old-policy, and memory-persistence paths; every surviving server route is
  either `/health`, `/webhooks/razorpay`, or tenant-scoped `/api/mvp`.

**Gate:** strict TypeScript build passes and every new contract has unit tests
for valid and invalid payloads.

## Phase 1 — durable intake, tenant data, and queue

- [x] Create ordered migrations for organizations, minimal demo users, events,
  incidents, investigations, action proposals, audit entries, contact attempts,
  processed jobs, and queue jobs.
- [x] Include all canonical database constraints: tenant foreign keys, unique
  `(organization_id, razorpay_event_id)`, incident amount invariants, proposal
  status values, unique audit sequence per organization, and queue-job state.
- [x] Store only raw-payload SHA-256, normalized data, and bounded provider
  fields. Do not persist raw webhook body or customer contact details.
- [x] Derive each stored customer reference with the organization-specific
  customer-hash secret via HMAC-SHA-256; raw customer identifiers cannot be
  recovered or correlated across organizations from the normalized event.
- [x] Enable RLS for every tenant table; deny anonymous access; apply the
  organization policy for the minimal authenticated operator path; test it with
  Org A and Org B fixture data. The hosted opt-in integration test created two
  Test Mode fixture operators and proved that Org A cannot read Org B's row.
- [x] Add append-only audit safeguards: no updates/deletes, canonical JSON
  serialization, per-organization genesis record, transactionally allocated
  sequence numbers, previous hash, entry hash, and `verify_audit_chain`. The
  hosted chain was reverified after synthetic durable webhook processing.
- [x] Seed one Test Mode organization, one demo operator, and two isolated test
  organizations without creating a user-management product. The opt-in RLS
  test reuses two dedicated audit-backed Test Mode organizations and removes
  its randomized temporary users and mutable fixture rows in `finally`.
- [x] Refactor the webhook handler to verify raw HMAC before parsing, map the
  configured Test Mode webhook secret to the demo organization, and use the
  event ID as a tenant-scoped idempotency key. A deployed synthetic Test Mode
  webhook and a duplicate delivery both passed this exact path.
- [x] Bound the broader Razorpay subscription after HMAC verification: only
  payment failures/captures, `order.paid`, and dispute-opening events
  (`created`, `under_review`, and `action_required`) enter the durable pipeline.
  Correctly signed unsupported events return `200` with
  `ignored: true` without needing an event ID, persisting data, or queuing work.
- [x] Add the feature-gated `PAYSCOPE_MVP_PIPELINE` webhook path. Its isolated
  test verifies HMAC before parsing, organization lookup, raw-payload hashing,
  customer-reference hashing, and atomic-intake handoff; real Supabase
  verification passed in the hosted durable-intake rollback/idempotency test.
- [x] Implement the service-role repository and atomic
  `payscope_ingest_event_and_enqueue` RPC contract. It accepts a normalized,
  raw-payload-free event and creates its `enrich_event` job in the same
  transaction; static schema and webhook-normalization checks pass.
- [x] Insert the event and its `enrich_event` queue job in one database
  transaction; duplicate delivery returns success without a new event/job. The
  live synthetic signed-webhook check verified both acknowledgement states;
  Supabase then showed completed enrichment and correlation jobs.
- [x] Implement `QueueWorker`: atomically claim due jobs with
  `FOR UPDATE SKIP LOCKED`, honor lock expiry, retry 1s/5s/30s, and move a
  fourth failed attempt to `dead` with a structured alert record. Unit tests
  cover retry/lease paths and the hosted worker completed the synthetic jobs.
- [x] Add the feature-gated QueueWorker implementation and unit-check its
  1s/5s/30s retry schedule plus terminal dead-letter decision. It now accepts
  the documented fourth delivery, rejects lost leases rather than silently
  completing them, supports graceful stop-and-drain, serially drains a burst
  without parallel handlers, and recovers from a transient database-claim
  failure without leaving its processing state stuck.
- [x] Start one QueueWorker with the VPS server when the durable pipeline is
  enabled. It processes enrichment, correlation, and full validated
  investigations; a missing Mesh key or invalid agent result writes a FAILED
  run, appends an audit entry, and escalates for human review instead of being
  silently dropped or producing a proposal.
- [x] Permit the token-gated simulated approval from the exact Vercel origin
  without widening CORS: `X-PayScope-Demo-Approval-Token` is explicitly
  preflighted and a denied-origin regression test passes.
- [ ] Deploy the current backend build, then verify the public Vercel-origin
  preflight returns both `Content-Type` and
  `X-PayScope-Demo-Approval-Token`. The currently reachable VPS still serves
  the prior build, whose preflight exposes only `Content-Type`.
- [x] Add deterministic queue keys (`enrich:event`, `correlate:event`, and
  `investigate:incident:event`) with unique database constraints, so a
  stale-worker replay cannot enqueue duplicate downstream work while a later
  event can still trigger a new investigation. The hosted durable intake and
  queue-lease tests exercise the replay/idempotency boundary.
- [x] Make every queue row tenant-scoped to its source event with a composite
  foreign key and delete cascade. Migration `202608220009` removed the two
  already-proven orphaned Test Mode jobs, and `202608220010` replaced all three
  enqueue RPC bodies before accepting new work. Hosted durable-intake and
  queue-lease checks now use isolated fixture jobs, so they cannot race the
  live VPS worker or leave retry/dead-letter debris. The dedicated hosted
  source-event regression exercises enrichment/correlation/investigation
  enqueue RPCs and proves cascade cleanup.
- [x] Use `pg_cron` only to reclaim stale locks and wake scheduled retries; the
  VPS Node worker, not Postgres, runs provider and model calls. Hosted Cron now
  runs `payscope-requeue-stale-locks` every minute and the job definition was
  queried after the migration applied.
- [x] Extend `/health` with database, queue-worker, webhook, and
  enrichment-adapter readiness. The signed durable webhook is acknowledged
  before asynchronous processing; its hosted acknowledgement was under two
  seconds including public-network latency, while the server path only performs
  HMAC verification plus atomic intake.
- [x] Add tests for malformed/missing HMAC, valid delivery, duplicate delivery,
  rollback when job insert is forced to fail, queue claim contention, retry,
  stale lock recovery, and Org A/Org B isolation. The hosted Test Mode tests
  proved atomic rollback, duplicate idempotency, concurrent `SKIP LOCKED`
  claiming, stale-lease recovery, and authenticated RLS isolation.
- [ ] Perform one real Razorpay Test Mode delivery only after the local tests
  pass; verify the persisted event in Supabase. **External dashboard action
  still required:** the signed-webhook and durable database gates are green,
  but no real Razorpay-originated delivery is recorded yet.

**Gate:** real or signed Test Mode webhook → event + `enrich_event` job durable
→ acknowledgement under 500 ms; no duplicate rows; isolation test passes.

## Phase 2 — enrichment and deterministic correlation

- [x] Add injected `EnrichmentProvider`, `HeuristicEnrichmentAdapter`, and
  `FixtureEnrichmentAdapter`; reserve but do not enable `VulcanDirectAdapter`.
- [x] Fetch payment details server-side and map documented Razorpay fields:
  error source/step/reason, acquirer context, international flag, method,
  attempts, order/payment amount, and the documented downtimes endpoint.
- [x] Record source, signals used, timestamps, gateway health proxy, and a
  nullable enrichment result. Dashboard/API labels expose the concrete source;
  unavailable enrichment is explicitly labelled as requiring human review.
- [x] Enforce provider timeout and Zod validation. Timeout/malformed response
  means `enrichment = null`, source `unavailable`, a lower-confidence audit
  marker, and continued processing—not a fabricated score. The worker test
  asserts this degradation path; the durable RPC writes it once only.
- [x] Implement the queue transition `enrich_event` → `correlate_event` with
  idempotent completion records and retry-safe updates. A repeated completion
  cannot duplicate its correlation job or enrichment audit entry.
- [x] Implement one canonical correlation state machine: OPEN, MONITORING,
  ESCALATED, DISPUTE_OPENED, RESOLVED, HUMAN_RESOLVED, DISMISSED.
- [x] Correlate by tenant-scoped payment/order/subscription/customer hash;
  derive chronological ordering from event time, never queue arrival order.
- [x] Move durable candidate selection into a tenant-scoped SQL function,
  bounded to 100 matched incidents. This prevents oversized `IN` requests and
  includes terminal incidents only for a late recovery or any of the three
  dispute-opening event types, so normal failures cannot reopen them.
- [x] Apply the 72-hour recovery window. Any method may count as recovery;
  full coverage resolves, partial coverage reduces the remaining amount and
  moves to MONITORING, and late recovery is audit-only.
- [x] Preserve the allowlisted order amount as a bounded provider field and
  expose `partialRecoveryPossible` only as a captured-payment hint; the
  incident state machine remains authoritative for actual remaining balance.
- [x] On a dispute, elevate tier to CRITICAL, enter DISPUTE_OPENED, cancel every
  pending proposal atomically, and write an audit entry. The correlation RPC
  now performs cancellation in the same transaction; hosted Test Mode proof
  confirmed terminal recovery cancellation and its append-only audit evidence.
- [x] Recheck outreach stopping rules on simulated approval, not only at
  proposal creation. A transaction advisory lock serializes each hashed-customer
  counter; missing hash/opt-in or exhausted quota makes the database reject the
  approval. Hosted Test Mode proof records one simulated attempt and rejects a
  second attempt in the same 24-hour window.
- [x] Add pure correlation coverage proving that a linked dispute enters
  `DISPUTE_OPENED` with CRITICAL tier. Durable proposal cancellation and audit
  persistence are covered by the hosted terminal-transition test.
- [x] Generate signed fixture sets A/B and test gateway, bank, customer,
  infrastructure, fraud, partial recovery, duplicate, concurrency, and
  out-of-order-event cases. PII-free signed fixtures cover the infrastructure
  recovery sequence and fraud/dispute risk tiers; dedicated durable intake and
  queue-lease tests cover duplicate and concurrent delivery semantics.

**Gate:** every fixture event is transparently enriched or marked unavailable,
then produces the correct correlated incident, risk tier, and state transition.

### Phase 0–2 implementation verification — 2026-08-22

- [x] Rechecked contracts, strict TypeScript builds, signed fixtures, durable
  intake/queue/RLS/terminal-transition integrations, enrichment degradation,
  correlation, contact locking, and public-response PII projection. The source
  implementations satisfy their Phase 0–2 checklist items.
- [x] Hardening recheck: all local backend tests, production dependency audit,
  and diff validation pass. Hosted migration `202608220009`/`010`, atomic
  intake, and `SKIP LOCKED` fixture tests pass; the queue contains no dead or
  source-event-invalid row after cleanup.
- [ ] Operational proof remains external to source code: deploy the current
  VPS/Vercel builds and observe one Razorpay-originated Test Mode delivery.
  These are tracked in the Phase 1 deployment/webhook rows above and do not
  have a local fallback.

## Phase 3 — bounded agent pipeline and policy gates

- [x] Add the injected model-provider interface plus Mesh Chat Completions and
  deterministic Echo adapters. Mesh requests use provider-enforced JSON Schema
  structured output, temperature zero, prompt/output caps, and local Zod
  validation; Echo schema-validation tests pass. Pipeline latency persistence
  and failure audit logging are covered by the durable investigation runner.
- [x] Use an eight-second bounded Mesh timeout: this stays below the MVP's
  ten-second end-to-end target while allowing a schema-constrained gateway
  response to complete instead of incorrectly escalating on normal latency.
- [x] Select Mesh's `openai/gpt-4o-mini-2024-07-18` route as the MVP default
  after a live probe confirmed strict JSON Schema output. The Gemini route was
  rejected because it returned prose despite the structured-output request.
- [x] Implement the Investigation Supervisor within its 2,048/512 token
  budget and schema. It may short-circuit clear infrastructure events and
  rejects output that omits required human review when enrichment is unavailable.
- [x] Add the schema-validated Supervisor module and offline test coverage for
  an infrastructure short-circuit. Persisted token-budget accounting and queue
  dispatch are covered by the durable investigation runner.
- [x] Implement the four tenant-scoped, read-only Risk Analyst tools: incident
  timeline, merchant failure rate, network/gateway failure proxy, and hashed
  customer incident count. The service-role RPC injects organization scope;
  the model receives only bounded aggregate results.
- [x] Collect the four server-side tool results before Risk Analyst inference,
  record them as `toolResults` in the persisted risk analysis, and expose no
  unrestricted tool-call or tenant-selector path to the model.
- [x] Implement Risk Analyst output validation, missing-evidence reporting,
  evidence items without raw data, false-positive cost on every run, and fraud
  conclusions only under the plan's evidence rules.
- [x] Add the bounded Risk Analyst module with all four declared server-tool
  interfaces and test coverage for a schema-validated analysis. The hosted
  scope test verifies the durable aggregate-tool RPC and its allowlist.
- [x] Implement Recovery Planner output validation and its eight approved action
  strings only. Fraud or dispute paths produce no outreach. Hinglish scripts are
  at most 75 words and include opt-out wording.
- [x] Add Recovery Planner schema validation, approved-action enforcement,
  fraud/dispute/opt-in guards, and the 75-word script limit; offline agent
  pipeline coverage passes.
- [x] Implement deterministic Policy Evaluator gates in order: fraud,
  dispute, auto-resolve ceiling, human-review floor, critical tier, contact
  limits, then merchant-policy match.
- [x] Add the pure deterministic Policy Evaluator in the required gate order,
  with an offline fraud hard-stop, infrastructure proposal test, and proof that
  a contact-limited outreach proposal is stopped before merchant-policy lookup.
- [x] Persist every completed/failed investigation and policy-permitted
  proposals transactionally with audit entries. `payscope_persist_investigation_with_proposals`
  creates only schema-validated drafts; failed schema or provider output
  escalates the incident and never produces an action.
- [x] Persist validated completed investigations through a tenant-scoped RPC
  with plan/risk/recovery/policy JSON, telemetry, escalation state, and an
  audit entry. The offline runner test covers the successful contract path and
  transactional proposal creation is covered by the preceding persistence task.
- [x] On a missing model key or agent/schema failure, persist a FAILED
  investigation, escalate the incident (without overriding a dispute), and
  append an audit entry. No proposal is created on this path.
- [x] Treat unavailable aggregate-risk tooling as unknown rather than a zero
  signal, and let repository-read failures reach the durable queue retry path;
  only actual agent/model failures produce the audited failed investigation.
- [x] Preserve declared Risk Analyst → Recovery Planner order because Recovery
  consumes the validated Risk conclusion; no speculative concurrent model call
  is made. A shared 9.5-second deadline is passed to every model request and
  timeout/schema failures enter the audited escalation path.
- [x] Test offline end-to-end: infrastructure produces a bounded auto-resolve
  proposal; fraud escalates with no proposal; unavailable enrichment forces
  review; invalid model output escalates; and the hosted concurrent outreach
  test proves rate/contact gates serialize correctly.

**Gate:** Echo-adapter pipeline is fully deterministic and every agent output is
schema-valid; targeted real-model runs remain bounded and meet the documented
under-10-second buildathon target where provider latency permits.

## Phase 4 — proposals, audit, and MVP API

- [x] Add tenant-scoped, read-only Agentic MVP API reads for health, incident
  queue/detail, incident audit history, and compact audit integrity. Every
  database query injects the configured organization ID; dashboard metrics
  remain a later phase.
- [x] Validate MVP read-route request boundaries before database access: an
  incident/audit identifier must be a UUID and incident-list limits are bounded
  to 1–100. Invalid input returns `400 INVALID_REQUEST`, while an absent valid
  identifier returns `404`; the API regression test covers both paths.
- [x] Redeploy the validated request-boundary fix to the VPS and repeat the
  public `GET /api/mvp/incidents/not-a-uuid` smoke check: the live API returns
  `400 INVALID_REQUEST`; health, the active frontend read path, and CORS
  preflight are also green.
- [ ] Reduce the VPS `CORS_ORIGINS` value to the one current operator origin
  (`https://payscope-ai.vercel.app`); do not retain a stale Vercel project or
  localhost origins in production. The live server still currently permits
  `https://payscope.vercel.app`, so this setting either was not saved or its
  process has not restarted with the new environment.
- [x] Add `CommunicationsProvider` and `LoggingCommunicationsAdapter` only.
  The adapter has no transport or credential path and returns `simulated`.
  The tenant-scoped approval RPC records the actor/session hash, approval,
  simulated delivery, and two audit entries; no live channel adapter exists.
- [x] Add proposal cancellation when a later success resolves an incident or a
  dispute opens; retain the cancellation as an audit event.
- [x] Add API routes for tenant-scoped incident lists/detail, proposal
  approval, audit history, and audit verification. Their request-boundary test
  rejects malformed IDs and never exposes internal hashes or PII.
- [x] Add tenant-scoped dashboard metrics/data and the natural-language query
  contract. `payscope_dashboard_metrics` returns real operational totals but
  explicit `null`/`not_run` evaluation and recovery-attribution fields until
  Phase 5 has a versioned fixture report and causal Payment Link evidence.
- [x] Make dashboard-query structured and read-only: a natural-language input
  is bounded to 240 characters and deterministically recognizes only lifecycle
  state/risk-tier words. It never reaches SQL, a model prompt, an action, or an
  organization selector; returned incident summaries exclude PII and provider
  IDs. Router/repository regressions cover malformed limits, injection-like
  text, punctuation, compound lifecycle terms, and the explicit 100-incident
  recent-data bound.
- [x] Phase 4 hardening recheck: complete local suite, all hosted Supabase
  integrations, frontend build, production dependency audits, and diff checks
  pass. Dashboard aggregates preserve safe-integer precision, `not_run`
  evaluation payloads cannot contain partial scores, and unavailable values are
  displayed instead of silently converted to zero.
- [x] Add audit events for receipt, enrichment outcome, correlation transition,
  investigation lifecycle, policy decision, proposal creation/approval,
  simulated delivery, cancellation, escalation, and human resolution. Migration
  `202608230004` appends these only inside the canonical durable RPCs; a future
  `HUMAN_RESOLVED` transition is recorded without introducing a second public
  resolution action.
- [x] Canonicalize `confidence` to the persisted `numeric(4,3)` representation
  before audit hashing and insertion. Migration `202608230005` prevents a
  value such as `0.9` from hashing differently from its stored `0.900` form;
  the live demo chain was verified intact before and after this correction.
- [x] Test 50 sequential audit entries, hash-chain verification, rejected update
  and delete, duplicate sequence rejection, compensating audit entry, approval
  attribution, simulated delivery, and tenant isolation for every API route.
  The dedicated fixture-tenant integration passes and preserves its immutable
  evidence instead of attempting an invalid cleanup.

**Gate:** a seeded operator can inspect only their organization, approve a
proposal, see simulated delivery, and verify an intact audit chain.

## Phase 5 — fixtures, evaluation, demo evidence

- [x] Define and test one HMAC-signed fixture schema with stable IDs, tenant
  ID, normalized event/enrichment data, expected incident outcome, and fraud
  ground truth. Verification rejects tampering and a fixture from the wrong
  development/held-out partition.
- [x] Build and verify separate, non-overlapping 300-development / 200-held-out
  signed PII-free regression fixtures. The current corpus is deterministic and
  generated, so it is explicitly **not** represented as the plan's manually
  curated adjudication set.
- [ ] Replace the generated ground-truth labels with 500 manually curated
  fixtures before making a final precision/recall claim. Do not tune against
  the held-out labels after they are adjudicated.
- [x] Implement the pure fixture evaluation metric core for precision, recall,
  F1, confusion-matrix counts, median-based false-positive cost, and safe
  integer amounts. Zero denominators return `not_available`, never zero or
  infinity. The runner generates a versioned, configuration-hashed report.
- [x] Implement recovery attribution. A recovery counts only with a proposal,
  operator approval, captured payment within 24 hours, and proposal ID bound to
  a payment-link reference or explicit incident correlation. The pure and
  hosted tests cover duplicate credits, disputes, late captures, no approval,
  and per-incident amount caps.
- [x] Mark all recovery results as Test Mode simulation while communications are
  simulated. Do not state or imply real merchant revenue recovery.
- [x] Render and publish the exception list: no COD/RTO decisioning, no dispute
  outreach, no fraud outreach, no unmatched-policy recovery, no live message
  delivery, and no Razorpay Live Mode.
- [ ] Run development evaluation, lock thresholds, then run held-out evaluation
  once and preserve the raw report with timestamp, fixture set version, model
  adapter/model ID, and configuration hash.
- [x] Update README, VPS deployment guidance, environment examples, and metric
  methodology for the current MVP. They state the programmatic-fixture
  limitation, Test Mode attribution rule, and held-out one-run database lock.
- [x] Remove obsolete backend code, unused dependencies, migration paths,
  environment variables, endpoints, fixtures, and tests after their canonical
  replacements are green. Source/import/dependency scans find no runnable
  legacy path or incompatible second source of truth.
- [x] Run the complete backend suite from a clean install and the explicitly
  enabled hosted component integrations on a dedicated fixture tenant. This
  verifies signed durable intake, queue claims/retries/integrity, enrichment
  degradation, correlation, investigation/policy persistence, proposal safety,
  simulated delivery, recovery attribution, and audit-chain verification.
- [ ] Run one deployed, observable end-to-end worker demonstration after the
  VPS has been redeployed: signed event → queued worker → enrichment →
  correlation → investigation → policy → proposal → operator approval →
  simulated delivery → audit-chain verification. This is intentionally not
  substituted by unit/component integrations or a fabricated dashboard row.

**Final MVP gate:** a live Test Mode event reaches the React dashboard through
the durable pipeline; the offline fixture suite reports defensible metrics and
the UI/README clearly state every simulation and exception. The repository has
no legacy path that can create a conflicting incident, action, or audit record.

### Phase 5 implementation recheck — 2026-08-23

- [x] Applied `202608230003_evaluation_reports.sql` to hosted Supabase and
  verified the live metrics contract. Evaluation remains `not_run` until the
  VPS-only signing secret is configured and a report is deliberately recorded.
- [x] Added and passed local fixture/attribution tests plus the hosted causal
  attribution integration. The temporary integration rows are removed after
  the assertion; no report or merchant-recovery claim was fabricated.
- [x] Hosted-test hardening: integration scripts now refuse the demo tenant
  and require `PAYSCOPE_TEST_ORGANIZATION_ID`. Existing audit-linked fixture
  evidence cannot be deleted without violating the append-only rule, so it is
  retained as valid test evidence rather than silently mutating the chain.
- [x] Clean-install recheck: `npm ci --ignore-scripts`, production TypeScript
  build, and production dependency audit pass. All local regression scripts
  passed; the explicitly enabled hosted Test Mode suite then passed on a fresh,
  non-demo fixture tenant (RLS, durable intake, queue lease/integrity,
  terminal cancellation, outreach locking, risk tools, attribution, 50-entry
  append-only proof, lifecycle coverage). Its final 65-entry audit chain is
  intact. The former fixture tenant remains intentionally broken evidence of
  the pre-`202608230005` confidence-format defect and is never used by the
  demo or current integration suite.
