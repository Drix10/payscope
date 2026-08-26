# PayScope — 5-Minute Video Recording & Operator Teleprompter Guide

This document is your exact step-by-step teleprompter, acting direction, and screen action guide for recording the 5-minute PayScope submission video for the Razorpay AI Hackathon.

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

## 🎬 Step-by-Step Recording Teleprompter & Performance Guide

---

### ⏱️ 0:00 – 0:45 | Segment 1: The Problem

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Full-Screen Right Window (PayScope Showcase Slides / Spatial Landing Canvas). |
| **Operator Action** | 1. `[screen fades in]` Start on Slide 1.<br />2. `[pause]` Pause briefly.<br />3. `[shrugs]` Scroll smoothly to Slide 2.<br />4. `[shakes head]` Point at gateway error codes.<br />5. `[screen transitions]` Click `[ Open Dashboard ]` or scroll to architecture canvas.<br />6. `[leans in]` Point cursor at deterministic safety policy badge.<br />7. `[pause]` Pause for final boundary line. |
| **Delivery Cues** | The `[...]` brackets below are acting and delivery directions (`[pause]`, `[shrugs]`, `[shakes head]`, `[leans in]`). Speak naturally and comfortably. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> [screen fades in]
>
> "Okay... so here's the problem.
>
> [pause]
>
> In India, over ten thousand crore rupees is lost every year to payment failures and checkout drop-offs. And when a payment fails, most systems basically go... [shrugs] 'payment failed.'
>
> That's it.
>
> [pause]
>
> The transaction is dead, and the customer is gone.
>
> But if you start blindly hammering customers with generic payment reminders... [shakes head] you're creating another problem — spam, disputes, chargebacks, compliance risk.
>
> So we built PayScope.
>
> [screen transitions]
>
> It's an autonomous payment-operations system for Razorpay merchants. It takes the actual payment telemetry, investigates *why* the payment failed, decides what — if anything — is safe to do, and then executes that recovery through a durable, policy-controlled pipeline.
>
> And importantly... [leans in] it doesn't let the AI decide what it's allowed to do.
>
> The AI investigates.
> The deterministic policy decides.
> [pause]
> And the execution layer proves what actually happened."

---

### ⏱️ 0:45 – 1:45 | Segment 2: Live Failure

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen (Demo Studio on Left `http://127.0.0.1:3050`, Dashboard on Right `http://localhost:5173`). |
| **Operator Action** | 1. `[dashboard appears]` Present split-screen operational view.<br />2. `[moves cursor to Demo Studio]` Hover over **01: FAILED PAYMENT**.<br />3. `[clicks DISPATCH EVENT]` Click `[ > DISPATCH EVENT ]`.<br />4. `[brief pause]` Wait for event ingestion and field extraction.<br />5. `[points at pipeline]` Move cursor across the **5-Stage Pipeline Progression Bar** (`Ingested` → `Enriched` → `Investigation` → `Strategy + Policy` → `Outbox`).<br />6. `[points at incident]` Hover cursor over the incident card.<br />7. `[points at payment link]` Point to the 1-click Razorpay Payment Link action. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> [dashboard appears]
>
> "So let's actually break something.
>
> [moves cursor to Demo Studio]
>
> I'm going to send a payment failure webhook."
>
> [clicks DISPATCH EVENT]
>
> "And... there it is.
>
> [brief pause]
>
> The event comes in, the signature is verified, and we extract only the Razorpay fields we're actually allowed to use.
>
> [points at pipeline]
>
> Now watch this pipeline.
>
> Webhook ingestion...
> [pause]
> enrichment...
> investigation...
> deterministic strategy and policy...
> and finally, the execution outbox.
>
> [points at incident]
>
> The investigation identifies the likely failure as a customer drop-off during UPI authentication.
>
> Now here's the important part.
>
> [pause]
>
> The model can say, 'hey, this looks like a customer problem.'
>
> But it cannot just say, 'send an email.'
>
> The Recovery Engine ranks the available action, the deterministic policy checks whether that action is permitted, and *only then* can the worker execute it.
>
> [points at payment link]
>
> In this case, the permitted action is a one-click Razorpay Payment Link."

---

