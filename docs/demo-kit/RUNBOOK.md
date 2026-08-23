# Five-minute Recording Runbook & Operator Guide

## Story

> PayScope is not an unpaid-invoice emailer. It is an evidence-backed payment-operations agent that handles duplicate events, unsafe situations, uncertain provider outcomes, and delayed proof without duplicating commands or inventing recovery.

Use the deployed PayScope React Dashboard as your main screen. Open the **Demo Operator Studio UI (`http://127.0.0.1:3050`)** in a secondary window or side-by-side view to trigger signed webhooks live.

---

## Setup & Launch Procedure

1. Navigate to `docs/demo-kit` and launch the visual studio:
   ```powershell
   Set-Location docs/demo-kit
   npm start
   ```
2. Open `http://127.0.0.1:3050` in your browser.
3. Confirm the preflight header shows **`API Preflight Ready`**.
4. (Optional) Enter real Razorpay Test Payment IDs (`pay_...`) and click **Save Credentials & Test IDs**.
5. Open your deployed PayScope frontend dashboard in the primary browser window.

---

## 5-Minute Video Timeline & Visual Triggers

### 0:00 - 0:30 | Frame the Hard Problem
- **Screen:** PayScope Dashboard (Command Center & Incident Feed)
- **Narration:**
  > Routine notifications are easy. The hard cases are duplicate webhooks, fraud or disputes, withdrawn consent, ambiguous provider responses, and callbacks that arrive late. PayScope is built around those failure modes.
- **Action:** Point out the read-only ledger, evidence timeline, policy gates, provider receipt, and reconciliation state.

### 0:30 - 1:10 | Signed Duplicate Webhook & Correlation
- **Action:** On the Demo Studio UI (`http://127.0.0.1:3050`), click **"Trigger Failure Event"**, then click **"Re-send Duplicate Event"**.
- **Narration:**
  > The payload is HMAC-verified before it is trusted. Replaying the exact same provider event returns a 200 duplicate response without creating another incident or outreach action.
- **Evidence:** Show `duplicate: true` in the UI log and single incident grouping on the dashboard.

### 1:10 - 1:55 | Dispute Hard Stop
- **Action:** On the Demo Studio UI, click **"Trigger Dispute Event"**.
- **Narration:**
  > A technically possible email is still unsafe when an open dispute exists. The agent records the reason and refuses external outreach.
- **Evidence:** Highlight `DISPUTE_OPENED`, policy gate status `dispute: blocked`, and zero execution actions.

### 1:55 - 2:35 | Consent Withdrawn Pre-Dispatch
- **Action:** In your demo organization, suppress recipient consent and dispatch an eligible failure event via CLI:
  ```powershell
  node scripts/send-webhook.mjs --scenario eligible-failure --event-id demo-consent-001
  ```
- **Narration:**
  > Eligibility is checked at execution time, not just when the plan was created. A withdrawn recipient cannot produce an external side effect.
- **Evidence:** Point out policy check failure and zero Payment Link / email creation.

### 2:35 - 3:35 | Ambiguous Email Boundary
- **Action:** Pause execution worker after durable send marker.
- **Narration:**
  > The durable send marker is the ambiguity boundary. After it, retrying could duplicate customer contact, so PayScope reconciles instead of blindly resending.
- **Evidence:** Show action status `unreconciled` with reason `SMTP_RESULT_AMBIGUOUS_NO_RESEND`.

### 3:35 - 4:25 | Verified Razorpay Reconciliation
- **Action:** On the Demo Studio UI, click **"Trigger Reconciliation"** (linked to PayScope Payment Link reference `ps_...`).
- **Narration:**
  > SMTP acceptance is not recovery. Recovery is confirmed only by a verified Razorpay event linked to the original PayScope action.
- **Evidence:** Show causal chain: `PayScope action ID -> Payment Link reference -> receipt -> signed paid event -> confirmed outcome`.

### 4:25 - 5:00 | Close on Proof, Not Spectacle
- **Screen:** Execution Ledger & Audit Chain
- **Narration:**
  > PayScope's speciality is controlled autonomy: it acts when evidence and policy allow it, refuses unsafe actions, and preserves enough provider evidence to explain the result later.

---

## Fallbacks & Rules

- If a webhook is delayed, show the signed HTTP status in the Demo Studio console and state that the durable queue is processing.
- Do not call SMTP acceptance *"email delivery"*—use **"SMTP accepted"**.
- Do not claim *"payment recovered"* before the verified `payment_link.paid` callback.
- Keep credentials and webhook secrets redacted on camera.
