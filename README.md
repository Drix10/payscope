# PayScope

<p align="center">
  <strong>An autonomous payment-operations agent for Razorpay merchants.</strong><br />
  From a signed payment signal to an evidence-backed, policy-bounded incident record.
</p>

<p align="center">
  <img alt="Razorpay AI Buildathon" src="https://img.shields.io/badge/Razorpay-AI%20Buildathon-0C1021?style=for-the-badge&logo=razorpay&logoColor=white" />
  <img alt="Razorpay Vulcan AI" src="https://img.shields.io/badge/Razorpay-Vulcan%20AI%20Foundation-00FF87?style=for-the-badge&logoColor=black" />
  <img alt="Mesh API AI" src="https://img.shields.io/badge/Mesh%20API-Structured%20Multi--Agent-7C3AED?style=for-the-badge" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-Vite-61DAFB?style=for-the-badge&logo=react&logoColor=111827" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-RLS%20%2B%20Audit-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
</p>

PayScope turns Razorpay webhook events into a complete, tenant-scoped resolution loop. Its multi-agent AI system investigates evidence under strict structured-output contracts (`json_schema: { strict: true }`); deterministic policy issues an idempotent provider command, verifies the provider receipt, reconciles callbacks, and records the final merchant outcome.

## Key Architectural Pillars

1. **⚡ Razorpay Vulcan AI Foundation Model Integration:**
   - PayScope directly ingests **Razorpay Vulcan** real-time payment intelligence (trained on 3T data points across 4B transactions with 29ms inference latency).
   - Ingests Vulcan's real-time acquirer health scores (`gatewayHealthScore`), network fraud detection, and failure attributions (`gateway_degraded`, `issuer_timeout`, `fraud_block`, `customer_drop`).
   - Tagged as `vulcan_direct` across the enrichment layer and dashboard UI.

