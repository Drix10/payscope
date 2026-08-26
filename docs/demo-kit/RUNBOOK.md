# PayScope — 5-Minute Video Recording & Operator Teleprompter Guide

This document is your exact step-by-step teleprompter and screen action guide for recording the 5-minute PayScope submission video for the Razorpay AI Hackathon.

---

## 🖥️ Screen Layout & Preflight Setup

### 1. Window Arrangement (Dual / Split-Screen)
- **Left Window (35% width):** Demo Operator Studio (`http://127.0.0.1:3050`)
- **Right Window (65% width):** PayScope Dashboard (`http://localhost:5173` or `https://temp.coslynx.com`)

### 2. Preflight Checklist (Do this BEFORE hitting record)
1. In `docs/demo-kit`, run `npm start` to launch the Operator Terminal UI.
2. Confirm the top status badge on Demo Studio reads **`API Preflight Ready`**.
3. (Optional) Run `node scripts/generate-test-payments.mjs` to auto-fill Razorpay Test IDs.
4. Refresh your PayScope Dashboard and ensure it displays the **Spatial Landing Showcase**.
5. Set screen resolution to **1920x1080** or **2560x1440** for crisp video rendering.

---

## 🛠️ Demo Script Kit Command Line Utilities

The demo kit includes 5 automated scripts in `docs/demo-kit/scripts/`:

| Script | Command | Purpose |
|---|---|---|
| **Preflight Check** | `node scripts/demo-preflight.mjs` | Asserts deployed API health, organization UUID match, and `test` mode safety. |
| **Self-Test** | `node scripts/self-test.mjs` | Verifies local HMAC-SHA256 signature generation and duplicate detection logic. |
| **Send Webhook** | `node scripts/send-webhook.mjs --scenario failed-payment --event-id "evt_1"` | Constructs, HMAC-signs, and dispatches test webhooks for any scenario. |
| **Automated Sequence** | `node scripts/run-demo.mjs --pause-ms 2000` | Runs failure, exact duplicate, correlated failure, and dispute scenarios; it adds reconciliation only when given a real action reference and captured payment. |
| **Verification Suite** | `node scripts/verify-demo.mjs` | Validates that incidents, execution outbox records, and audit entries exist in DB. |

---

## 🎬 Step-by-Step Recording Teleprompter Script

---

### ⏱️ 0:00 – 0:45 | Segment 1: Showcase & The ₹10,000 Cr Problem

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Full-Screen Right Window (PayScope Showcase Slides). |
| **Operator Action** | Scroll down smoothly using your mouse wheel from Slide 1 through Slide 4. Pause briefly on each slide card. |
| **Visual Target** | Highlight the glass card layout, Electric Mint accent lines, animated telemetry flows, and architecture badges. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "In India, over ₹10,000 Crore is lost every year to payment failures and checkout drop-offs. When a payment fails, traditional gateways log a static error code and stop. The transaction is dead, and the customer is lost.
> 
> If merchants try to blindly spam customers with generic reminders, they risk payment disputes, SMTP spam bans, and chargeback penalties.
> 
> PayScope solves this. It is an autonomous payment operations platform built natively for Razorpay merchants. It ingests real-time payment telemetry, runs structured multi-agent root-cause investigation with 3x retry resilience, and executes policy-bounded recovery actions with verified Razorpay callback reconciliation."

👉 **ON SLIDE 4:** Click the green **`[ Open Dashboard ]`** button.

---

### ⏱️ 0:45 – 1:45 | Segment 2: Hero KPI Cards & Webhook Telemetry Ingestion

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen (Demo Studio on Left, Dashboard on Right). |
| **Operator Action** | 1. Point out the **4 Hero KPI Cards** at the top (`Active Telemetry`, `Autonomous Outreach`, `Multi-Agent Engine`, `Safety Policy Lock`).<br />2. On Demo Studio (`http://127.0.0.1:3050`), click **`[ > DISPATCH EVENT ]`** under **01: FAILED PAYMENT**. |
| **Visual Target** | Hover cursor over the newly ingested incident. Highlight the **5-Stage Pipeline Progression Bar** (`1. Webhook Ingested` → `2. Razorpay Fields Enriched` → `3. Evidence Investigation` → `4. Deterministic Strategy + Policy` → `5. Outbox Queued`).  |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "Welcome to the PayScope Autonomous Command Center. At the top, you can see our real-time operational posture: Active Telemetry, Autonomous Outreach status, Multi-Agent Engine health, and Deterministic Safety Policy Locks.
> 
> Let's dispatch a live payment failure webhook from our operator terminal.
> 
> Instantly, PayScope verifies the HMAC signature and derives bounded enrichment from allowlisted Razorpay payment fields—such as error source, failure step, retry attempts, acquirer data, and downtime signals when available.
> 
> Look at the 5-stage pipeline progression: The event is ingested, enriched from Razorpay fields, investigated for evidence and risk, ranked by the deterministic Recovery Engine, cleared through 13 deterministic safety gates, and queued in the transactional execution outbox.
> 
> The evidence pipeline identified a likely customer drop-off during UPI authentication. The deterministic Recovery Engine selected the permitted strategy; only after policy clearance can the direct-execution worker create a 1-click Razorpay Payment Link."

