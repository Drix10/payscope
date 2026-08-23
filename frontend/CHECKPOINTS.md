# PayScope frontend — autonomous execution ledger checklist

**Canonical specification:** [`../Plan.md`](../Plan.md). The frontend is a read-only execution ledger. The AI does the work; the interface makes the decision, command, provider receipt, reconciliation result, and business outcome understandable.

## Completed foundation

- [x] Remove approval token state, approval requests, manual-resolution controls, operator workflow, human-review labels, review queue, and false task CTAs.
- [x] Keep browser interactions limited to navigation, filtering, and reading; no client action can dispatch a provider command.
- [x] Render tenant-scoped incident feed, lifecycle, at-risk context, source labels, verified chronology, AI decision, causal narrative, alternatives, evidence gaps, deterministic gate trace, audit chain, and metrics.
- [x] Validate health, incident, investigation, proposal, audit, and metrics contracts at the API boundary; degrade safely on malformed or unavailable responses.
- [x] Keep loading, empty, error, abort, stale-response, keyboard, focus, menu, responsive, dark-theme, and no-secret browser behavior covered in the existing dashboard foundation.
- [x] Replace the remaining active simulation vocabulary/projection (`simulated` proposal status, metrics, audit labels, Section 3 and dashboard copy) only when the direct-execution API migration is live; do not present the illustrative landing execution flow as an executed provider action.

## Landing page — autonomous execution story

- [x] Rebuild section 4 as a dense illustrative autonomous execution-engine surface: detected signal, AI plan, policy clearance, provider dispatch, receipt/reconciliation, and final outcome are visible at a glance.
- [x] Replace sparse explanatory cards with an animated illustrative execution pipeline, command/receipt cards, provider-state transitions, and clear “the AI executes; the dashboard explains” narrative. It makes no claim that a provider command has already been dispatched.
- [x] Update mobile section 4 so it communicates the same execution loop, not merely a dashboard CTA.
- [x] Remove all remaining simulation-only or human-approval copy from the landing page, dashboard, empty states, tooltips, and visual components.
- [x] Preserve the current dark visual language, motion quality, responsive scaling, reduced-motion behavior, and working dashboard navigation while adding density.

## Execution-ledger experience — required

- [x] Add execution status vocabulary and visuals: `queued`, `dispatching`, `SMTP accepted`, `unreconciled`, `confirmed`, `retry scheduled`, `compensating`, `failed`, and `cancelled`. Never label SMTP acceptance as delivered.
- [x] Show a clear chronological split between AI investigation, deterministic policy, dispatched command, provider receipt, callback verification, reconciliation, retry/compensation, and final incident outcome.
- [x] Add a bounded incident-memory timeline that shows only redacted evidence summaries and prior AI execution facts; never render recipient data, raw provider payloads, or customer-email content.
- [x] Render each capability with a human-readable provider operation: recovery link, recovery email, capture, refund, dispute evidence, risk signal, and infrastructure resolution. Do not expose non-MVP WhatsApp, SMS, voice, or merchant-webhook actions.
- [x] Display redacted action prerequisites, canonical payment reference, amount/currency, policy version, idempotency state, provider request ID, receipt state, retry schedule, and compensation link without exposing recipient data or secrets.
- [x] Replace simulation metrics with execution metrics: actions dispatched, SMTP accepted/rejected, unreconciled emails, confirmed recoveries, refunds, failed actions, retries, compensations, and unresolved receipts.
- [x] Make causal attribution explicit: an outcome belongs to PayScope only when action ID, provider receipt, and Razorpay event are linked.
- [x] Give each terminal path useful explanation: provider refusal, callback pending, contact/consent policy, fraud, dispute, amount cap, provider outage, retry exhaustion, or compensation completion.

## Frontend contracts and data boundaries — required

- [x] Extend API guards/types for execution action, outbox state, provider receipt, callback/reconciliation result, retry/compensation history, and verified financial outcome.
- [x] Reject retired `simulated` proposal/status fields once the direct-execution backend migration is active; support one explicitly-versioned migration projection only during rollout.
- [x] Preserve read-only browser behavior: action commands, recipient resolution, financial credentials, and provider tokens remain backend-only.
- [x] Update the dashboard query interpreter so it can filter by incident lifecycle, risk tier, execution state, provider, and unresolved receipt status without altering data.

## Visual and accessibility verification — required

- [x] Test dense execution cards at desktop, tablet, and mobile widths with long provider IDs, multi-step retries, failed/compensated actions, no incidents, slow API, malformed API response, and long evidence rationale.
- [x] Ensure animated pipeline respects reduced-motion preference, never traps keyboard focus, and does not impair content readability or cause layout shifts.
- [x] Capture and commit current screenshots for command center, incident feed, AI decision record, and execution/reconciliation ledger after direct execution UI is available.
- [x] Verify deployed frontend emits no write requests while users open/filter/read any execution state.

## Environment-owned completion gates

- [ ] Deploy Vercel with only the public backend API origin and confirm the backend CORS allowlist exactly matches it.
- [ ] Verify the deployed dashboard against provider-confirmed action data and confirm secrets, recipient details, raw provider payloads, and command credentials never reach browser responses.
