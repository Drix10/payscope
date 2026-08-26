import { ActionType } from '../domain/contracts';

export type SagaStepType = 'observe' | 'act' | 'wait' | 'replan';

export type SagaStepDef =
  | { type: 'observe'; description: string }
  | { type: 'act'; capability: ActionType; rationale: string }
  | { type: 'wait'; durationMs: number; description: string }
  | { type: 'replan'; description: string };

export type SagaDef = {
  name: string;
  displayName: string;
  steps: SagaStepDef[];
};

export interface RecoverySagaRecord {
  id: string;
  organizationId: string;
  incidentId: string;
  strategyName: string;
  status: 'active' | 'completed' | 'abandoned';
  currentStepIndex: number;
  totalSteps: number;
  outcome: 'recovered' | 'exhausted' | 'fraud_stopped' | 'dispute_stopped' | 'policy_blocked' | null;
  recoveredPaise: number;
  vulcanDataSource: 'vulcan_direct' | 'razorpay_fields_heuristic';
  createdAt: string;
  completedAt: string | null;
}

export interface SagaStepRecord {
  id: string;
  organizationId: string;
  sagaId: string;
  stepIndex: number;
  stepType: SagaStepType;
  capability: ActionType | null;
  waitDurationMs: number | null;
  scheduledAt: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  executedAt: string | null;
  outcome: Record<string, unknown> | null;
}

export const SAGAS: Record<string, SagaDef> = {
  recovery_email_same_method: {
    name: 'recovery_email_same_method',
    displayName: '1-Click Recovery Email Saga',
    steps: [
      { type: 'observe', description: 'Verify payment status in Razorpay and check for previous recovery' },
      { type: 'act', capability: 'deliver_recovery_link_email', rationale: 'Customer checkout drop-off detected; dispatching 1-click Razorpay Payment Link email' },
      { type: 'wait', durationMs: 4 * 3600_000, description: 'Wait 4 hours for customer to use 1-click link' },
      { type: 'observe', description: 'Check Razorpay: has the payment link been paid?' },
      { type: 'wait', durationMs: 20 * 3600_000, description: 'Wait remaining 20 hours (24h total window)' },
      { type: 'observe', description: 'Final payment status observation before concluding saga' },
    ],
  },
  subscription_retry_direct: {
    name: 'subscription_retry_direct',
    displayName: 'Subscription Mandate Retry & Recovery Saga',
    steps: [
      { type: 'observe', description: 'Fetch current subscription status from Razorpay' },
      { type: 'act', capability: 'retry_subscription_charge', rationale: 'Vulcan AI identified subscription_lapse; triggering mandate retry' },
      { type: 'wait', durationMs: 30 * 60_000, description: 'Wait 30 minutes for mandate retry settlement' },
      { type: 'observe', description: 'Check subscription state after retry' },
      { type: 'act', capability: 'deliver_recovery_link_email', rationale: 'Mandate retry unconfirmed; sending manual payment recovery link' },
      { type: 'wait', durationMs: 24 * 3600_000, description: 'Wait 24 hours for manual payment link completion' },
      { type: 'observe', description: 'Final payment link reconciliation check' },
    ],
  },
  dispute_evidence_auto: {
    name: 'dispute_evidence_auto',
    displayName: 'Autonomous Chargeback Dispute Defense Saga',
    steps: [
      { type: 'observe', description: 'Fetch dispute details and arbitration deadline from Razorpay' },
      { type: 'act', capability: 'submit_dispute_evidence', rationale: 'Assembling Vulcan AI telemetry and payment timeline for dispute submission' },
      { type: 'observe', description: 'Verify provider confirmed dispute evidence submission receipt' },
    ],
  },
  wait_and_observe: {
    name: 'wait_and_observe',
    displayName: 'Infrastructure Telemetry Monitoring Saga',
    steps: [
      { type: 'observe', description: 'Check gateway telemetry health and payment recovery status' },
      { type: 'wait', durationMs: 2 * 3600_000, description: 'Wait 2 hours while bank gateway recovers' },
      { type: 'observe', description: 'Check if payment was captured or completed during downtime recovery' },
      { type: 'act', capability: 'resolve_infrastructure', rationale: 'Gateway health restored; marking infrastructure incident resolved' },
    ],
  },
};
