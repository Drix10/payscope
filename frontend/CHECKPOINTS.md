# PayScope frontend — locked MVP execution checklist

**Canonical specification:** [`../Plan.md`](../Plan.md). This checklist replaces
the legacy dashboard delivery record. It describes work still to do; it does not
claim the new agentic MVP is already implemented.

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

- [ ] Replace frontend API types and runtime guards with the canonical schemas:
  organization-scoped event, enrichment, incident, investigation, risk
  analysis, recovery plan, policy decision, action proposal, audit entry,
  dashboard query, and evaluation report.
- [x] Add runtime guards for the currently exposed Agentic MVP health, incident
  list/detail (including every event, enrichment, and proposal), and audit
  responses. Unknown state/tiers, malformed amounts, invalid timestamps, and
  oversized lists fail visibly; guards for investigations, dashboard queries,
  and evaluation reports remain pending alongside their API endpoints.
- [ ] Keep all backend values runtime-validated. Treat an unknown enum, invalid
  amount, malformed timestamp, or invalid agent object as a visible safe error,
  not a value to render.
- [ ] Centralize API base URL, request timeout, authorization/session transport,
  cancellation, and error handling. Never put Razorpay, Supabase service-role,
  Anthropic, or communications secrets in `VITE_*` variables.
- [ ] Preserve the existing public product showcase only if it does not conflict
  with the new agentic narrative; its copy must not claim unimplemented direct
  Vulcan or live recovery capabilities.
- [ ] Establish loading, empty, stale-data, error, and mobile-layout states for
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
  and no old direct-action controls. The canonical proposal/investigation and
  metrics panels remain unfinished.
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

**Gate:** production build passes and fixture API responses render without a
console error, data leak, or type-validation bypass.

## Phase 1 — agentic incident workspace

- [ ] Replace the old generic payment-operations overview with an MVP workspace
  centred on the full lifecycle: received → enriched → correlated → investigated
  → proposed/escalated → resolved.
- [ ] Show queue/health state: Test Mode badge, database/worker readiness,
  webhook status, current enrichment adapter, and an explicit `simulated` badge
  where appropriate.
- [ ] Build incident queue filters for OPEN, MONITORING, ESCALATED,
  DISPUTE_OPENED, RESOLVED, HUMAN_RESOLVED, and DISMISSED. Include deterministic
  sort, empty state, error state, and pagination/cursor handling if API returns
  it.
- [ ] Build incident detail with amount at risk, recovered/remaining amounts,
  risk tier, lifecycle state, chronologically ordered normalized timeline, and
  a clear late/out-of-order event marker.
- [ ] Build an enrichment panel that displays failure attribution, gateway
  health proxy, downtime state, retry-method recommendation, signals used, and
  source label. For `unavailable`, show no score and state that human review is
  required.
- [ ] Ensure all money values use INR paise conversion, date values show a
  timezone-aware readable format, and no raw webhook payload/PII can reach a
  component or browser log.

**Gate:** signed local fixtures and the seeded backend show the same incident
state and heuristic-source label in desktop and 390px mobile layouts.

## Phase 2 — investigation and policy explanation

- [ ] Build Supervisor panel: hypothesis, failure category, confidence,
  reasoning, human-review requirement, selected sub-agents, allowed context
  fields, model ID, token use, and latency.
- [ ] Build Risk Analyst panel: root cause, evidence strength, confidence,
  false-positive cost, evidence items, and missing evidence. Explicitly label
  fixture/heuristic data and absent signals.
- [ ] Build Recovery Planner panel: approved action proposals only, rationale,
  estimated recovery, recovery probability, confidence, Hinglish script where
  present, and no-action reason where present.
- [ ] Enforce display-side safety: an action type outside the approved allowlist
  renders as an invalid-response error; never offer a button for it.
- [ ] Build deterministic Policy Evaluator explanation: every gate considered,
  matched policy, contact-limit result, auto-resolve budget, human-review floor,
  outcome, and escalation reason.
- [ ] Clearly distinguish `auto_resolve_infrastructure` (a recorded internal
  decision) from a payment operation. It must never resemble a capture, refund,
  subscription edit, or customer message.
- [ ] Add investigation run status states: pending/running/complete/failed;
  failures and unavailable enrichment visibly route the operator to review.

