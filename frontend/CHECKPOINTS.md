# PayScope frontend — autonomous execution ledger checklist

**Canonical specification:** [`../Plan.md`](../Plan.md). The frontend is a read-only execution ledger. The AI does the work; the interface makes the decision, command, provider receipt, reconciliation result, and business outcome understandable.

## Completed foundation

- [x] Remove approval token state, approval requests, manual-resolution controls, operator workflow, human-review labels, review queue, and false task CTAs.
- [x] Keep browser interactions limited to navigation, filtering, and reading; no client action can dispatch a provider command.
- [x] Render tenant-scoped incident feed, lifecycle, at-risk context, source labels, verified chronology, AI decision, causal narrative, alternatives, evidence gaps, deterministic gate trace, audit chain, and metrics.
- [x] Validate health, incident, investigation, proposal, audit, and metrics contracts at the API boundary; degrade safely on malformed or unavailable responses.
- [x] Keep loading, empty, error, abort, stale-response, keyboard, focus, menu, responsive, dark-theme, and no-secret browser behavior covered in the existing dashboard foundation.
- [x] Remove active public wording that positions PayScope as a restricted data-only or action-simulation product.

## Landing page — autonomous execution story

- [ ] Rebuild section 4 as a dense autonomous execution engine surface: detected signal, AI plan, policy clearance, provider dispatch, receipt/reconciliation, and final outcome must be visible at a glance.
- [ ] Replace sparse explanatory cards with an animated execution pipeline, live command/receipt cards, provider state transitions, and clear “the AI executes; the dashboard explains” narrative.
- [ ] Update mobile section 4 so it communicates the same execution loop, not merely a dashboard CTA.
- [ ] Remove all remaining simulation-only or human-approval copy from the landing page, dashboard, empty states, tooltips, and visual components.
- [ ] Preserve the current dark visual language, motion quality, responsive scaling, reduced-motion behavior, and working dashboard navigation while adding density.

## Execution-ledger experience — required

- [ ] Add execution status vocabulary and visuals: `queued`, `dispatching`, `accepted`, `delivered`, `confirmed`, `retry scheduled`, `compensating`, `failed`, and `cancelled`.
- [ ] Show a clear chronological split between AI investigation, deterministic policy, dispatched command, provider receipt, callback verification, reconciliation, retry/compensation, and final incident outcome.
- [ ] Render each capability with a human-readable provider operation: recovery link, WhatsApp/SMS, voice call, merchant email/webhook, capture, refund, dispute evidence, risk signal, and infrastructure resolution.
- [ ] Display redacted action prerequisites, canonical payment reference, amount/currency, policy version, idempotency state, provider request ID, receipt state, retry schedule, and compensation link without exposing recipient data or secrets.
- [ ] Replace simulation metrics with execution metrics: actions dispatched, provider accepted, delivered, confirmed recoveries, refunds, failed actions, retries, compensations, and unresolved receipts.
- [ ] Make causal attribution explicit: an outcome belongs to PayScope only when action ID, provider receipt, and Razorpay event are linked.
- [ ] Give each terminal path useful explanation: provider refusal, callback pending, contact/consent policy, fraud, dispute, amount cap, provider outage, retry exhaustion, or compensation completion.

## Frontend contracts and data boundaries — required

- [ ] Extend API guards/types for execution action, outbox state, provider receipt, callback/reconciliation result, retry/compensation history, and verified financial outcome.
- [ ] Reject retired `simulated` proposal/status fields once the direct-execution backend migration is active; support one explicitly-versioned migration projection only during rollout.
- [ ] Preserve read-only browser behavior: action commands, recipient resolution, financial credentials, and provider tokens remain backend-only.
- [ ] Update the dashboard query interpreter so it can filter by incident lifecycle, risk tier, execution state, provider, and unresolved receipt status without altering data.

## Visual and accessibility verification — required

- [ ] Test dense execution cards at desktop, tablet, and mobile widths with long provider IDs, multi-step retries, failed/compensated actions, no incidents, slow API, malformed API response, and long evidence rationale.
- [ ] Ensure animated pipeline respects reduced-motion preference, never traps keyboard focus, and does not impair content readability or cause layout shifts.
- [ ] Capture and commit current screenshots for command center, incident feed, AI decision record, and execution/reconciliation ledger after direct execution UI is available.
- [ ] Verify deployed frontend emits no write requests while users open/filter/read any execution state.

## Environment-owned completion gates

- [ ] Deploy Vercel with only the public backend API origin and confirm the backend CORS allowlist exactly matches it.
- [ ] Verify the deployed dashboard against provider-confirmed action data and confirm secrets, recipient details, raw provider payloads, and command credentials never reach browser responses.
