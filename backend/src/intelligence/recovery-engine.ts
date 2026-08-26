import { ActionType, AutonomyPolicy, Incident, RiskAnalysis, VulcanEnrichment } from '../domain/contracts';

export type SagaStepType = 'observe' | 'act' | 'wait' | 'replan';
export type SagaStepDef =
  | { type: 'observe'; description: string }
  | { type: 'act'; capability: ActionType; rationale: string }
  | { type: 'wait'; durationMs: number; description: string }
  | { type: 'replan'; description: string };
export type SagaDef = { name: string; displayName: string; steps: SagaStepDef[] };
export type RecoverySagaRecord = { id: string; organizationId: string; incidentId: string; strategyName: string; status: 'active' | 'completed' | 'abandoned'; currentStepIndex: number; totalSteps: number; outcome: string | null; recoveredPaise: number; vulcanDataSource: string; createdAt: string; completedAt: string | null };
export type SagaStepRecord = { id: string; organizationId: string; sagaId: string; stepIndex: number; stepType: SagaStepType; capability: ActionType | null; waitDurationMs: number | null; scheduledAt: string; status: string; executedAt: string | null; outcome: Record<string, unknown> | null };

export type CustomerProfile = {
  organizationId: string;
  customerHash: string;
  successfulPaymentMethods: string[];
  failedPaymentMethods: string[];
  successfulPaymentCount: number;
  totalIncidentCount: number;
  recoveryEmailsSent: number;
  recoveryEmailsPaid: number;
  lastContactedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type RecoveryStrategy = {
  name: string;
  displayName: string;
  capabilities: ActionType[];
  baseScore: number;
  customerAdjustment: number;
  finalScore: number;
  expectedValuePaise: number;
  dataSource: 'vulcan_direct' | 'razorpay_fields_heuristic';
  blockedBy: string | null;
};

const ATTRIBUTION_STRATEGY_SCORES: Record<string, Record<string, number>> = {
  gateway_degraded: {
    deliver_recovery_link_email: 68,
    resolve_infrastructure: 75,
  },
  customer_drop: {
    deliver_recovery_link_email: 82,
  },
  subscription_lapse: {
    deliver_recovery_link_email: 62,
  },
  issuer_timeout: {
    deliver_recovery_link_email: 55,
  },
  issuer_block: {
    deliver_recovery_link_email: 50,
  },
  routing_suboptimal: {
    deliver_recovery_link_email: 63,
    resolve_infrastructure: 70,
  },
  insufficient_funds: {
    deliver_recovery_link_email: 30,
  },
  fraud_block: {},
  unknown: {
    deliver_recovery_link_email: 45,
  },
};

function strategyDisplayName(name: string): string {
  switch (name) {
    case 'deliver_recovery_link_email': return '1-Click Razorpay Payment Link Email';
    case 'resolve_infrastructure': return 'Gateway Health Monitoring & Auto-Rerouting';
    case 'submit_dispute_evidence': return 'Autonomous Chargeback Dispute Evidence Submission';
    case 'record_risk_signal': return 'Risk Telemetry & Fraud Pattern Recording';
    case 'capture_authorized_payment': return 'Authorization Capture Dispatch';
    case 'refund_payment': return 'Customer Refund Processing';
    default: return name.replace(/_/g, ' ');
  }
}

function strategyCaps(name: string): ActionType[] {
  switch (name) {
    case 'resolve_infrastructure': return ['resolve_infrastructure'];
    case 'submit_dispute_evidence': return ['submit_dispute_evidence'];
    case 'record_risk_signal': return ['record_risk_signal'];
    case 'capture_authorized_payment': return ['capture_authorized_payment'];
    case 'refund_payment': return ['refund_payment'];
    default: return ['deliver_recovery_link_email'];
  }
}

function checkAutonomyPolicy(name: string, policy: AutonomyPolicy | null): string | null {
  if (!policy) return null;
  if (name === 'deliver_recovery_link_email' && !policy.recoveryEmailEnabled) return 'recovery_email_disabled';
  if (name === 'submit_dispute_evidence' && !policy.disputeEvidenceEnabled) return 'dispute_evidence_disabled';
  if (name === 'capture_authorized_payment' && !policy.captureEnabled) return 'capture_disabled';
  if (name === 'refund_payment' && !policy.refundEnabled) return 'refund_disabled';
  return null;
}

export function rankStrategies(
  incident: Incident,
  enrichment: VulcanEnrichment | null,
  riskAnalysis: RiskAnalysis,
  customerProfile: CustomerProfile | null,
  autonomyPolicy: AutonomyPolicy | null
): RecoveryStrategy[] {
  if (riskAnalysis.failureRootCause === 'fraud_confirmed' || riskAnalysis.failureRootCause === 'fraud_suspected' || enrichment?.failureAttribution === 'fraud_block') {
    return [];
  }

  const attribution = enrichment?.failureAttribution ?? 'unknown';
  const scores = ATTRIBUTION_STRATEGY_SCORES[attribution] ?? ATTRIBUTION_STRATEGY_SCORES.unknown;
  const dataSource = enrichment?.source === 'vulcan_direct' ? 'vulcan_direct' : 'razorpay_fields_heuristic';

  const strategies: RecoveryStrategy[] = [];

  for (const [name, baseScore] of Object.entries(scores)) {
    let adjustment = 0;

    if (enrichment?.recommendedRetryMethod) {
      if (name.includes(enrichment.recommendedRetryMethod)) adjustment += 15;
    }

    if (customerProfile) {
      if (customerProfile.successfulPaymentCount > 3) adjustment += 8;
      if (customerProfile.lastContactedAt) {
        const hoursAgo = (Date.now() - Date.parse(customerProfile.lastContactedAt)) / 3_600_000;
        if (hoursAgo < 24) adjustment -= 22;
      }
    }

    const finalScore = Math.max(0, Math.min(100, baseScore + adjustment));
    const expectedValuePaise = Math.round((finalScore / 100) * incident.remainingAmountPaise);
    const blockedBy = checkAutonomyPolicy(name, autonomyPolicy);

    strategies.push({
      name,
      displayName: strategyDisplayName(name),
      capabilities: strategyCaps(name),
      baseScore,
      customerAdjustment: adjustment,
      finalScore,
      expectedValuePaise,
      dataSource,
      blockedBy,
    });
  }

  return strategies
    .filter(s => s.blockedBy === null)
    .sort((a, b) => b.expectedValuePaise - a.expectedValuePaise);
}
