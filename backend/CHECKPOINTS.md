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
  backend. The final code cutover and source-search proof remain pending.
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
  Org A/Org B RLS testing remains a separate unchecked acceptance gate.
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

- [ ] Record the canonical source-path mapping: backend code lives under
  `backend/src`, database migrations under `backend/supabase/migrations`, and
  signed fixtures under `backend/src/fixtures` (or one documented equivalent).
- [ ] Remove or revise backend documentation and API descriptions that promise
  the old `rules-v1`-only workflow, browser access token, or automatic policy
  action semantics once their replacements land.
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
  Anthropic, seed organization, worker identity, and demo operator session.
- [x] Enforce Razorpay Test Mode at server startup and replace timestamp-array
  request limits with capped constant-space token buckets; cleanup removes idle
  identities, so a request flood cannot grow rate-limit memory by request
  count.
  No browser environment variable may contain a provider secret.
- [x] Remove the unused static bearer-token path from the backend as well as
  the browser. The current MVP has no authentication transport; its read-only
  demo API is limited by exact CORS origin and request throttling until the
  planned minimal operator session is implemented.
- [ ] Inventory every current route, service, repository method, environment
  variable, test, and dashboard response. Mark each as **retain and adapt**,
  **replace**, or **delete** in the implementation PR before changing it.

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
- [ ] Enable RLS for every tenant table; deny anonymous access; apply the
  organization policy for the minimal authenticated operator path; test it with
  Org A and Org B fixture data.
- [ ] Add append-only audit safeguards: no updates/deletes, canonical JSON
  serialization, per-organization genesis record, transactionally allocated
  sequence numbers, previous hash, entry hash, and `verify_audit_chain`.
- [ ] Seed one Test Mode organization, one demo operator, and two isolated test
  organizations without creating a user-management product.
- [ ] Refactor the webhook handler to verify raw HMAC before parsing, map the
  configured Test Mode webhook secret to the demo organization, and use the
  event ID as a tenant-scoped idempotency key.
- [x] Add the feature-gated `PAYSCOPE_MVP_PIPELINE` webhook path. Its isolated
  test verifies HMAC before parsing, organization lookup, raw-payload hashing,
  customer-reference hashing, and atomic-intake handoff; real Supabase
  verification remains part of the unchecked durable-intake gate above.
- [x] Implement the service-role repository and atomic
  `payscope_ingest_event_and_enqueue` RPC contract. It accepts a normalized,
  raw-payload-free event and creates its `enrich_event` job in the same
  transaction; static schema and webhook-normalization checks pass.
- [ ] Insert the event and its `enrich_event` queue job in one database
  transaction; duplicate delivery must return success without a new event/job.
- [ ] Implement `QueueWorker`: atomically claim due jobs with
  `FOR UPDATE SKIP LOCKED`, honor lock expiry, retry 1s/5s/30s, and move a
  fourth failed attempt to `dead` with a structured alert record.
- [x] Add the feature-gated QueueWorker implementation and unit-check its
  1s/5s/30s retry schedule plus terminal dead-letter decision. It now accepts
  the documented fourth delivery, rejects lost leases rather than silently
  completing them, and supports graceful stop-and-drain; live claim,
  stale-lock, and database-outage verification remain part of the unchecked
  durable-worker task above.
- [x] Start one QueueWorker with the VPS server when the durable pipeline is
  enabled. It processes enrichment and correlation jobs; until full validated
  investigation persistence lands, an investigation job writes a FAILED run,
  appends an audit entry, and escalates for human review instead of being
  silently dropped or producing a proposal.
- [x] Add deterministic queue keys (`enrich:event`, `correlate:event`, and
  `investigate:incident:event`) with unique database constraints, so a
  stale-worker replay cannot enqueue duplicate downstream work while a later
  event can still trigger a new investigation. This still needs a real
  Supabase replay test before the broader worker task is checked off.
- [ ] Use `pg_cron` only to reclaim stale locks and wake scheduled retries; the
  VPS Node worker, not Postgres, runs provider and model calls.
- [ ] Extend `/health` with database, queue-worker, and enrichment-adapter
  readiness. Keep the handler acknowledgement below 500 ms after durable event
  and job insertion.
- [ ] Add tests for malformed/missing HMAC, valid delivery, duplicate delivery,
  rollback when job insert is forced to fail, queue claim contention, retry,
  stale lock recovery, and Org A/Org B isolation.
- [ ] Perform one real Razorpay Test Mode delivery only after the local tests
  pass; verify the persisted event in Supabase.

**Gate:** real or signed Test Mode webhook → event + `enrich_event` job durable
→ acknowledgement under 500 ms; no duplicate rows; isolation test passes.

## Phase 2 — enrichment and deterministic correlation

