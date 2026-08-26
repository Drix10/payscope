# PayScope 5-minute Demo Kit & Operator Studio

This kit is a **local operator studio for a production-hosted test-mode demo**. You run the Demo Operator Studio on your laptop (`npm start`); it sends HMAC-signed Razorpay-shaped test webhooks to the PayScope API. The API, queue worker, structured multi-agent AI pipeline, execution worker, database, audit chain, and frontend process those events in real time.

It demonstrates complete payment-operations behavior: signed intake, Razorpay Vulcan AI real-time telemetry ingestion, duplicate delivery, order correlation, dispute hard stops, policy safety gates, Nodemailer SMTP email dispatch, and verified Payment Link reconciliation.

It never calls a financial write API directly. The only provider-facing operation is sending signed test webhook payloads to PayScope. Keep the Razorpay account in test mode and use a dedicated demo organization.

---

## Files & Architecture

- `scripts/ui-server.mjs` - Zero-dependency native Node.js HTTP server serving the visual Demo Operator Studio UI at `http://127.0.0.1:3050`.
- `public/index.html` - Interactive glassmorphism dark-mode UI control panel for triggering scenarios, configuring real Razorpay test IDs, and streaming live events.
- `RUNBOOK.md` - Recording plan, video narration guide, exact checkpoints, and fallback options.
- `scripts/demo-preflight.mjs` - Verifies environment, API health, tenant organization UUID match, and test-mode safety.
- `scripts/send-webhook.mjs` - Constructs and HMAC-signs Razorpay test webhooks (with optional real Razorpay Test API payment lookups).
- `scripts/verify-demo.mjs` - Asserts that expected incidents, executions, and audit projections are visible in the production database.
- `scripts/self-test.mjs` - Verifies HMAC signature generation and duplicate detection locally.

---

## Standalone Quick Start

Run these commands from `docs/demo-kit`:

```powershell
Set-Location docs/demo-kit
Copy-Item .env.example .env
# Edit .env with your deployed test-mode values, then launch the visual studio:
npm start
```

### Visual Demo Operator Studio (`http://127.0.0.1:3050`)

Running `npm start` automatically boots the web studio. It features:

1. **Preflight Health Bar:** Real-time indicator checking API health, Razorpay `test` environment mode, and organization UUID matching.
2. **Real Razorpay Test Credentials & IDs Panel:** Live inputs to set and save real Razorpay payment IDs (`pay_...`), Payment Link references (`ps_...`), and key pairs. Saving updates `.env` on disk automatically.
3. **1-Click Scenario Trigger Grid:** Dispatch HMAC-signed webhooks live for:
   - ⚡ **Authentic Failed Payment** (with real Razorpay lookup if payment ID set)
   - 🔁 **Exact Duplicate Webhook Delivery** (proves HMAC verification & duplicate suppression)
   - 🛑 **Dispute Hard Stop Safety Gate** (demonstrates policy block on open disputes)
   - ✅ **Verified Razorpay Reconciliation** (links paid callback to PayScope Payment Link reference)
4. **Automated 5-Minute Sequence Runner:** Executes the complete video sequence with narration pause countdowns.
5. **Live Operator Output Stream:** Real-time console displaying HTTP status codes, duplicate flags, HMAC signature hashes, and returned event IDs.

---

## Step-by-Step Operator Guide

### 1. Environment Setup

Configure `docs/demo-kit/.env`:

```dotenv
PAYSCOPE_DEMO_API_URL=https://<your-deployed-api-url>
PAYSCOPE_DEMO_WEBHOOK_SECRET=<same-secret-as-deployed-backend>
PAYSCOPE_DEMO_ORGANIZATION_ID=<deployed-demo-organization-uuid>
PAYSCOPE_DEMO_RAZORPAY_ENVIRONMENT=test

# Optional Real Razorpay Test Credentials (for real enrichment):
PAYSCOPE_DEMO_RAZORPAY_KEY_ID=rzp_test_...
PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET=<test-key-secret>

# Optional Real Test IDs:
PAYSCOPE_DEMO_FAILED_PAYMENT_ID=pay_...
PAYSCOPE_DEMO_CAPTURED_PAYMENT_ID=pay_...
PAYSCOPE_DEMO_PAYMENT_LINK_REFERENCE=ps_...
```

### 2. Pre-Recording Preflight Check

Before starting your recording session:

1. Run `npm run self-test` to verify local HMAC signing logic.
2. Launch `npm start` and check that the header reports **`API Preflight Ready`**.
3. Open your deployed PayScope frontend dashboard in a secondary browser window or display monitor.

### 3. Executing & Testing Scenarios Live

- **Authentic Payment Failure:** Click **"Trigger Failure Event"**. Watch the incident appear live in the PayScope incident feed with risk tier, cause analysis, and policy decision.
- **Duplicate Delivery:** Click **"Re-send Duplicate Event"**. Verify that PayScope returns HTTP 200 with `duplicate: true`, preventing duplicate incident or outreach creation.
- **Dispute Hard Stop:** Click **"Trigger Dispute Event"**. Show the policy gate transition to `DISPUTE_OPENED` with 0 customer outreach actions.
- **Verified Reconciliation:** Click **"Trigger Reconciliation"**. Show how a verified Razorpay `payment_link.paid` event confirms causal recovery.

---

## Scenario Matrix

| Scenario | Local Studio Behavior | Production API Effect | Dashboard Evidence |
|---|---|---|---|
| Synthetic Failed Payment | Sends signed `payment.failed` with fake IDs | Event enqueued; pipeline investigates | Incident timeline, degraded evidence, policy decision |
| Exact Duplicate Replay | Sends identical event ID again | Idempotency layer detects duplicate | HTTP `duplicate: true`, no second incident |
| Same-Order Correlation | Sends failure with matching order ID | Correlates failure to existing incident | Single incident containing multiple failure events |
| Dispute Hard Stop | Sends signed `payment.dispute.created` | Critical dispute incident created | `DISPUTE_OPENED`, policy block, zero outreach actions |
| Real Failed Payment | Fetches payment via Razorpay Test API, then sends fields | Production enrichment reads real Razorpay fields | `razorpay_fields_heuristic`, provider signals |
| Real Payment Link Paid | Sends callback with PayScope reference + captured payment ID | Reconciliation confirms causal action | Receipt, callback, confirmed outcome |

---

## Safety Rules

- **Never** set `PAYSCOPE_DEMO_RAZORPAY_ENVIRONMENT=live`. The kit enforces `test` mode.
- **Never** show secrets, API key secrets, or authorization headers on camera.
- Run `npm start` before recording to ensure the API target is reachable and preflight passes.
- Do not claim an email was *"delivered"* for SMTP acceptance—describe it as **"SMTP accepted"**.
- Describe recovery as **"Confirmed outcome"** only after the signed `payment_link.paid` callback is processed.