2. **🕸️ Mesh API Structured Multi-Agent Stack:**
   - Powered by **Mesh API** (`https://api.meshapi.ai/v1/chat/completions`) using strict JSON Schema enforcement (`response_format: { type: 'json_schema', json_schema: { strict: true } }`).
   - **Supervisor Agent:** Directs evidence priorities, incident risk tiers (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`), and constraints.
   - **Risk Analyst Agent:** Evaluates causal attribution narratives, confidence rationale, alternative hypotheses, and evidence gaps.
   - **Recovery Planner Agent:** Formulates finite, idempotent action proposals (e.g. Razorpay Payment Links).

3. **🛡️ Non-LLM Deterministic Policy Safety Engine:**
   - Hard-coded non-LLM policy engine validates canonical payment state, amount caps, customer consent, dispute status, and contact limit ceilings **before** emitting provider commands.
   - Prevents unauthorized outreach, legal risks on open disputes, or spamming customers during active acquiring bank outages.

4. **🔄 Idempotent Execution & Callback Reconciliation:**
   - Generates unique tracking references (`ps_...`) embedded directly in Razorpay Payment Links.
   - Reconciles signed `payment_link.paid` webhooks to confirm payment recovery into an immutable append-only audit trail.

---

## Showcase

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>01 — Command center</strong><br />
      The landing surface explains the operating model before a merchant opens the product.<br /><br />
      <img src="docs/screenshots/01-command-center.png" alt="PayScope landing page" />
    </td>
    <td width="50%" valign="top">
      <strong>02 — Incident feed</strong><br />
      A readable timeline of payment incidents, lifecycle, risk level, and at-risk amount.<br /><br />
      <img src="docs/screenshots/02-incident-feed.png" alt="PayScope incident feed" />
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>03 — AI decision record</strong><br />
      Evidence, causal reasoning, alternatives, policy gates, prerequisites, and bounded outcome in one incident detail.<br /><br />
      <img src="docs/screenshots/03-ai-decision-record.png" alt="PayScope AI decision record" />
    </td>
    <td width="50%" valign="top">
      <strong>04 — Autonomous execution</strong><br />
      An incident becomes a real command, provider receipt, reconciled callback, and verified outcome by our AI Agent system.<br /><br />
      <img src="docs/screenshots/04-autonomous-execution.png" alt="PayScope autonomous execution engine" />
    </td>
  </tr>
</table>

---

## Buildathon Submission Summary

| Question | Answer |
|---|---|
| **Track selection** | AI agents for payment operations |
| **Project name / title** | **PayScope — Autonomous Payment Operations Agent** |
| **GitHub repository** | [github.com/Drix10/payscope](https://github.com/Drix10/payscope) |
| **Project objective** | Detect payment incidents from signed Razorpay events, enrich with Razorpay Vulcan AI signals, reason over evidence using Mesh API multi-agent stack, autonomously execute merchant-authorized recovery paths, and record verified reconciliation proof. |
| **What it solves** | Payment failure signals are noisy, scattered, and hard to resolve. PayScope correlates them into unified incidents, distinguishes bank infrastructure downtimes from customer drops, executes the appropriate recovery link, and makes the reasoning and provider results 100% explainable. |

---

## Technical Architecture

```text
Razorpay Webhook (HMAC SHA-256 Signed)
   │
   ▼
Razorpay Vulcan AI Foundation Model (29ms Network Intelligence & Attribution)
   │
   ▼
PayScope Durable Queue & Correlation Engine (Order ID, Customer ID, 15-min Window)
   │
   ▼
Mesh API Multi-Agent Investigation Stack (Supervisor → Risk Analyst → Recovery Planner)
   │
   ▼
Non-LLM Deterministic Policy Safety Engine (Consent, Dispute Blocks, Contact Limits)
   │
   ▼
Provider Command Dispatch & Receipt Reconciliation (Razorpay Payment Link + SMTP)
   │
   ▼
Read-Only React Command Dashboard (`⚡ Razorpay Vulcan AI Direct` Badge + Audit Trail)
```

---

## Agent Hierarchy & Authority

| Layer | Produces | Authority Boundary |
|---|---|---|
| **Supervisor Agent** | Incident objectives, evidence priorities, risk tiering, constraints | Directs analysis only; cannot execute commands |
| **Risk Analyst Agent** | Causal narrative, confidence rationale, alternative hypotheses, evidence gaps | Reads tenant-scoped facts only; no side effects |
| **Recovery Planner Agent** | Action proposals, prerequisites, expected receipts, email copy intent | Selects from configured capabilities only |
| **Deterministic Policy Engine** | Hard permit / restrict / block result and command parameters | Non-LLM authority gatekeeper before execution |
| **Provider Adapters** | Idempotent Razorpay Payment Link + SMTP command & receipt state | Executes configured Razorpay and SMTP operations |

---

## Run Locally & Demo Operator Studio

### Prerequisites
- Node.js 20 or newer
- npm
- Supabase Project (SQL migrations provided in `backend/supabase/migrations`)

### Backend Setup
```bash
cd backend
copy .env.example .env
npm install
npm run build
npm run start
```

### Frontend Setup
```bash
cd frontend
copy .env.example .env
npm install
npm run build
npm run dev
```

### Demo Operator Studio (5-Minute Standalone Kit)
To run the visual cyber terminal operator kit for video recording:
```bash
cd docs/demo-kit
npm start
```
- Open `http://127.0.0.1:3050` to trigger signed Razorpay webhooks live.
- Helper script to generate real Razorpay Test payment IDs:
  ```bash
  node docs/demo-kit/scripts/generate-test-payments.mjs
  ```

---

## Verification

```bash
# Backend unit & ETE agent suite (16/16 tests)
cd backend && npm run test

# Frontend production build
cd frontend && npm run build

# Demo kit HMAC self-test
node docs/demo-kit/scripts/self-test.mjs
```

---

Designed for the **Razorpay AI Buildathon** — making payment operations autonomous, verifiable, and 100% explainable.
