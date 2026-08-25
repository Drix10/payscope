# Five-minute Video Recording Script & Operator Guide

## Narrative Core

> **PayScope** is an autonomous payment-operations agent built for Razorpay merchants. It ingests **Razorpay Vulcan AI** foundation signals, uses **Mesh API structured multi-agent reasoning** to evaluate evidence, enforces non-LLM deterministic policy gates, and reconciles Razorpay Payment Links into verified merchant outcomes.

Use your PayScope React Dashboard as the main screen. Open the **Demo Operator Studio UI (`http://127.0.0.1:3050`)** in a side-by-side browser window to trigger signed webhooks live during your 5-minute recording.

---

## Setup & Preflight Procedure

1. **Launch the Demo Operator Studio:**
   ```powershell
   Set-Location docs/demo-kit
   npm start
   ```
2. Open `http://127.0.0.1:3050` in your secondary window.
3. Confirm the top status badge reads **`API Preflight Ready`**.
4. (Optional) Generate or refresh your Razorpay Test IDs:
   ```powershell
   node scripts/generate-test-payments.mjs
   ```
5. Open your PayScope frontend dashboard (`https://temp.coslynx.com` or local dev) in your primary recording window.

---

## 5-Minute Video Recording Script & Narration Guide

### ⏱️ 0:00 - 0:45 | Frame the Problem & Showcase Slides
- **Screen:** Scroll smoothly through the 4 Showcase Slides.
- **Narration:**
  > *"Payment failures are a massive hidden revenue leak for online merchants. PayScope is an autonomous payment operations agent designed for Razorpay. It pairs Razorpay Vulcan's 29ms payment foundation model with Mesh API structured multi-agent reasoning to turn noisy error signals into verified, policy-bounded recoveries."*
- **Action:** Click the green **"Open Dashboard"** button on Slide 4.

---

### ⏱️ 0:45 - 1:40 | Segment 1: Webhook Ingestion & Razorpay Vulcan Intelligence
- **Screen:** Side-by-side view (Studio UI on left, PayScope Dashboard on right).
- **Action:** On the Demo Studio UI (`http://127.0.0.1:3050`), click **`[ > DISPATCH EVENT ]`** under **01: FAILED PAYMENT**.
- **Narration:**
  > *"When a customer payment fails, Razorpay sends an HMAC SHA-256 signed webhook. PayScope verifies the signature, extracts Razorpay Vulcan AI foundation signals—such as failure attribution and gateway health scores—and passes them to our multi-agent stack."*
- **Highlight on Screen:** Point out the live update on the dashboard:
  - **Enrichment Badge:** `⚡ Razorpay Vulcan AI Direct`.
  - **Multi-Agent Decision:** Supervisor goal, Risk Analyst causal narrative, and Recovery Planner proposal.

---

### ⏱️ 1:40 - 2:25 | Segment 2: Duplicate Replay Suppression
- **Action:** On the Demo Studio UI, click **`[ > REPLAY DUPLICATE ]`** under **02: DUPLICATE REPLAY**.
- **Narration:**
  > *"Payment webhooks often arrive multiple times or out of order. PayScope uses durable queue leases and HMAC signature deduplication to aggregate retries onto the exact same incident record—preventing spam or double outreach."*
- **Evidence:** Show `duplicate: true` in the UI log and point out that the Incident Feed retains **1 single incident** with audit entry `duplicate_suppressed`.

---

### 2:25 - 3:15 | Segment 3: Dispute Safety & Policy Gate Hard Stop
- **Action:** On the Demo Studio UI, click **`[ > DISPATCH DISPUTE ]`** under **03: DISPUTE EVENT**.
- **Narration:**
  > *"Safety is paramount. If a customer opens a formal Razorpay dispute, PayScope's deterministic policy engine enforces a hard stop. Outreach is immediately blocked because contacting a customer with an active dispute creates legal and compliance risk."*
- **Evidence:** Highlight `DISPUTE_OPENED`, policy gate status `dispute: blocked`, and zero outreach commands.

---

### ⏱️ 3:15 - 4:15 | Segment 4: Razorpay Payment Link Dispatch & Reconciliation
- **Action:** On the Demo Studio UI, click **`[ > DISPATCH RECON ]`** under **04: RECONCILIATION**.
- **Narration:**
  > *"SMTP acceptance is not payment recovery. PayScope tracks the unique tracking reference (`ps_...`) embedded in the Razorpay Payment Link. Recovery is confirmed ONLY when Razorpay returns a signed `payment_link.paid` webhook matching the original action."*
- **Evidence:** Point to the **Execution Ledger** showing action state `confirmed` and verified outcome `"Confirmed recovery"`.

---

### ⏱️ 4:15 - 5:00 | Segment 5: Audit Integrity & Operational Insights
- **Screen:** Scroll down to **Audit Trail & Read-Only Operational Insights**.
- **Narration:**
  > *"PayScope operates under controlled autonomy: every decision, evidence item, and provider command is logged in an append-only, cryptographic audit chain. Merchants can also query operational insights in natural language."*
- **Action:** Type `"show open high-risk incidents"` in Operational Insights box and click **Ask**.
- **Closing:**
  > *"That is PayScope: autonomous payment operations with zero guesswork, 100% audit safety, and verified Razorpay recovery."*

---

## Technical & Narration Rules

- **Do not call SMTP acceptance "email delivery":** Always say *"SMTP accepted"*.
- **Do not claim "payment recovered" before callback:** Say *"Payment Link dispatched"*, then *"Recovery confirmed upon signed callback"*.
- **Highlight Vulcan AI:** Mention Razorpay Vulcan when pointing to the `⚡ Razorpay Vulcan AI Direct` badge on the timeline.
- **Highlight Mesh API:** Mention Mesh API structured JSON outputs when showing the AI Decision Record.
- **Redaction:** Keep private keys and secret tokens hidden on camera.
