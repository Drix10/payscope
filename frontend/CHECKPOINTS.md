# PayScope frontend — locked MVP execution checklist

**Canonical specification:** [`../Plan.md`](../Plan.md). This checklist replaces
the legacy dashboard delivery record. It describes work still to do; it does not
claim the new agentic MVP is already implemented.

## Plan.md phase correlation

`Plan.md` Part 8 is the only phase-gate authority. Frontend Phase 0 is contract
and shell preparation; Phases 1–3 implement the Plan.md Phase 4 operator
surface; Phase 4 implements the Plan.md Phase 4 Agentic Dashboard and renders
Plan.md Phase 5 evidence; Phase 5 is Plan.md Phase 5 demo readiness. The visual
restoration section below is presentation work permitted by the React/Vite
decision; it cannot replace, waive, or mark complete a functional Plan.md gate.

## MVP boundary

- Keep React 18 + Vite. Do not migrate to Next.js.
- Build for one seeded Test Mode merchant and one demo operator. Do not build
  sign-up, organization management, OAuth connection screens, roles, billing,
  or a full production auth experience.
- The UI must nevertheless consume tenant-scoped APIs and exercise the minimal
  operator session/Org A–Org B isolation test supplied by the backend.
- Show heuristic and fixture enrichment honestly. Never label it direct Vulcan
  data unless the backend response source is `vulcan_direct`.
- Communications are proposals only; approval triggers a simulated logged
  result. Never expose phone numbers, delivery credentials, or a live-send UI.

The dashboard is a view over the append-only audit trail and agent pipeline; it
must not invent incidents, money, confidence, fraud facts, or recoveries.

## Mandatory legacy removal and replacement map

The frontend must become one coherent agentic-MVP interface. Do not leave the
old payment-operations dashboard reachable beside a new workspace, and do not
keep components whose labels or actions contradict the backend contract.

| Legacy item | Required disposition | Replacement / proof |
|---|---|---|
| Existing generic dashboard metrics and “loaded window” claims | Replace with canonical incident lifecycle, evaluation metrics, and explicit Test Mode/simulation labels. | Fixture and API response snapshot proves every displayed number has a source. |
| Old incident detail, `rules-v1` investigation, and generic action proposal UI | Replace or adapt every field to Supervisor, Risk Analyst, Recovery Planner, deterministic policy, and proposal schemas. | Infrastructure/fraud/unavailable-enrichment fixtures render correctly. |
| Old direct action controls (`monitor`, `review`, `follow-up`, `dismiss`, escalation) | Remove buttons and handlers that call the retired action API. Keep only the deliberate proposal-approval interaction. | Browser network test confirms no retired action request is sent. |
| Old autonomy-policy management panel | Remove unless it is rebuilt on the new deterministic policy contract; it must not imply automatic outreach or financial action. | No stale policy UI is reachable; policy rationale is shown in investigation detail. |
| Connection/history-import/demo screens that bypass the pipeline | Remove, or adapt to show only durable Test Mode webhook/worker health. | Every visible event reaches the same event → queue → incident pipeline. |
| Browser-visible static API-token guidance and obsolete API paths | Remove from settings, errors, docs links, source code, and build-time environment examples when minimal session transport replaces it. | Bundle/source search finds no exposed token or retired route. |
| Marketing/showcase copy that claims live Vulcan, customer messaging, revenue recovery, or financial automation | Rewrite or remove. | Copy explicitly says heuristic/fixture source and simulated communications/Test Mode metrics. |
| Unused old components, types, CSS, tests, and route state | Delete after replacement is verified. | TypeScript build and route/import search show no dead consumers. |

**Removal verification:** navigate every desktop/mobile route, inspect network
requests, and search the frontend for retired action names, old API paths,
`rules-v1`, static token use, and unsupported direct-Vulcan/live-delivery copy.

- [x] Replace root and deployment documentation that advertised the legacy
  dashboard, browser bearer token, Vercel backend, or automatic actions. The
  current implementation still requires the planned frontend/API replacement
  before source code can be deleted safely.
- [x] Replace the frontend environment template and local environment with only
  the public API origin and timeout. No frontend environment key now accepts a
  provider credential, checkout key, or API token.

## Phase 0 — contracts and shell

- [x] Replace frontend API types and runtime guards with the canonical schemas:
  organization-scoped event, enrichment, incident, investigation, risk
  analysis, recovery plan, policy decision, action proposal, audit entry,
  dashboard query, and evaluation report.
- [x] Add runtime guards for the currently exposed Agentic MVP health, incident
  list/detail (including every event, enrichment, and proposal), and audit
  responses. Unknown state/tiers, malformed amounts, invalid timestamps, and
  oversized lists fail visibly; guards for investigations, dashboard queries,
  and evaluation reports remain pending alongside their API endpoints.
