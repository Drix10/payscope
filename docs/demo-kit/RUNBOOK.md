# PayScope — Video Recording Script & Operator Guide

This guide provides a structured 5-minute video recording script and operator walkthrough for demonstrating PayScope.

---

## Preflight Setup

1. **Start the Demo Studio Harness:**
   ```powershell
   cd docs/demo-kit
   npm start
   ```
2. Open `http://127.0.0.1:3050` in a side window. Verify status reads **API Preflight Ready**.
3. (Optional) Refresh Razorpay Test IDs:
   ```powershell
   node scripts/generate-test-payments.mjs
   ```
4. Open the PayScope Dashboard (`http://localhost:5173` or deployed URL) in your primary recording window.

---

## 5-Minute Presentation Script

### 0:00 – 0:45 | Overview & Operating Model
- **Visual:** Scroll smoothly through the 4 Showcase Slides.
- **Script:**
  > "Payment failures are a significant source of lost revenue for online businesses. PayScope is an autonomous payment operations platform for Razorpay merchants. It ingests real-time Razorpay payment telemetry, runs structured multi-agent root-cause analysis, and executes policy-bounded recovery actions with verified callback reconciliation."
- **Action:** Click **Open Dashboard** on Slide 4.

---

### 0:45 – 1:45 | Scenario 1: Webhook Ingestion & Vulcan Telemetry
- **Visual:** Split screen (Demo Studio on left, PayScope Dashboard on right).
- **Action:** On the Demo Studio UI (`http://127.0.0.1:3050`), click **`[ > DISPATCH EVENT ]`** under **01: FAILED PAYMENT**.
- **Script:**
  > "When a payment fails, Razorpay dispatches an HMAC SHA-256 signed webhook. PayScope verifies the signature, ingests Razorpay Vulcan telemetry—including acquirer health scores and failure attributions—and forwards the event to our multi-agent pipeline.
  > On screen, you can see the incident created in real time with the Razorpay Vulcan signal badge, root-cause attribution, and initial policy recommendation."

---

### 1:45 – 2:30 | Scenario 2: Replay & Deduplication
- **Visual:** Demo Studio UI.
- **Action:** Click **`[ > REPLAY DUPLICATE ]`** under **02: DUPLICATE REPLAY**.
- **Script:**
  > "Webhook signals in production frequently arrive out of order or multiple times due to provider retries. PayScope uses idempotent correlation logic matching order ID, customer hash, and sliding time windows.
  > Notice that replaying the exact same event does not duplicate the incident or trigger redundant customer outreach. It attaches cleanly to the existing incident record."

---

### 2:30 – 3:15 | Scenario 3: Dispute Safety Gate
- **Visual:** Demo Studio UI.
- **Action:** Click **`[ > DISPATCH DISPUTE ]`** under **03: DISPUTE EVENT**.
- **Script:**
  > "Autonomous execution requires strict safety boundaries. If a customer opens a formal dispute with Razorpay, PayScope's policy engine immediately enforces a hard stop.
  > Because contacting a customer during an open dispute introduces compliance and chargeback risks, all automated outreach is blocked by policy."
- **Visual:** Point to `Dispute Open — Outreach Blocked` status on the dashboard.

---

### 3:15 – 4:00 | Scenario 4: Payment Link & Callback Reconciliation
- **Visual:** Demo Studio UI.
- **Action:** Click **`[ > DISPATCH RECON ]`** under **04: RECONCILIATION**.
- **Script:**
  > "Dispatching an email or payment link is only half the workflow. PayScope embeds a unique reference code (`ps_...`) inside the Razorpay Payment Link.
  > Recovery is only recorded as confirmed once a signed `payment_link.paid` callback arrives from Razorpay matching that exact reference ID.
  > The execution ledger now updates to Confirmed Payment Recovery."

---

### 4:00 – 5:00 | Scenario 5: Audit Trail & Natural Language Query
- **Visual:** Scroll down to the Audit Trail and Operational Insights panel.
- **Script:**
  > "Every decision, evidence evaluation, and provider action is written to an append-only audit trail with integrity verification.
  > Operations teams can also query the incident database in plain language."
- **Action:** Type `"show open high-risk incidents"` into the Operational Insights query box and click **Ask**.
- **Closing Script:**
  > "PayScope delivers autonomous payment operations with strict safety controls, full auditability, and verified Razorpay reconciliation."

---

## Delivery Checklist

- Keep voice clear and pace steady.
- Avoid calling initial notification dispatch "confirmed recovery" until the callback arrives.
- Ensure the live dashboard updates are highlighted visually as webhooks are triggered.
