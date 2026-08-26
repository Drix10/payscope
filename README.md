# PayScope

<p align="center">
  <strong>An autonomous payment-operations platform for Razorpay merchants.</strong><br />
  From a signed payment signal to an evidence-backed, policy-bounded incident record.
</p>

<p align="center">
  <img alt="Razorpay AI Buildathon" src="https://img.shields.io/badge/Razorpay-AI%20Buildathon-0C1021?style=for-the-badge&logo=razorpay&logoColor=white" />
  <img alt="Mesh API AI" src="https://img.shields.io/badge/Mesh%20API-Structured%20Multi--Agent-7C3AED?style=for-the-badge" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-Vite-61DAFB?style=for-the-badge&logo=react&logoColor=111827" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-RLS%20%2B%20Audit-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
</p>

PayScope turns raw Razorpay webhook events into a tenant-scoped, evidence-backed recovery loop. It correlates payment-failure signals into incident timelines, enriches allowlisted Razorpay payment fields and downtime signals, runs a structured Mesh investigation, ranks a deterministic recovery strategy, enforces 13 policy gates, and—when direct execution is enabled and healthy—dispatches a Razorpay Payment Link through SMTP.

---

## Key Pillars

1. **Razorpay Telemetry Ingestion:** Uses allowlisted Razorpay fields (`error_source`, `error_step`, `error_reason`, attempts, and acquirer data) plus bounded downtime signals. The enrichment is explicitly heuristic, never an invented provider signal.
2. **Structured Investigation + Deterministic Strategy:** Supervisor, Risk Analyst, and Recovery Planner use bounded JSON with 3 attempts. The model supplies evidence and copy intent; the deterministic Recovery Engine selects the executable strategy.
3. **Deterministic Policy Safety Engine:** 13 gates validate merchant consent, dispute locks, amount caps, quiet hours, contact frequency limits, provider health, and idempotency before any provider command is dispatched.
4. **Idempotent Execution & Callback Reconciliation:** Creates traceable recovery actions with unique references (`ps_...`), reconciles ambiguous provider results before retry, marks expired recovery links terminal before adaptive replanning, and confirms financial recovery only from a causally matched, signed callback. When no untried provider-backed capability remains, the engine stops with a durably audited decision instead of inventing actions.
5. **Real SHA-256 Cryptographic Audit Chain:** Serves real-time merchant revenue analytics (`/api/mvp/revenue-intelligence`) and computes SHA-256 entry hashes across the audit ledger.

---

## Showcase

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>01 — Spatial Showcase Canvas</strong><br />
      An interactive spatial scrolling overview presenting system architecture, signal telemetry, and policy controls.<br /><br />
      <img src="docs/screenshots/01-command-center.png" alt="PayScope landing showcase" />
    </td>
    <td width="50%" valign="top">
      <strong>02 — Real-Time Incident Feed</strong><br />
      Unified incident records sorted by risk tier, current status, and total monetary value at risk.<br /><br />
      <img src="docs/screenshots/02-incident-feed.png" alt="PayScope incident feed" />
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>03 — Evidence and Strategy Record</strong><br />
      The current product records model evidence separately from the deterministic strategy and policy decision. The legacy simulated-action screenshot has been intentionally removed pending a current capture.
    </td>
    <td width="50%" valign="top">
      <strong>04 — Autonomous Execution Ledger</strong><br />
      Provider commands, delivery receipts, and verified callback reconciliation tracked in an immutable audit trail.<br /><br />
      <img src="docs/screenshots/04-autonomous-execution.png" alt="PayScope execution ledger" />
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
| **Project objective** | Ingest signed Razorpay events, enrich with Razorpay telemetry, analyze evidence using a structured multi-agent pipeline, execute authorized recovery actions, and verify outcomes via signed callbacks. |
| **What it solves** | Payment failures are noisy and hard to resolve manually. PayScope correlates webhooks into unified incidents, distinguishes bounded heuristic causes, executes only policy-permitted actions, and retains an auditable decision/receipt/callback chain. |

---

## System Architecture

```text
Razorpay Webhook (HMAC SHA-256 Signed)
   │
   ▼
Allowlisted Razorpay Field Enrichment (Heuristic Attribution)
   │
   ▼
Correlation & Deduplication Engine (Order ID, Customer Hash, Time Window)
   │
   ▼
Structured Investigation (Supervisor → Risk Analyst → Recovery Planner)
   │
   ▼
Deterministic Recovery Engine (strategy score and heuristic estimate, not calibrated probability)
   │
   ▼
Deterministic Policy Engine (13 Safety Gates, Dispute Locks, Contact Ceilings)
   │
   ▼
Transactional Outbox & Execution Worker (Razorpay Payment Links & Nodemailer SMTP)
   │
   ▼
Callback Reconciliation & Append-Only Cryptographic Audit Trail
```

---

## System Components & Authority Boundaries

| Component | Function | Authority Boundary |
|---|---|---|
| **Supervisor Agent** | Synthesizes incident context, sets investigation objectives, and establishes risk constraints. | Analytical only; cannot execute commands or alter policies. |
| **Risk Analyst Agent** | Analyzes payment failure telemetry, merchant metrics, and causal factors. | Analytical only; reads tenant data without side effects. |
| **Recovery Planner Agent** | Supplies bounded recovery context and permitted email copy intent. | Cannot select the final action or execute commands. |
| **Recovery Engine** | Ranks untried recovery strategies from durable incident evidence and customer context. | Deterministic selector; no strategy means no action. |
| **Deterministic Policy Engine** | Evaluates 13 hard business rules, dispute blocks, and outreach ceilings. | Gatekeeper; holds final execution authority. |
| **Execution Workers** | Dispatches authorized provider commands from outbox and tracks receipts. | Executes approved actions idempotently. |

---

## Local Setup & Demo Studio

### Prerequisites
- Node.js 20+
- npm
- PostgreSQL / Supabase instance (SQL migrations located in `backend/supabase/migrations`)

Required environment (see `backend/.env.example`): `PAYSCOPE_CALLBACK_ENCRYPTION_KEY` (base64 32-byte key — webhooks are refused without it), and `PAYSCOPE_DASHBOARD_API_KEY` (mandatory in production; the `/api/mvp/*` dashboard endpoints reject requests without it).

### 1. Backend Setup
```bash
cd backend
cp .env.example .env
npm install
npm run build
npm run dev
```

### 2. Frontend Setup
```bash
cd frontend
cp .env.example .env
npm install
npm run build
npm run dev
```

### 3. Demo Operator Studio
A standalone local harness for triggering signed webhook payloads and inspecting live scenarios:
```bash
cd docs/demo-kit
npm start
```
Access the operator UI at `http://127.0.0.1:3050`.

To prepare a Razorpay Test order for checkout (this does not create a payment, Payment Link, or causal recovery reference):
```bash
node docs/demo-kit/scripts/generate-test-payments.mjs
```

---

## Verification & Testing

```bash
# Backend suites: integration scenarios (strategy selection/exhaustion, policy gates,
# adaptive replanning, webhook rotation, encrypted callback evidence, fail-closed DB reads)
# plus a real-HTTP suite that boots the actual server and posts signed webhooks over the wire
cd backend && npm run test

# Frontend TypeScript compilation & production build check
cd frontend && npm run build

# Demo kit HMAC signature & replay test
node docs/demo-kit/scripts/self-test.mjs
```
