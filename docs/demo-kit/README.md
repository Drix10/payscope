# PayScope 5-minute demo kit

This kit is a **local operator kit for a production-hosted test-mode demo**. You run the Node scripts on your laptop; they send signed Razorpay-shaped test webhooks to the deployed PayScope API. The deployed API, queue worker, AI pipeline, execution worker, database, audit chain, and frontend process those events. The scripts do not run the PayScope backend locally and do not send webhooks to Razorpay.

It demonstrates difficult payment-operations behavior: signed intake, duplicate delivery, correlation, dispute hard stops, policy no-action, real Razorpay enrichment, SMTP acceptance, and verified Payment Link reconciliation.

It never calls a financial write API directly. The only provider-facing operation is sending signed test webhook payloads to PayScope. Keep the Razorpay account in test mode and use a dedicated demo organization.

## Files

- `RUNBOOK.md` - recording plan, narration, exact checkpoints, and fallback narration.
- `scripts/demo-preflight.mjs` - verifies environment, API health, and test-mode safety.
- `scripts/send-webhook.mjs` - sends one signed Razorpay test webhook or a named scenario.
- `scripts/run-demo.mjs` - runs the scripted synthetic event sequence with pauses.
- `scripts/verify-demo.mjs` - checks that the expected incident count and lifecycle states are visible.
- `payloads/` - optional captured request bodies for review; generated payloads are not committed by default.

## Standalone quick start

This directory is the third standalone project. Run these commands from `docs/demo-kit`, not from `backend` or `frontend`:

```powershell
Set-Location docs/demo-kit
Copy-Item .env.example .env
# Edit .env with the deployed test-mode values, then:
npm run self-test
npm run start
```

`npm run start` performs all three stages and stops on failure:

1. `preflight` checks the deployed API, organization, and Razorpay test mode.
2. `demo` sends the signed synthetic event sequence from the laptop to the deployed webhook.
3. `verify` reads the deployed incident, execution, and audit projections.

The frontend is opened separately at its deployed URL. `npm run start` does not launch a browser or a second frontend server; it drives the already deployed backend whose live results appear in the frontend.

For individual stages:

```powershell
npm run preflight
npm run demo
npm run verify
```

The organization ID is used only as a local assertion against the API response. It is not sent in webhook payloads. The production API origin is the value of `PAYSCOPE_DEMO_API_URL`; local execution of these scripts does not make the dashboard local.

## Backend environment mapping

Do not copy the backend `.env` wholesale into this project. The standalone kit needs only the public demo target and the test webhook secret:

| Backend value | Demo-kit value | Why |
|---|---|---|
| `CORS_ORIGINS` / deployed API origin | `PAYSCOPE_DEMO_API_URL` | Where local scripts send requests |
| `RAZORPAY_WEBHOOK_SECRET` | `PAYSCOPE_DEMO_WEBHOOK_SECRET` | Signs the exact webhook body |
| `PAYSCOPE_ORGANIZATION_ID` | `PAYSCOPE_DEMO_ORGANIZATION_ID` | Verifies the deployment tenant |
| `RAZORPAY_ENVIRONMENT` | `PAYSCOPE_DEMO_RAZORPAY_ENVIRONMENT` | Must be `test` |
| `RAZORPAY_KEY_ID` and key secret | `PAYSCOPE_DEMO_RAZORPAY_KEY_ID` and secret | Optional, read-only real enrichment lookup |

Never put `SUPABASE_SERVICE_ROLE_KEY`, `MESH_API_KEY`, `SMTP_PASS`, `PAYSCOPE_EMAIL_ENCRYPTION_KEY`, or backend database URLs in the demo-kit `.env`. They belong only on the VPS. The webhook secret is sensitive too; keep `.env` untracked and never show it in the recording.

## Deployment topology

```text
Laptop demo scripts
	├─ signed webhook HTTP POST ───────────────> temp.coslynx.com/webhooks/razorpay
	├─ read-only API verification <──────────── temp.coslynx.com/api/mvp/*
	└─ optional read-only payment lookup ──────> api.razorpay.com/v1/payments/:id

Production VPS/API -> Supabase queue -> enrichment -> AI/policy -> execution worker
Production frontend <────────────────────────────── read-only projections
```

The deployed API must use the same Razorpay Test account as the local real-enrichment lookup. The webhook secret must match the deployed backend secret. The local script signs the exact body it sends; Razorpay itself is not the source of these synthetic webhook deliveries.

## Environment setup

Use a temporary PowerShell session so demo credentials are not persisted in your user profile:

```powershell
$env:PAYSCOPE_DEMO_API_URL = "https://temp.coslynx.com"
$env:PAYSCOPE_DEMO_WEBHOOK_SECRET = "<same-test-webhook-secret-as-deployed-backend>"
$env:PAYSCOPE_DEMO_ORGANIZATION_ID = "<deployed-demo-organization-uuid>"
$env:PAYSCOPE_DEMO_RAZORPAY_ENVIRONMENT = "test"
```

For real enrichment only, also set the Razorpay **test** key pair. These are used for one read-only `GET /v1/payments/:id`; they are never printed:

