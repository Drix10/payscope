# PayScope — 5-Minute Video Recording & Operator Teleprompter Guide

This document is your exact step-by-step teleprompter and screen action guide for recording the 5-minute PayScope submission video.

---

## 🖥️ Screen Layout & Preflight Setup

### 1. Window Arrangement (Dual / Split-Screen)
- **Left Window (35% width):** Demo Operator Studio (`http://127.0.0.1:3050`)
- **Right Window (65% width):** PayScope Dashboard (`http://localhost:5173` or `https://temp.coslynx.com`)

### 2. Preflight Checklist (Do this BEFORE hitting record)
1. In `docs/demo-kit`, run `npm start`.
2. Confirm the top status badge on Demo Studio reads **`API Preflight Ready`**.
3. (Optional) Run `node scripts/generate-test-payments.mjs` to auto-fill Razorpay Test IDs.
4. Refresh your PayScope Dashboard and ensure it shows the 4 Showcase Slides.
5. Set screen resolution to **1920x1080** or **2560x1440** for clear video quality.

---

## 🎬 Step-by-Step Recording Teleprompter Script

---

### ⏱️ 0:00 – 0:45 | Segment 1: Showcase & System Overview

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Full-Screen Right Window (PayScope Showcase Slides). |
| **Operator Action** | Scroll down smoothly using your mouse wheel from Slide 1 through Slide 4. Pause briefly on each slide card. |
| **Visual Target** | Highlight the glass card layout, Electric Mint accent lines, and architecture badges. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "Payment failures are a massive hidden revenue leak for online merchants. When a payment fails or drops, support teams waste hours manually piecing together logs, while retrying randomly or sending unsafe customer emails.
> 
> PayScope is an autonomous payment operations platform built for Razorpay merchants. It ingests real-time payment telemetry, runs structured multi-agent root-cause analysis, and executes policy-bounded recovery actions with verified Razorpay callback reconciliation."

👉 **ON SLIDE 4:** Click the green **`[ Open Dashboard ]`** button.

---

### ⏱️ 0:45 – 1:45 | Segment 2: Webhook Ingestion & Razorpay Vulcan Telemetry

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen (Demo Studio on Left, Dashboard on Right). |
| **Operator Action** | On Demo Studio (`http://127.0.0.1:3050`), click **`[ > DISPATCH EVENT ]`** under **01: FAILED PAYMENT**. |
| **Visual Target** | Hover cursor over the newly created incident in the feed, pointing to the **`⚡ Razorpay Vulcan AI Direct`** signal badge and the AI Root-Cause narrative. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "Let me demonstrate how PayScope handles a live payment failure. On our operator harness, I'll dispatch a signed Razorpay payment failure webhook.
> 
> Instantly, PayScope verifies the HMAC signature and ingests Razorpay Vulcan telemetry—including acquirer health scores and failure attributions. 
> 
> On screen, our multi-agent pipeline has correlated the signal, identified the root cause, and generated a policy-bounded recovery plan. Notice the Vulcan AI direct signal tag embedded right in the verified event timeline."

---

### ⏱️ 1:45 – 2:30 | Segment 3: Webhook Replay & Idempotent Deduplication

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen. |
| **Operator Action** | On Demo Studio, click **`[ > REPLAY DUPLICATE ]`** under **02: DUPLICATE REPLAY**. |
| **Visual Target** | Point to the Demo Studio terminal showing `duplicate: true`, then highlight that the incident count on the Dashboard remains at **1 single incident**. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "In production, webhooks frequently arrive multiple times or out of order due to network retries. Blindly processing retries leads to duplicate customer emails and race conditions.
> 
> Now I'll trigger a duplicate replay of the exact same event. PayScope's correlation engine matches the order ID, customer hash, and sliding time window. 
> 
> As you can see, the duplicate is suppressed cleanly. The incident count remains unchanged, preventing spam or double outreach."

---

### 2:30 – 3:15 | Segment 4: Razorpay Dispute Safety Hard Stop

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen. |
| **Operator Action** | On Demo Studio, click **`[ > DISPATCH DISPUTE ]`** under **03: DISPUTE EVENT**. |
| **Visual Target** | Point to the AI Outcome box showing **`Dispute Open — Outreach Blocked`** and highlight the Policy Gate status **`dispute: blocked`**. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "Autonomous execution requires strict safety controls. If a customer opens a formal dispute with Razorpay, contacting them creates significant compliance and chargeback risk.
> 
> Let's dispatch a dispute event. PayScope's deterministic policy engine intercepts the dispute immediately and enforces a hard stop. 
> 
> Look at the AI outcome: Outreach is blocked by policy. The system overrides all automated recovery actions, keeping the merchant 100% compliant."

---

### ⏱️ 3:15 – 4:00 | Segment 5: Payment Link Dispatch & Signed Callback Reconciliation

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen. |
| **Operator Action** | On Demo Studio, click **`[ > DISPATCH RECON ]`** under **04: RECONCILIATION**. |
| **Visual Target** | Scroll down to the **Execution Ledger** and highlight the status changing to **`Confirmed Payment Recovery`** with provider reference `ps_...`. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "Sending a payment link is only half the job—reconciliation is what confirms real revenue. PayScope embeds a unique tracking reference starting with `ps_` into the Razorpay Payment Link.
> 
> I'll now simulate Razorpay sending a signed `payment_link.paid` callback. PayScope matches the reference ID to our execution ledger.
> 
> The status immediately updates to Confirmed Payment Recovery. We never mark money recovered until Razorpay explicitly confirms receipt."

---

### ⏱️ 4:00 – 5:00 | Segment 6: Audit Integrity & Operational Insights

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Full-Screen Right Window (Dashboard). |
| **Operator Action** | 1. Scroll down to the **Audit Trail** section.<br />2. Click on the **Operational Insights** text box, type `"show open high-risk incidents"`, and click **Ask**. |
| **Visual Target** | Highlight the **`Audit chain intact`** badge and the instant natural language query answer. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "Finally, accountability is built into the architecture. Every decision, evidence evaluation, and provider command is stored in an append-only, cryptographic audit trail with real-time integrity verification.
> 
> Operations teams can also query their payment records using plain English. I'll type 'show open high-risk incidents'—and PayScope returns instant, structured operational answers.
> 
> That is PayScope: autonomous payment operations with zero guesswork, 100% audit safety, and verified Razorpay reconciliation. Thank you!"

---

## 🎯 Pro Tips for a Clean Recording

1. **Mouse Movements:** Keep cursor movements smooth and intentional. Don't shake or move the mouse erratically.
2. **Pacing:** Speak at a comfortable, natural pace (~130 words per minute).
3. **Audio Quality:** Use a clean microphone in a quiet room. Avoid background noise.
4. **Resolution:** Ensure text on screen is readable when uploaded to YouTube/Loom.