- [x] Keep all backend values runtime-validated. Treat an unknown enum, invalid
  amount, malformed timestamp, or invalid agent object as a visible safe error,
  not a value to render.
- [x] Centralize API base URL, request timeout, authorization/session transport,
  cancellation, and error handling. Never put Razorpay, Supabase service-role,
  Mesh, or communications secrets in `VITE_*` variables.
- [x] Remove the conflicting legacy showcase/checkout bootstrapping rather than
  preserve it. The static Razorpay Checkout script is deleted. The restored
  four-stage walkthrough is presentation-only and routes into the same Test
  Mode, proposal-only operator workspace; it exposes neither checkout nor an
  alternate action surface.
- [x] Establish loading, empty, stale-data, error, and mobile-layout states for
  every operator screen before adding visual polish.
- [x] Inventory the current surface before replacement. **Retain and adapt:**
  the React/Vite shell, shared layout, visual primitives, responsive hooks, and
  INR formatting. **Replace:** `App.tsx`, `api.ts`,
  `types/paymentOps.ts`, and every `components/paymentops/*` data component;
  they call legacy `/api/payment-ops/*` routes and model an incompatible
  incident/action shape. **Delete after replacement:** `PolicyPanel`,
  `ConnectionPanel`, direct-action handlers, history import UI, and the browser
  API-token path. **Review/rewrite:** showcase copy in `sections/*` that claims
  policy autonomy, auto-execution, or recovery. The pre-migration frontend
  production build passes; no legacy file is deleted until its canonical
  replacement builds and is reachable.
- [x] Replace the legacy entry point with the tenant-scoped Agentic MVP
  incident workspace. It consumes `/api/mvp/health`, `/incidents`, incident
  detail, and audit reads; it contains explicit Test Mode/proposal-only copy
  and no old direct-action controls. Proposal and investigation panels are
  implemented; metrics remain a later phase.
- [x] Delete unreferenced PaymentOps dashboard components, checkout flow,
  policy editor, old API/types, browser token environment typing, and unused
  showcase/autonomy components after the replacement workspace built cleanly.
  Remove the now-unused package dependencies from the root lock manifest;
  complete clean-install pruning is part of final verification.
- [x] Regenerate both package locks after removal and verify clean installs
  (`npm ci --ignore-scripts`) plus production builds. The backend replaces the
  deprecated, leak-prone development reloader with `tsx watch`; package audits
  report no production vulnerabilities.
- [x] Add request cancellation and unmount guards for refresh/detail loading;
  a rapid refresh or incident change aborts its prior request and cannot write
  stale state after a newer request or component unmount.
- [x] Harden the restored walkthrough: mobile scroll position now synchronizes
  keyboard navigation, all animation/timer/listener work is cleaned up on
  unmount, and leaving the workspace aborts non-mutating dashboard reads
  without showing an abort as an operator error. Its copy is propose-only;
  it makes no automatic-outreach or financial-action claim.

**Gate:** production build passes and fixture API responses render without a
console error, data leak, or type-validation bypass.

## Phase 1 — agentic incident workspace

- [x] Replace the old generic payment-operations overview with an MVP workspace
  centred on the full lifecycle: received → enriched → correlated → investigated
  → proposed/escalated → resolved.
- [x] Show queue/health state: Test Mode badge, database/worker readiness,
  webhook status, current enrichment adapter, and an explicit `simulated` badge
  where appropriate.
- [x] Build incident queue filters for OPEN, MONITORING, ESCALATED,
  DISPUTE_OPENED, RESOLVED, HUMAN_RESOLVED, and DISMISSED. Include deterministic
  sort, empty state, error state, and pagination/cursor handling if API returns
  it.
- [x] Build incident detail with amount at risk, recovered/remaining amounts,
  risk tier, lifecycle state, chronologically ordered normalized timeline, and
  a clear late/out-of-order event marker.
- [x] Build an enrichment panel that displays failure attribution, gateway
  health proxy, downtime state, retry-method recommendation, signals used, and
  source label. For `unavailable`, show no score and state that human review is
  required.
- [x] Ensure all money values use INR paise conversion, date values show a
  timezone-aware readable format, and no raw webhook payload/PII can reach a
  component or browser log.

**Gate:** signed local fixtures and the seeded backend show the same incident
state and heuristic-source label in desktop and 390px mobile layouts.

- [ ] Deploy this current Vite build after the backend redeploy, then verify
  the public Vercel workspace can approve a pending proposal with the demo
  token, receives the simulated result, and has no browser console/network
  error. The current public frontend is reachable but may still reference the
  preceding backend bundle.

## Phase 2 — investigation and policy explanation

- [x] Build Supervisor panel: hypothesis, failure category, confidence,
  reasoning, human-review requirement, selected sub-agents, allowed context
  fields, model ID, token use, and latency.
