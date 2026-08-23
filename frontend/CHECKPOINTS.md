# PayScope frontend — autonomous operations checklist

**Canonical specification:** [`../Plan.md`](../Plan.md). The frontend is a read-only explanation layer for autonomous system behavior, not a place where a merchant approves or manually operates incidents.

## Legacy removal

- [x] Remove approval-token state, approval API calls, proposal-approval types, approval buttons/panels, manual resolution/dismiss controls, and related error states.
- [x] Remove human-review lifecycle/filter/label handling, operator identity, manual-work wording, review-next experiments, and false task CTAs.
- [x] Remove browser-native white filter controls; dark, accessible custom controls remain the only dashboard filters.
- [x] Remove active product references to a restricted credential environment. The UI explains the simulation boundary rather than the source credential environment.
- [x] Delete obsolete communications-adapter presentation code and any client-side secret/provider-action assumptions.

## Dashboard experience

- [x] Provide a landing narrative that explains PayScope before dashboard entry: signed signals, evidence, bounded AI, deterministic policy, simulation, and auditability.
- [x] Keep dashboard interactions limited to navigation, filtering, and reading incident detail; no interaction sends a write request.
- [x] Render incident lifecycle, at-risk context, source labels, verified event chronology, current outcome, and actual persisted stages only—never fabricated progress.
- [x] Render an AI outcome record with Supervisor objective, causal risk narrative, alternative hypotheses, evidence gaps, recovery proposal/preconditions/expected outcome, deterministic gate trace, and simulated/no-action result.
- [x] Render audit entries and audit-chain integrity separately from AI reasoning so users can distinguish evidence, inference, policy, and durable system record.
- [x] Show metrics with explicit simulation and exception context; never present simulated recovery as real merchant revenue.
- [x] Keep loading, empty, error, abort, stale-response, and unsupported-payload states understandable and non-blocking.

## Contract and security boundary

- [x] Validate all health, incident, investigation, proposal, audit, and metrics response shapes at the API boundary.
- [x] Reject retired human/approval payload fields and accept enhanced structured agent contracts, including compatibility-normalized historical records.
- [x] Read only the public backend API origin from frontend environment configuration; the bundle contains no Razorpay key, webhook secret, Mesh key, or Supabase service role.
- [x] Default to safe read-only degradation when an API response is malformed or unavailable.

## Accessibility and visual QA

- [x] Keep the dark visual system consistent across landing, dashboard, menus, cards, empty states, and mobile layouts.
- [x] Give interactive controls discernible labels, keyboard focus, Escape handling for menus, and accurate expanded/selected ARIA states.
- [x] Ensure incident timeline, AI outcome, policy rationale, and audit content wrap rather than clip at narrow widths.
- [x] Ensure state counters communicate information, not an unfulfilled call to action.

## Verification completed in source

- [x] Vite/TypeScript production build passes.
- [x] Production dependency audit reports no high-severity vulnerability.
- [x] Dashboard API guards and read-only interaction tests cover autonomous incident, detail, audit, and metrics contracts.
- [x] Dead-code review confirms no active approval/manual/human-review controls remain.

## Environment-owned completion gates

- [ ] Browser-test the deployed backend/frontend together with a real representative incident: open, filter, inspect, and verify no browser write request is issued.
- [ ] Capture the four committed showcase frames listed in [`../docs/screenshots/README.md`](../docs/screenshots/README.md) from the deployed responsive interface.
- [ ] Test desktop and mobile breakpoints with long evidence text, no incident data, malformed API response, slow API, and an incident with no action; resolve any clipped or confusing state before submission.
- [ ] Deploy Vercel with only the public backend origin, verify allowed CORS origins, and verify the external dashboard never exposes a secret or provider payload.