- [x] Add injected `EnrichmentProvider`, `HeuristicEnrichmentAdapter`, and
  `FixtureEnrichmentAdapter`; reserve but do not enable `VulcanDirectAdapter`.
- [x] Fetch payment details server-side and map documented Razorpay fields:
  error source/step/reason, acquirer context, international flag, method,
  attempts, order/payment amount, and the documented downtimes endpoint.
- [ ] Record source, signals used, timestamps, gateway health proxy, and a
  nullable enrichment result. Dashboard/API labels must expose the source.
- [ ] Enforce provider timeout and Zod validation. Timeout/malformed response
  means `enrichment = null`, source `unavailable`, a lower-confidence audit
  marker, and continued processing—not a fabricated score.
- [ ] Implement the queue transition `enrich_event` → `correlate_event` with
  idempotent completion records and retry-safe updates.
- [x] Implement one canonical correlation state machine: OPEN, MONITORING,
  ESCALATED, DISPUTE_OPENED, RESOLVED, HUMAN_RESOLVED, DISMISSED.
- [x] Correlate by tenant-scoped payment/order/subscription/customer hash;
  derive chronological ordering from event time, never queue arrival order.
- [x] Move durable candidate selection into a tenant-scoped SQL function,
  bounded to 100 matched incidents. This prevents oversized `IN` requests and
  includes terminal incidents only for a late recovery or dispute, so normal
  failures cannot reopen them.
- [x] Apply the 72-hour recovery window. Any method may count as recovery;
  full coverage resolves, partial coverage reduces the remaining amount and
  moves to MONITORING, and late recovery is audit-only.
- [x] Preserve the allowlisted order amount as a bounded provider field and
  expose `partialRecoveryPossible` only as a captured-payment hint; the
  incident state machine remains authoritative for actual remaining balance.
- [ ] On a dispute, elevate tier to CRITICAL, enter DISPUTE_OPENED, cancel every
  pending proposal atomically, and write an audit entry.
- [x] Add pure correlation coverage proving that a linked dispute enters
  `DISPUTE_OPENED` with CRITICAL tier. Durable proposal cancellation and audit
  persistence remain part of the unchecked task above.
- [ ] Generate signed fixture sets A/B and test gateway, bank, customer,
  infrastructure, fraud, partial recovery, duplicate, concurrency, and
  out-of-order-event cases.

**Gate:** every fixture event is transparently enriched or marked unavailable,
then produces the correct correlated incident, risk tier, and state transition.

## Phase 3 — bounded agent pipeline and policy gates

- [ ] Add injected `ModelProvider`, `AnthropicModelAdapter`, and offline
  `EchoModelAdapter`. Enforce request timeouts, token limits, temperature zero,
  response-schema validation, model ID, token count, latency, and failure logs.
- [x] Add the injected model-provider interface plus Mesh Chat Completions and
  deterministic Echo adapters. Mesh requests use provider-enforced JSON Schema
  structured output, temperature zero, prompt/output caps, and local Zod
  validation; Echo schema-validation tests pass. Pipeline latency persistence
  and failure audit logging remain part of the unchecked integration task above.
- [x] Use an eight-second bounded Mesh timeout: this stays below the MVP's
  ten-second end-to-end target while allowing a schema-constrained gateway
  response to complete instead of incorrectly escalating on normal latency.
- [x] Select Mesh's `openai/gpt-4o-mini-2024-07-18` route as the MVP default
  after a live probe confirmed strict JSON Schema output. The Gemini route was
  rejected because it returned prose despite the structured-output request.
- [ ] Implement the Investigation Supervisor exactly within its 2,048/512 token
  budget and schema. It may short-circuit clear infrastructure events and must
  require human review when enrichment is unavailable.
- [x] Add the schema-validated Supervisor module and offline test coverage for
  an infrastructure short-circuit. Persisted token-budget accounting and queue
  dispatch remain part of the unchecked integration task above.
- [ ] Implement the four tenant-scoped, read-only Risk Analyst tools: incident
  timeline, merchant failure rate, network/gateway failure proxy, and hashed
  customer incident count. Tool handlers inject organization scope; model input
  cannot select an organization.
- [ ] Extend the model orchestration contract so the Risk Analyst can make only
  those declared tool calls, or collect the four server-side tool results before
  analysis and record that orchestration explicitly. No unrestricted tools.
- [ ] Implement Risk Analyst output validation, missing-evidence reporting,
  evidence items without raw data, false-positive cost on every run, and fraud
  conclusions only under the plan's evidence rules.
- [x] Add the bounded Risk Analyst module with all four declared server-tool
  interfaces and test coverage for a schema-validated analysis. Durable tool
  queries and investigation persistence remain pending.
- [ ] Implement Recovery Planner output validation and its eight approved action
  strings only. Fraud or dispute paths produce no outreach. Hinglish scripts are
  at most 75 words and include opt-out wording.