### ⏱️ 1:45 – 2:30 | Segment 3: Duplicate Webhook

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen. |
| **Operator Action** | 1. `[moves to duplicate scenario]` Focus on **02: DUPLICATE REPLAY** in Demo Studio.<br />2. `[clicks REPLAY DUPLICATE]` Click `[ > REPLAY DUPLICATE ]`.<br />3. `[pause]` Point to output log.<br />4. `[points]` Point cursor at incoming payload.<br />5. `[points at duplicate: true]` Point to terminal output showing `duplicate: true` and clean incident feed.<br />6. `[nods]` Nods to reinforce exactly-once effect. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> [moves to duplicate scenario]
>
> "Now here's something that happens all the time in production.
>
> [clicks REPLAY DUPLICATE]
>
> The exact same webhook arrives again.
>
> [pause]
>
> And this is where a lot of automation systems get ugly.
>
> Same event...
> same customer...
> [points]
> potentially another email.
>
> Not here.
>
> [points at `duplicate: true`]
>
> PayScope recognizes the duplicate at the intake boundary.
>
> [pause]
>
> No second incident.
> No second recovery plan.
> No second command.
>
> The event and command identities are durable, so even if the infrastructure retries the work, we're not accidentally sending the same recovery action twice.
>
> [nods]
>
> Exactly-once *effect*, even when the world underneath us is very much not exactly-once."

---

### ⏱️ 2:30 – 3:15 | Segment 4: Dispute Hard Stop

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen. |
| **Operator Action** | 1. `[moves to dispute scenario]` Focus on **03: DISPUTE EVENT** in Demo Studio.<br />2. `[clicks DISPATCH DISPUTE]` Click `[ > DISPATCH DISPUTE ]`.<br />3. `[pause]` Switch to **Disputes** tab on dashboard.<br />4. `[points at Dispute Safety Mode]` Point at **`Dispute Active — Automated Outreach Blocked by Safety Policy`** banner.<br />5. `[points at blocked status]` Hover over blocked policy gate badge (`dispute: blocked`).<br />6. `[nods]` Nods for final authorization boundary line. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> [moves to dispute scenario]
>
> "Now let's try something much more dangerous.
>
> [clicks DISPATCH DISPUTE]
>
> A customer has opened a dispute.
>
> [pause]
>
> And this is where I *don't* want an autonomous system being clever.
>
> [points at Dispute Safety Mode]
>
> PayScope sees the dispute and immediately enters safety mode.
>
> [pause]
>
> Recovery actions are blocked.
>
> The policy gate says: no.
>
> [points at blocked status]
>
> And that's intentional.
>
> The AI doesn't get to override this because it thinks recovery would probably make money.
>
> [pause]
>
> Evidence can inform the decision.
> Models can investigate.
>
> But authorization belongs to deterministic policy.
>
> [nods]
>
> That's the boundary."

---

### ⏱️ 3:15 – 4:00 | Segment 5: Real Razorpay Recovery + Callback

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Split-Screen. |
| **Operator Action** | 1. `[moves to reconciliation]` Focus on **04: RECONCILIATION** in Demo Studio.<br />2. `[clicks DISPATCH RECON]` Click `[ > DISPATCH RECON ]`.<br />3. `[pause]` Highlight tracking reference `ps_...`.<br />4. `[points at ps_...]` Point to `ps_...` reference on action record.<br />5. `[pause]` Observe signed `payment_link.paid` webhook processing.<br />6. `[clicks Resolved]` Click **Resolved** tab on Dashboard.<br />7. `[points at resolved record]` Point at the resolved record with verified amount. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> [moves to reconciliation]
>
> "Okay. So let's show the other side — an actual recovery.
>
> [clicks DISPATCH RECON]
>
> This isn't a fake success state.
>
> [pause]
>
> PayScope created the Razorpay Payment Link in test mode, and we've got the real reference attached to the action.
>
> [points at `ps_...`]
>
> That tracking reference lets us connect the payment back to the exact incident and execution action that caused it.
>
> Then Razorpay sends the signed `payment_link.paid` callback.
>
> [pause]
>
> We verify it.
> We correlate it.
> We reconcile it against the durable action.
>
> And only *then*..."
>
> [clicks Resolved]
>
> "...do we say the money was recovered.
>
> [pause]
>
> Not because an email was accepted.
> Not because some internal timer fired.
> Not because the AI said it worked.
>
> [points at resolved record]
>
> Because Razorpay gave us verified payment evidence that matches the action."

---