---

### ⏱️ 1:45 – 2:30 | Segment 3: Webhook Replay & Idempotent Deduplication

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen. |
| **Operator Action** | On Demo Studio, click **`[ > REPLAY DUPLICATE ]`** under **02: DUPLICATE REPLAY**. |
| **Visual Target** | Point to the Demo Studio terminal showing `duplicate: true`, then highlight that the incident feed remains clean with **zero duplicate incidents or spam outreach**. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "In production, webhooks frequently arrive multiple times due to network retries. Basic scripts often spam customers multiple times for the same failed payment.
> 
> Watch what happens when I trigger a duplicate replay of the exact same event. 
> 
> PayScope's correlation engine matches the order ID, customer hash, and sliding time window. The duplicate is suppressed immediately at the intake boundary with `duplicate: true`.
> 
> No duplicate incident is created, no duplicate replan is started, and no duplicate email command is issued. The durable command key and callback/event deduplication make the action idempotent."

---

### ⏱️ 2:30 – 3:15 | Segment 4: Razorpay Dispute Hard Stop Safety Lock

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen. |
| **Operator Action** | On Demo Studio, click **`[ > DISPATCH DISPUTE ]`** under **03: DISPUTE EVENT**. |
| **Visual Target** | 1. Click on the **Disputes** tab in the incident feed.<br />2. Highlight the operational badge: **`Dispute Active — Automated Outreach Blocked by Safety Policy`**.<br />3. Point to the Policy Gate status **`dispute: blocked`**. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "Autonomous execution requires strict safety guardrails. If a customer opens a formal dispute or chargeback with their bank, contacting them creates severe compliance violations and chargeback penalties.
> 
> Let's dispatch a Razorpay dispute event.
> 
> Notice how PayScope immediately locks into 'Dispute Safety Mode'. Our deterministic policy engine intercepts the dispute and engages a Hard Stop across 13 safety gates.
> 
> All automated recovery actions are blocked instantly. Models supply bounded evidence; the deterministic policy is the final authorization boundary."

---

### ⏱️ 3:15 – 4:00 | Segment 5: Payment Link Dispatch & Signed Callback Reconciliation

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen. |
| **Operator Action** | 1. Confirm that the reference is from an actual PayScope-created Test-mode Payment Link and the payment ID is its captured payment.<br />2. On Demo Studio, click **`[ > DISPATCH RECON ]`** under **04: RECONCILIATION**.<br />3. Click on the **Resolved** tab in the PayScope Dashboard. |
| **Visual Target** | Scroll to the **Autonomous Execution Ledger** and highlight the status changing to **`Payment Recovered & Reconciled`** with Razorpay reference `ps_...`. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "Dispatching a recovery link is only half the battle—true revenue recovery requires closed-loop reconciliation. 
> 
> PayScope embeds a unique tracking reference starting with `ps_` into the Razorpay Payment Link.
> 
> When the customer completes the payment, Razorpay sends a signed `payment_link.paid` webhook. PayScope correlates the reference ID back to the original incident.
> 
> When the reference and payment match the durable action, the incident updates to RESOLVED and the recovered amount is recorded. We never claim money is recovered from SMTP acceptance or a synthetic event; it requires the verified Razorpay callback and causal correlation."

---

### ⏱️ 4:00 – 5:00 | Segment 6: Cryptographic Audit Trail & Operational Intelligence Query

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Full-Screen Right Window (Dashboard). |
| **Operator Action** | 1. Scroll down to the **Audit Trail** section and highlight the green **`Audit Chain Intact`** badge.<br />2. In the **Operational Insights** search box, type `"show open high-risk incidents"` and click **Ask**. |
| **Visual Target** | Highlight the unbroken cryptographic audit sequence and the instant structured query answer. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> "Every action taken by PayScope is 100% auditable. Every decision, evidence evaluation, and provider command is logged to an immutable cryptographic audit chain with real-time integrity verification.
> 
> Merchants can also query their entire payment operations dataset in natural language. I'll ask: 'show open high-risk incidents'—and PayScope instantly returns a structured, accurate operational breakdown.
> 
> That is PayScope: evidence-backed payment recovery with deterministic authorization, durable execution, and verified Razorpay reconciliation. Thank you!"

---

## 🎯 Pro Recording Guidelines

1. **Cursor Discipline:** Move the cursor deliberately to the UI cards you are speaking about. Avoid rapid or erratic mouse movement.
2. **Narration Flow:** Speak with confidence and clear pacing (~130 words per minute).
3. **Tab Demonstrations:** Click through `All active`, `Open`, `Monitoring`, `Disputes`, and `Resolved` to demonstrate that every single view is populated and responsive.
4. **Resolution:** Record in 1080p or 1440p 60fps for high visual clarity.