- [x] Add Recovery Planner schema validation, approved-action enforcement,
  fraud/dispute/opt-in guards, and the 75-word script limit; offline agent
  pipeline coverage passes.
- [ ] Implement deterministic Policy Evaluator gates in order: fraud,
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
  audit entry. The offline runner test covers the successful contract path;
  transactional proposal creation remains pending.
- [x] On a missing model key or agent/schema failure, persist a FAILED
  investigation, escalate the incident (without overriding a dispute), and
  append an audit entry. No proposal is created on this path.
- [x] Treat unavailable aggregate-risk tooling as unknown rather than a zero
  signal, and let repository-read failures reach the durable queue retry path;
  only actual agent/model failures produce the audited failed investigation.
- [ ] Execute independent Risk Analyst/Recovery Planner work in parallel only
  when the Supervisor marks it safe; otherwise preserve declared order. Capture
  full pipeline latency and use the degraded path when timeouts occur.
- [ ] Test offline end-to-end: infrastructure fixture produces a bounded
  auto-resolve proposal; fraud fixture escalates with no proposal; unavailable
  enrichment forces review; invalid model output escalates; rate/contact gates
  hold under concurrent jobs.

**Gate:** Echo-adapter pipeline is fully deterministic and every agent output is
schema-valid; targeted real-model runs remain bounded and meet the documented
under-10-second buildathon target where provider latency permits.

## Phase 4 — proposals, audit, and MVP API

- [x] Add tenant-scoped, read-only Agentic MVP API reads for health, incident
  queue/detail, and incident audit history. Every database query injects the
  configured organization ID; proposal approval and dashboard metrics remain
  unchecked.
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
- [ ] Add proposal cancellation when a later success resolves an incident or a
  dispute opens; retain the cancellation as an audit event.
- [ ] Add API routes for tenant-scoped incident lists/detail, proposals and
  approval, audit history/verification, dashboard metrics, metrics data, and
  natural-language dashboard query.
- [ ] Make dashboard-query structured and read-only: a natural-language request
  is converted to a bounded incident-summary response, with tenant filters
  injected server-side. It cannot execute actions or access PII.
- [ ] Add audit events for receipt, enrichment outcome, correlation transition,
  investigation lifecycle, policy decision, proposal creation/approval,
  simulated delivery, cancellation, escalation, and human resolution.
- [ ] Test 50 sequential audit entries, hash-chain verification, rejected update
  and delete, duplicate sequence rejection, compensating audit entry, approval
  attribution, simulated delivery, and tenant isolation for every API route.

**Gate:** a seeded operator can inspect only their organization, approve a
proposal, see simulated delivery, and verify an intact audit chain.

## Phase 5 — fixtures, evaluation, demo evidence

- [ ] Define one signed fixture schema with stable IDs, tenant ID, event data,
  expected incident outcome, and manually-set ground-truth fraud label.
- [ ] Build 300 development fixtures and 200 held-out fixtures before tuning
  prompts/thresholds. Store the held-out set separately and do not inspect it
  while changing logic.
- [x] Implement the pure fixture evaluation metric core for precision, recall,
  F1, confusion-matrix counts, median-based false-positive cost, and safe
  integer amounts. Zero denominators return `not_available`, never zero or
  infinity; the execution/report and 300/200 fixture sets remain pending.
- [ ] Implement recovery attribution. A recovery counts only with a proposal,
  operator approval, captured payment within 24 hours, and proposal ID bound to
  a payment-link reference or explicit incident correlation.
- [ ] Mark all recovery results as Test Mode simulation while communications are
  simulated. Do not state or imply real merchant revenue recovery.
- [ ] Render and publish the exception list: no COD/RTO decisioning, no dispute
  outreach, no fraud outreach, no unmatched-policy recovery, no live message
  delivery, and no Razorpay Live Mode.
- [ ] Run development evaluation, lock thresholds, then run held-out evaluation
  once and preserve the raw report with timestamp, fixture set version, model
  adapter/model ID, and configuration hash.
- [ ] Update README, deployment guide, and API examples to match the completed
  MVP; remove old claims that conflict with the canonical plan.
- [ ] Remove obsolete backend code, unused dependencies, migration paths,
  environment variables, endpoints, fixtures, and tests after their canonical
  replacements are green. Do not leave inaccessible dead code as a second
  source of truth.
- [ ] Run the complete backend suite from a clean install, then run an
  integration sequence against Supabase: signed event → queue worker →
  enrichment → correlation → investigation → policy → proposal → approval →
  simulated delivery → audit-chain verification.

**Final MVP gate:** a live Test Mode event reaches the React dashboard through
the durable pipeline; the offline fixture suite reports defensible metrics and
the UI/README clearly state every simulation and exception. The repository has
no legacy path that can create a conflicting incident, action, or audit record.
