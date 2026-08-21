# PayScope dashboard: delivery record

> Single repo: `backend/` + `frontend/` → deploy `frontend/` on Vercel. Legacy Intent Canvas is in its own repos.

## Current product boundary

This dashboard is the operator surface for PayScope. It makes verified Razorpay events, correlated incidents, agent evidence, recommendations, and recorded human decisions visible in one reviewable workflow.

## Implemented

- Connection readiness for Razorpay Test/Live configuration without exposing secrets to the browser.
- Live dashboard metrics, recent verified events, and a prioritized incident queue with an all-incidents audit view.
- Evidence, investigation, confidence, recommendation, missing context, and audit trail for a selected incident, with a bounded newest-first timeline for high-volume incidents.
- Explicit human controls to record monitor, review, follow-up, escalation, or dismissal decisions, plus an **Autonomy policies** panel where an admin configures thresholds (type, severity, confidence, amount cap) for agent auto-execution. Auto-actions appear as `agent:policy/<id>` in the audit trail.
- A bounded payment-history import control and clear event-window coverage indicators.
- Runtime API payload validation, abortable requests, polling only while the tab is visible, loading/error/empty states, and responsive layouts.

## Before a production launch

1. Set `VITE_API_BASE_URL` (Vercel URL of backend) and `VITE_API_ACCESS_TOKEN` only for the protected API, never Razorpay or Supabase service keys.
2. Configure the deployed API's exact Vercel origin in `CORS_ORIGINS`.
3. Add operator sign-in and tenant-aware authorization before inviting multiple customers.
4. Replace the temporary token entry mechanism with a secure session flow.
5. Verify all states with an empty account, an unsigned webhook failure, duplicate webhook delivery, slow network, and mobile viewport.

## Verification standard

- `npm run build` must pass without console warnings.
- The dashboard must not invent payment data: it renders only values returned by the API.
- No dashboard action performs a financial operation. It records the operator's decision with its timestamp and actor.