- [x] Build Risk Analyst panel: root cause, evidence strength, confidence,
  false-positive cost, evidence items, and missing evidence. Explicitly label
  fixture/heuristic data and absent signals.
- [x] Build Recovery Planner panel: approved action proposals only, rationale,
  estimated recovery, recovery probability, confidence, Hinglish script where
  present, and no-action reason where present.
- [x] Enforce display-side safety: an action type outside the approved allowlist
  renders as an invalid-response error; never offer a button for it.
- [x] Build deterministic Policy Evaluator explanation: every gate considered,
  matched policy, contact-limit result, auto-resolve budget, human-review floor,
  outcome, and escalation reason.
- [x] Clearly distinguish `auto_resolve_infrastructure` (a recorded internal
  decision) from a payment operation. It must never resemble a capture, refund,
  subscription edit, or customer message.
- [x] Add investigation run status states: pending/running/complete/failed;
  failures and unavailable enrichment visibly route the operator to review.

**Gate:** infrastructure, fraud, unavailable-enrichment, and invalid-model
fixture results are understandable from the UI without reading server logs.

### Phase 0–2 implementation verification — 2026-08-22

- [x] Rechecked runtime guards, cancellation/unmount handling, lifecycle
  filters, bounded presentation data, enrichment labels, investigation/policy
  panels, and production Vite compilation. The source implementation covers
  the Phase 0–2 checklist.
- [x] Hardening recheck: the current production Vite build and dependency audit
  pass; a repository source search found no runnable PaymentOps, retired-route,
  static-token, direct-Vulcan, or live-delivery code. Empty former component
  folders contain no shipped source or import consumer.
- [ ] Public-browser proof remains pending until the current backend/frontend
  builds are deployed; it is tracked in the deployment row above.

## Phase 3 — proposal approval and tamper-evident audit

- [x] Build proposal cards with type, rationale/content, source incident,
  status, and explicit simulation label. The UI has no live-channel wording.
- [x] Provide a deliberate token-gated confirmation action for operator
  approval, with pending/error/success state and stale-incident protection on
  the server. The token is kept only in React memory and cleared after use;
  approval is the only MVP action endpoint the UI calls.
- [x] After approval, show the `LoggingCommunicationsAdapter` simulated result;
  it is explicitly labelled as no customer message sent, never as channel
  delivery.
- [x] Disable approval for non-pending proposals and explain recovery/dispute
  cancellations in the UI; the database also cancels them atomically.
- [x] Build an audit timeline with actor, event type, decision, rationale,
  confidence, time, sequence number, and enrichment snapshot label, while
  excluding internal hashes and session data from the browser response.
- [x] Add audit-integrity status from `verify_audit_chain`: the UI renders
  intact/broken status and the approval RPC rejects all approvals when the
  chain is broken, so it is a hard gate rather than a cosmetic warning.
- [x] Show minimal Demo operator/organization context without account or
  organization administration screens.

**Gate:** seeded operator approves a proposal and sees a simulated result plus
an intact, ordered audit chain; Org B data never appears in Org A UI tests.

## Phase 4 — Agentic Dashboard and metrics

- [x] Add a read-only natural-language dashboard input. It calls the
  tenant-scoped `dashboard/query` endpoint and renders only structured incident
  summaries, aggregate amounts, and server-supplied limitations.
- [x] Never interpret dashboard-query text in the browser as executable action,
  SQL, arbitrary filter, or cross-tenant selector. It is encoded as text only;
  prompt examples, cancellation, timeout, loading, and error paths use the
  shared API boundary.
- [x] Build the metrics view for precision, recall, F1, false-positive cost,
  total at risk, generated/approved proposals, attributed Test Mode recoveries,
  recovered paise, recovery rate, and contact-to-recovery ratio. The UI now
  renders every field; fields without a defensible source render `Not
  available`, never a synthetic zero.
- [x] Require evaluation metadata alongside metrics: development vs held-out,
  fixture set version, run time, configuration hash, model/adapter, and sample
  count. Before Phase 5's first report it explicitly states `not_run`.
- [x] Place the exception list alongside metrics: no COD/RTO decisioning, no
  dispute/fraud outreach, simulated communications/Test Mode recovery, no Live
  Mode, and no financial execution.
- [x] Add clear copy explaining that available values are Test Mode operational
  counts and that evaluation/recovery figures are not real merchant outcomes.

**Gate:** the surface cannot mistake a simulation for a real customer or
financial action. The report-trace portion remains a Phase 5 gate until the
development/held-out evaluation report exists.

### Phase 4 hardening recheck — 2026-08-23

- [x] Rebuilt the dashboard after adversarial query and unavailable-metric
  checks. Query cancellation/unmount cleanup, bounded input, explicit API
  guards, safe integer display, complete evaluation-state validation, and `Not
  available` rendering all pass; no legacy source/import remains in the
  shipped frontend.

