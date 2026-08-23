# PayScope backend — autonomous operations checklist

**Canonical specification:** [`../Plan.md`](../Plan.md). This file records source completion and the remaining environment-owned proof steps. A checkbox is never used to imply a migration, deployment, or live webhook exercise that has not actually happened.

## Product boundary

- Razorpay `live` and `test` credentials are both accepted for intake and enrichment when their key prefix matches `RAZORPAY_ENVIRONMENT`.
- Every table, queue job, RPC call, API query, audit entry, and model context is organization-scoped.
- The system autonomously investigates, decides, records a permitted simulation, and records terminal no-action outcomes. There is no operator approval or manual-review path.
- The simulation adapter never sends a customer message or executes a financial operation. Real communications/payment writes are intentionally absent, not configuration switches.

## Legacy removal

- [x] Delete approval token configuration, demo-operator identity, approval locks, approval headers, and approval-only environment settings.
- [x] Delete proposal-approval routes, repository methods, RPC usage, browser-write contracts, tests, UI handlers, and legacy communications adapter files.
- [x] Retire new writes of `ESCALATED` and `HUMAN_RESOLVED`; preserve historical rows as read-only audit history only.
- [x] Delete human-review floor, approval transitions, review-gate contracts, manual-outcome language, and stale workflow components from active runtime source.
- [x] Replace active product terminology and environment variables with `PAYSCOPE_PIPELINE_ENABLED` and `PAYSCOPE_ORGANIZATION_ID`; do not retain a compatibility alias that could silently misconfigure deployment.
- [x] Keep immutable historical migrations unchanged where they document prior schema states; active migrations supersede those states without rewriting applied history.

## Durable intake, correlation, and queue

- [x] Verify raw Razorpay webhook HMAC before parsing, restrict accepted event types, impose request bounds, and return quickly after durable intake.
- [x] Persist provider-event idempotency, privacy-reduced normalization, tenant-scoped queue jobs, lease claiming, bounded retry/backoff, dead-job recording, and cancellation for terminal correlation.
- [x] Correlate duplicate delivery, late capture, partial/full recovery, disputes, terminal states, and same-tenant payment-method evidence without a permissive method-match bug.
- [x] Enrich using recorded source labels and documented downtime data; represent unavailable enrichment as an evidence gap rather than an inferred fact.
- [x] Prevent stale/missing event queue jobs from retrying pointlessly: classify the condition, append the failure audit result when possible, and terminalize the queue job.

## Agentic AI and structured outputs

- [x] Use Mesh model calls through a server-only adapter with timeout/abort handling, deterministic low-temperature configuration, JSON-schema response enforcement, and Zod parsing.
- [x] Make the Supervisor return objectives, evidence priorities, bounded sub-agent work, constraints, and explicit no-action criteria.
- [x] Make the Risk Analyst return causal narrative, evidence-confidence rationale, alternative hypotheses, evidence gaps, risk classification, and tenant-scoped read-tool trace.
- [x] Make the Recovery Planner return only allowlisted action records with source evidence, preconditions, expected outcome, and bounded Hinglish content when relevant.
- [x] Treat webhook/provider text as untrusted data in every prompt; prohibit PII, recipient selection, tools outside the server allowlist, financial execution, and prompt-following from payloads.
- [x] Make malformed or schema-invalid model output a safe, audited autonomous no-action outcome.
- [x] Normalize persisted legacy investigation records at read time so enhanced schemas do not make existing dashboard incidents unreadable during rollout.

## Policy and execution

- [x] Enforce one authoritative stopping-rules module: 2 contacts/incident, 1 customer contact/24h, 3/7d, fraud/dispute/opt-in hard stops, and 90% organization auto-resolution ceiling.
- [x] Evaluate policy deterministically after AI planning; a model output alone cannot create execution.
- [x] Atomically and idempotently mark a permitted action `simulated`, record any bounded contact attempt, update lifecycle, and append an audit event as `system:payscope-autonomy`.
- [x] Convert policy blocks, missing evidence, invalid model output, and unsafe cases to explicit `DISMISSED`; keep disputes as `DISPUTE_OPENED`, full recovery as `RESOLVED`, and partial recovery as `MONITORING`.
- [x] Expose simulation content as evidence only and require a causal proposal-to-payment chain before recovery metrics are populated.

## Read-only API, data boundaries, and reliability

- [x] Keep only health, incident list/detail, audit history/integrity, metrics, and bounded natural-language query routes. No browser route mutates provider or incident state.
- [x] Return only presentation-safe tenant data; exclude raw provider payload, secrets, contact details, approval/session tokens, and unscoped records.
- [x] Enforce CORS allowlist and preflight behavior, safe startup configuration, environment/key-prefix validation, and graceful database/pipeline shutdown with timer cleanup.
- [x] Use append-only database audit rules and per-organization hash chains; document them accurately as tamper-evident rather than event-sourced or cryptographically signed.

## Verification completed in source

- [x] TypeScript build passes for backend source.
- [x] Contract, schema, correlation, agent, investigation-runner, API, dashboard, attribution, fixture, phase-3, CORS, queue, and tenant-isolation tests cover the active autonomous path.
- [x] Dependency audit reports no production high-severity vulnerability.
- [x] Deep code review checked timeout/abort paths, retry terminalization, duplicate action idempotency, stale jobs, compatibility reads, lifecycle races, CORS, tenant scoping, and timer cleanup; identified issues were corrected.
- [x] Dead-code search confirms active source contains no approval, operator, manual-review, or removed communications-adapter implementation.

## Environment-owned completion gates

- [ ] Apply `202608230006_autonomous_simulated_execution.sql`, `202608230007_autonomous_lifecycle_and_metrics.sql`, and `202608230008_investigation_trigger_idempotency.sql` using `npx supabase db push`, then redeploy the VPS. Do not mark this complete until the target project reports migration success.
- [ ] Configure `PAYSCOPE_ORGANIZATION_ID`, `PAYSCOPE_PIPELINE_ENABLED=true`, server-only Razorpay/Mesh/Supabase secrets, and a matching `RAZORPAY_ENVIRONMENT` / key prefix on the VPS.
- [ ] Exercise one hosted signed webhook and verify the complete durable chain: intake → queue → enrichment → correlation → structured agents → policy → simulation/no-action → audit integrity.
- [ ] Run the opt-in Supabase integration scripts against a dedicated non-production organization, including RLS isolation, queue lease recovery, audit lifecycle, attribution, and terminal-cancellation paths.
- [ ] Capture production-like worker logs for duplicate delivery, missing event, model timeout, enrichment outage, fraud, dispute, contact-limit, late-capture, and concurrent-claim cases; confirm no customer/provider write occurs.