**Gate:** infrastructure, fraud, unavailable-enrichment, and invalid-model
fixture results are understandable from the UI without reading server logs.

## Phase 3 — proposal approval and tamper-evident audit

- [ ] Build proposal cards with type, content, source incident, proposal time,
  rationale, simulation label, status, and permitted action boundary.
- [ ] Provide a deliberate confirmation action for operator approval, with
  pending/error/success state and stale-incident protection. Approval is the
  only MVP action endpoint the UI calls.
- [ ] After approval, show `simulated delivery` from the
  `LoggingCommunicationsAdapter`; never display it as WhatsApp/SMS/email/voice
  delivery.
- [ ] Disable/cancel a pending proposal when API state reports recovery or an
  open dispute. Explain the cancellation in the UI.
- [ ] Build audit timeline with actor, event type, decision, rationale,
  confidence, time, sequence number, and enrichment snapshot label.
- [ ] Add audit-integrity status from `verify_audit_chain`: intact, checking,
  broken, or unavailable. A broken chain is a blocking alert, never a silent
  cosmetic warning.
- [ ] Show the minimal operator/organization context but do not build account or
  organization administration screens.

**Gate:** seeded operator approves a proposal and sees a simulated result plus
an intact, ordered audit chain; Org B data never appears in Org A UI tests.

## Phase 4 — Agentic Dashboard and metrics

- [ ] Add a read-only natural-language dashboard input. It submits to the
  tenant-scoped `dashboard/query` endpoint and renders only structured incident
  summary, metrics, evidence references, and explicit limitations returned by
  the API.
- [ ] Never interpret dashboard-query text in the browser as executable action,
  SQL, arbitrary filter, or cross-tenant selector. Provide prompt examples and
  cancellation/error/timeout states.
- [ ] Build metrics view with fixture-evaluation precision, recall, F1,
  false-positive cost, total at risk, generated/approved proposals, attributed
  Test Mode recoveries, recovered paise, recovery rate, and contact-to-recovery
  ratio.
- [ ] Require evaluation metadata alongside metrics: development vs held-out,
  fixture set version, run time, configuration hash, model/adapter, and sample
  count. Render divide-by-zero metrics as `Not available`.
- [ ] Place the exception list before or alongside metrics: heuristic/fixture
  enrichment status, simulated communications, simulated Test Mode recovery,
  no COD/RTO decisioning, no dispute/fraud outreach, no Live Mode, and no
  financial execution.
- [ ] Add clear copy explaining that metrics are fixture/Test Mode results, not
  real merchant production outcomes.

**Gate:** a reviewer can trace every headline number to the API evaluation
report and cannot mistake a simulation for a real customer or financial action.

## Phase 5 — UX, accessibility, and demo readiness

- [ ] Verify desktop, tablet, and 390px mobile workspace layouts; no horizontal
  overflow, clipped audit entries, inaccessible dialogs, or data-only color
  indicators.
- [ ] Add keyboard focus, semantic headings, live regions for async status,
  labelled controls, readable contrast, and reduced-motion-safe behaviour.
- [ ] Test slow/retried backend requests, empty account, unavailable enrichment,
  queue delay, failed investigation, malformed API object, proposal cancellation,
  and stale approval responses.
- [ ] Remove old dashboard labels, examples, API token instructions, and visual
  claims that conflict with the canonical buildathon MVP.
- [ ] Verify `npm run build` has no warnings; record bundle output and run a
  manual browser-console/network audit against the deployed Test Mode demo.
- [ ] Update README/demo copy, screenshots, and pitch flow only after the
  backend evaluation report and exception list are final.
- [ ] Delete obsolete components, styles, handlers, API validators, test
  fixtures, and imports after their replacements pass. Run a production build
  and search the bundle/source to prove retired actions and claims are absent.
- [ ] Run the complete browser integration sequence against the deployed or
  local durable backend: incident appears → investigation panels populate →
  proposal is approved → simulated result and audit entry appear → integrity
  status is intact → Agentic Dashboard query is read-only and tenant-scoped.

**Final MVP gate:** a reviewer can open the public Vercel UI, observe a Test
Mode incident travel through the agentic pipeline, approve a simulated proposal,
inspect its verified audit trail, query tenant-scoped data, and see honest
fixture/Test Mode metrics plus exceptions. No old dashboard, action, route,
claim, or hidden component can bypass or contradict this flow.