## Phase 5 — UX, accessibility, and demo readiness

- [ ] Re-verify the restored walkthrough and workspace at deployed desktop,
  tablet, and 390px mobile after this frontend build is deployed: no horizontal
  overflow, clipped audit entries, inaccessible dialogs, or data-only color
  indicators. The prior 2026-08-23 browser pass found no horizontal overflow
  at 390px or 768px and no console warning/error, but it preceded the current
  visual restoration and cannot certify it.
- [x] Add keyboard focus, semantic headings, labelled controls, asynchronous
  live regions, readable contrast classes, and reduced-motion-safe behaviour.
  The current source also fixes React Strict Mode's cleanup/remount flag and
  keeps a successful approval visible when a later audit refresh fails.
- [ ] Test slow/retried backend requests, empty account, unavailable enrichment,
  queue delay, failed investigation, malformed API object, proposal cancellation,
  and stale approval responses.
- [x] Remove old dashboard labels, examples, API token instructions, and visual
  claims that conflict with the canonical buildathon MVP. Metrics now explain
  causal Test Mode recovery and the synthetic-fixture limitation without a
  revenue claim.
- [x] Verify `npm run build` has no warnings and record the current production
  bundle output (2026-08-23: 35.24 kB app / 134.67 kB React before gzip). Run a
  manual browser-console/network audit against the deployed Test Mode demo. A
  fresh `npm ci --ignore-scripts` verification also passed after stopping the
  local Vite server that had held a native Rollup binary lock; the exact
  lockfile install, production build, audit, and diff check are clean.
- [x] Complete a first deployed empty-state smoke check at
  `https://payscope-ai.vercel.app`: the workspace loaded the `agentic_mvp`
  health state and empty tenant-scoped incident list with no browser-console
  warnings or errors. `https://payscope.vercel.app` is a separate legacy
  payroll-login deployment and is not the PayScope operator URL.
- [x] Rechecked the current deployed workspace at desktop and 390px mobile:
  no console warnings/errors or horizontal overflow; health, incident detail,
  intact audit state, explicit exceptions, and the bounded read-only dashboard
  query all render with the current Test Mode data.
- [x] Update README and deployment copy for the exception list, Test Mode
  attribution rule, and evaluation-report procedure. Screenshots and final
  pitch flow remain pending until manually curated held-out evidence exists.
- [x] Delete obsolete components, styles, handlers, API validators, test
  fixtures, and imports after their replacements pass. Run a production build
  and source search to prove retired actions and claims are absent. Removed the
  empty former `components`, `hooks`, and `sections` directory shells as well.
- [ ] Run the complete browser integration sequence against the deployed or
  local durable backend: incident appears → investigation panels populate →
  proposal is approved → simulated result and audit entry appear → integrity
  status is intact → Agentic Dashboard query is read-only and tenant-scoped.

**Final MVP gate:** a reviewer can open the public Vercel UI, observe a Test
Mode incident travel through the agentic pipeline, approve a simulated proposal,
inspect its verified audit trail, query tenant-scoped data, and see honest
fixture/Test Mode metrics plus exceptions. No old dashboard, action, route,
claim, or hidden component can bypass or contradict this flow.

## Visual restoration from commit `d1a1e13`

- [x] Restore the source commit's four-stage product walkthrough as the default
  frontend entry: floating product navigation, full-viewport story sections,
  responsive scroll snapping, and the source visual language (obsidian grid,
  hairline surfaces, signal canvases, and restrained accent colors). The copy
  is updated to the locked agentic-MVP safety contract rather than restoring
  legacy autonomy or payment-action claims.
- [x] Transplant the actual source implementation for the walkthrough from
  commit `d1a1e13` (`SpatialScroll`, all four source sections, animated network
  layer, responsive mobile panel, source navbar, and its animation dependency)
  into the active React/Vite build. The temporary local reference clone was
  removed after the transplant; no cloned repository remains in `frontend/`.
- [x] Preserve a working route from the fourth section and product navigation
  into the current tenant-scoped Agentic MVP dashboard; existing API reads,
  proposal approval, audit-chain gate, and Test Mode labels were not replaced.
- [ ] Port the source commit's sidebar/section dashboard composition onto the
  current incident, investigation, metrics, and audit schemas. Do not restore
  legacy `/api/payment-ops/*` requests, token-in-browser guidance, connection
  imports, policy mutation, checkout, or direct incident-action controls.
- [ ] Visually compare the local restored walkthrough and dashboard with the
  source commit at desktop and 390px, then capture the exact remaining
  differences before deployment. `design-qa.md` is currently blocked because
  this Desktop browser cannot resolve the local preview; this row must not be
  checked from a TypeScript build alone.
