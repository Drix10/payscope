# PayScope

<p align="center">
  <strong>An autonomous payment-operations platform for Razorpay merchants.</strong><br />
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

PayScope turns Razorpay webhook events into a complete, tenant-scoped resolution loop. It correlates raw payment signals into unified incident timelines, runs multi-agent root-cause analysis, and executes policy-bounded recovery actions with verified Razorpay callback reconciliation.

---

## Key Pillars

1. **Razorpay Vulcan Intelligence Ingestion:** Directly ingests Razorpay Vulcan real-time payment telemetry, extracting acquirer health metrics, failure attributions, and network risk flags across the enrichment layer and dashboard UI.
2. **Multi-Agent Root-Cause Analysis:** Uses dedicated agent roles (Supervisor, Risk Analyst, Recovery Planner) via Mesh API to evaluate causal narratives, alternative hypotheses, and evidence confidence without speculative execution.
3. **Deterministic Policy Safety Engine:** Hard-coded policy rules validate merchant consent, dispute locks, amount caps, and contact frequency limits before any provider command is dispatched.
4. **Idempotent Execution & Callback Reconciliation:** Emits traceable recovery actions (e.g. Razorpay Payment Links) with unique reference tracking (`ps_...`), confirming recovery only upon signed callback verification.

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
      <strong>03 — AI Decision Record</strong><br />
      Detailed evidence breakdown, causal attributions, alternative hypotheses, and policy evaluation gates.<br /><br />
      <img src="docs/screenshots/03-ai-decision-record.png" alt="PayScope AI decision record" />
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
| **Project objective** | Ingest signed Razorpay events, enrich with Razorpay Vulcan intelligence, analyze evidence using a structured multi-agent pipeline, execute authorized recovery actions, and verify outcomes via signed callbacks. |
| **What it solves** | Payment failures are noisy and hard to resolve manually. PayScope correlates raw webhooks into unified incidents, distinguishes bank outages from customer drops, executes recovery links, and makes every action 100% audit-verifiable. |

---

## System Architecture

```text
Razorpay Webhook (HMAC SHA-256 Signed)
   │
   ▼
Razorpay Vulcan Intelligence Layer (Acquirer Health & Failure Attribution)
   │
   ▼
Correlation & Deduplication Engine (Order ID, Customer Hash, Time Window)
   │
   ▼
Multi-Agent Analysis Engine (Supervisor → Risk Analyst → Recovery Planner)
   │
   ▼
Deterministic Policy Engine (Safety Gates, Dispute Locks, Contact Ceilings)
   │
   ▼
Provider Execution Adapters (Razorpay Payment Links & Notification Delivery)
   │
   ▼
Callback Reconciliation & Append-Only Audit Trail
```

---

## System Components & Authority Boundaries

| Component | Function | Authority Boundary |
|---|---|---|
| **Supervisor Agent** | Synthesizes incident context, sets investigation objectives, and establishes risk constraints. | Analytical only; cannot execute commands or alter policies. |
| **Risk Analyst Agent** | Analyzes payment failure telemetry, merchant metrics, and causal factors. | Analytical only; reads tenant data without side effects. |
| **Recovery Planner Agent** | Recommends recovery options based on failure attribution and customer state. | Formulates proposals only; subject to policy approval. |
| **Deterministic Policy Engine** | Evaluates hard business rules, dispute blocks, and outreach ceilings. | Gatekeeper; holds final execution authority. |
| **Execution Workers** | Dispatches authorized provider commands and tracks provider receipts. | Executes approved actions idempotently. |

---

## Local Setup & Demo Studio

### Prerequisites
- Node.js 20+
- npm
- PostgreSQL / Supabase instance (SQL migrations located in `backend/supabase/migrations`)

### 1. Backend Setup
```bash
cd backend
cp .env.example .env
npm install
npm run build
npm run start
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

To generate real Razorpay Test payment references for live testing:
```bash
node docs/demo-kit/scripts/generate-test-payments.mjs
```

---

## Verification & Testing

```bash
# Comprehensive test suite (21 tests across Multi-Agent Engine, Execution Outbox, Fixture Baselines, and Causal Attribution)
cd backend && npm run test

# Frontend TypeScript compilation & production build check
cd frontend && npm run build

# Demo kit HMAC signature & replay test
node docs/demo-kit/scripts/self-test.mjs
```