```powershell
$env:PAYSCOPE_DEMO_RAZORPAY_KEY_ID = "rzp_test_..."
$env:PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET = "<test-key-secret>"
```

Run from the repository root. All commands should pass before recording:

```powershell
node docs/demo-kit/scripts/self-test.mjs
node docs/demo-kit/scripts/demo-preflight.mjs
node docs/demo-kit/scripts/run-demo.mjs --pause-ms 4000
node docs/demo-kit/scripts/verify-demo.mjs
```

The sequence is repeatable only when event IDs are changed or the demo database is reset. Reusing the same event IDs intentionally demonstrates idempotency and returns `duplicate: true`.

### Automatic real-payment mode

Fill the optional payment slots in `.env` and run the same command. The standalone runner automatically behaves as though the corresponding `--payment-id` flags were supplied:

```dotenv
PAYSCOPE_DEMO_FAILED_PAYMENT_ID=pay_failed_test_id
PAYSCOPE_DEMO_RELATED_PAYMENT_ID=pay_related_test_id
PAYSCOPE_DEMO_CAPTURED_PAYMENT_ID=pay_captured_test_id
PAYSCOPE_DEMO_PAYMENT_LINK_REFERENCE=ps_35_character_reference
```

With the failed slot filled, stages 1-3 use read-only Razorpay Test lookups and send real provider fields to production. With the captured slot and Payment Link reference filled, stage 5 sends the signed reconciliation callback automatically. The captured payment must belong to the Payment Link identified by that reference; otherwise the demo must not claim verified recovery.

## Real Razorpay enrichment

The synthetic scenarios intentionally exercise degraded enrichment. To exercise the real Razorpay enrichment path, create a failed payment in Razorpay Test Checkout, then pass its payment ID to the sender. The lookup is read-only; the script never creates or mutates a Razorpay payment.

```powershell
$env:PAYSCOPE_DEMO_RAZORPAY_KEY_ID = "rzp_test_..."
$env:PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET = "..."
node docs/demo-kit/scripts/send-webhook.mjs --scenario failed-payment --event-id demo-real-failed-001 --payment-id pay_...
```

The payment must already exist in the same Razorpay test account used by the deployed enrichment client. A real captured payment cannot be relabeled as failed. For a real `payment_link.paid` callback, use the Payment Link reference generated by PayScope and a test payment completed through Razorpay Checkout.

For that callback, include the captured payment ID so enrichment also reads the real payment:

```powershell
node docs/demo-kit/scripts/send-webhook.mjs --scenario payment-link-paid --event-id demo-real-paid-001 --reference-id ps_<reference> --payment-id pay_...
```

## Scenario matrix

| Scenario | Local command behavior | Production-side effect | Frontend evidence |
|---|---|---|---|
| Synthetic failed payment | Sends signed `payment.failed` with fake provider IDs | Enrichment logs unavailable; event must still enter the durable pipeline | Incident timeline, degraded evidence, policy result |
| Exact replay | Sends the same event ID and payload again | No second event/incident/action | HTTP `duplicate: true`, same returned event ID |
| Same-order correlation | Sends another failed event with the same order ID | Related evidence should join the same incident when the prior incident is non-terminal | One incident with multiple events |
| Dispute hard stop | Sends signed `payment.dispute.created` | Critical dispute incident; no outreach action | `DISPUTE_OPENED`, blocked policy, zero execution actions |
| Real failed payment | Looks up an existing Razorpay Test payment, then sends its fields | Production enrichment reads the same real payment | `razorpay_fields_heuristic`, provider signals, enriched audit data |
| Consent withdrawn | Send an eligible failure after suppressing the dedicated recipient | No Payment Link and no SMTP dispatch | Blocked/no-send action and audit reason |
| Ambiguous SMTP | Fault-inject or stop worker after durable send marker | Action becomes unreconciled; retry must not send again | `unreconciled`, `SMTP_RESULT_AMBIGUOUS_NO_RESEND` |
| Real Payment Link paid | Send a callback with the PayScope reference and real captured test payment ID | Reconciliation can confirm only the matching action | Receipt, callback, confirmed causal outcome |

The synthetic failed and dispute scenarios use different IDs, customers, and orders by design, so they may appear as separate incidents. Do not narrate them as one incident. Use the same real order/payment identity when demonstrating correlation.

## Safety rules

- Do not set `PAYSCOPE_DEMO_RAZORPAY_ENVIRONMENT=live`.
- Do not put production credentials in the shell, recording, or payload directory.
- Run preflight before recording. It aborts when the API reports live Razorpay mode.
- Use a separate demo organization and a non-real customer ID such as `cust_demo_edge_case_01`.
- Do not show webhook secrets, SMTP credentials, API keys, raw email addresses, or authorization headers on screen.
- Without `--payment-id`, the `payment_link.paid` scenario is a synthetic signed callback and should be described as such. With `--payment-id`, its payment fields come from a real Razorpay Test payment, but the callback is still locally generated and signed.
- If direct execution is enabled, use only the dedicated test recipient enrolled for the demo and confirm its consent before recording.