### ⏱️ 4:00 – 4:40 | Segment 6: The Differentiator: Learning

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Full-Screen Right Window (Dashboard) — Recovery Intelligence Panel. |
| **Operator Action** | 1. `[switches to Recovery Intelligence]` Scroll down to Recovery Intelligence / Strategy Performance.<br />2. `[points at Strategy Performance]` Point to Strategy Performance matrix (merchant × failure × segment).<br />3. `[points at interval]` Point to Wilson score interval (e.g., 34% [28%–41%]).<br />4. `[pause]` Pause on empirical posterior explanation.<br />5. `[slight pause]` Hover over recovery estimate.<br />6. `[points at ledger]` Point cursor at `payscope_recovery_outcomes` ledger entry.<br />7. `[nods]` Nods for final learning loop statement. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> [switches to Recovery Intelligence]
>
> "And this... [pause] is the part I'm most excited about.
>
> PayScope doesn't just automate the same recovery decision forever.
>
> [points at Strategy Performance]
>
> It learns from what actually happened.
>
> For this merchant, this failure category, and this customer segment, we've got forty-seven previous attempts.
>
> Thirty-four percent recovered.
>
> [points at interval]
>
> And the system shows the uncertainty around that estimate instead of pretending thirty-four percent is some magical truth.
>
> [pause]
>
> That historical outcome feeds the deterministic recovery ranking.
>
> So we're not asking the LLM, 'what should we try?'
>
> We're asking:
> [slight pause]
> 'Given what we've actually observed for this merchant... what action has the best evidence behind it?'
>
> And every intervention becomes another observation.
>
> [points at ledger]
>
> Send.
> Outcome.
> Paid or expired.
>
> That closes the learning loop.
>
> And next time, the decision can actually be different because the evidence is different.
>
> [nods]
>
> The model investigates.
> The statistics learn.
> The policy still decides."

---

### ⏱️ 4:40 – 5:00 | Segment 7: Audit + Killer Ending

| Field | Detail / Instruction |
|---|---|
| **Screen State** | Full-Screen Right Window (Dashboard). |
| **Operator Action** | 1. `[scrolls to Audit Trail]` Scroll down to Cryptographic Audit Trail.<br />2. `[pause]` Hover over green **`Audit Chain Intact`** badge.<br />3. `[points at Audit Chain Intact]` Point to SHA-256 hash sequence.<br />4. `[moves to Operational Insights]` Move to natural language query box.<br />5. `[types]` Type `"show open high-risk incidents"`.<br />6. `[clicks Ask]` Click **Ask** button.<br />7. `[pause for result]` Wait for structured query result.<br />8. `[looks at camera]` Look directly at camera for final pitch.<br />9. `[small pause]` Brief pause before closing line.<br />10. `[smiles]` Smile and end recording. |

🗣️ **SPOKEN TELEPROMPTER SCRIPT:**
> [scrolls to Audit Trail]
>
> "And finally... [pause] none of this should be a black box.
>
> Every decision, execution receipt, and callback is part of the audit trail.
>
> [points at Audit Chain Intact]
>
> The chain is serialized and durable, so if an audit write fails, we don't just shrug and move on. The job can retry.
>
> [moves to Operational Insights]
>
> And because this is an operations system, I can just ask it what I need.
>
> [types]
>
> 'show open high-risk incidents.'
>
> [clicks Ask]
>
> [pause for result]
>
> And there it is.
>
> So that's PayScope.
>
> [looks at camera]
>
> It doesn't just detect failed payments.
>
> It investigates them.
> It acts within hard safety boundaries.
> It proves whether the action worked.
> And it learns from the outcome.
>
> [small pause]
>
> Evidence-backed.
> Policy-bounded.
> Merchant-learning revenue recovery.
>
> [smiles]
>
> That's PayScope."

---

## 🎯 Pro Delivery & Acting Guidelines

1. **`[...]` Cues Are Delivery Directives:** Use bracket cues strictly as physical actions and timing indicators (`[pause]`, `[clicks]`, `[points]`). Do not speak them out loud.
2. **Timing & Pauses:** Respect `[pause]` (0.5s – 1s) and `[brief pause]` to let UI animations, progress bars, and terminal responses render cleanly on camera.
3. **Cursor Precision:** Move the cursor smoothly to point at specific elements (`[points at pipeline]`, `[points at duplicate: true]`, `[points at Dispute Safety Mode]`).
4. **Natural Delivery:** Speak as a founder demonstrating a platform they genuinely built and believe in, maintaining conversational flow (~130 WPM).
5. **Tab Demonstrations:** Click through `All active`, `Open`, `Monitoring`, `Disputes`, and `Resolved` to demonstrate that every single view is populated and responsive.
6. **Resolution:** Record in 1080p or 1440p 60fps for high visual clarity.
