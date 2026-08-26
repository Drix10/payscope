import { ActionType, AutonomyPolicy, Incident, RiskAnalysis, VulcanEnrichment } from '../domain/contracts';

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
  recoveryValueScore: number;
  heuristicRecoveryEstimatePaise: number;
  dataSource: 'razorpay_fields_heuristic';
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
  const dataSource = 'razorpay_fields_heuristic';

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

    const recoveryValueScore = Math.max(0, Math.min(100, baseScore + adjustment));
    const heuristicRecoveryEstimatePaise = Math.round((recoveryValueScore / 100) * incident.remainingAmountPaise);
    const blockedBy = checkAutonomyPolicy(name, autonomyPolicy);

    strategies.push({
      name,
      displayName: strategyDisplayName(name),
      capabilities: strategyCaps(name),
      baseScore,
      customerAdjustment: adjustment,
      recoveryValueScore,
      heuristicRecoveryEstimatePaise,
      dataSource,
      blockedBy,
    });
  }

  return strategies
    .filter(s => s.blockedBy === null)
    .sort((a, b) => b.heuristicRecoveryEstimatePaise - a.heuristicRecoveryEstimatePaise);
}

export function adaptRecoveryStrategy(
  previousStrategiesTried: string[],
  incident: Incident,
  enrichment: VulcanEnrichment | null,
  riskAnalysis: RiskAnalysis,
  customerProfile: CustomerProfile | null,
  autonomyPolicy: AutonomyPolicy | null
): RecoveryStrategy | null {
  const ranked = rankStrategies(incident, enrichment, riskAnalysis, customerProfile, autonomyPolicy);
  const untried = ranked.filter(s => !previousStrategiesTried.includes(s.name));
  return untried[0] ?? null;
}

export async function replanIncidentStrategy(
  repository: any,
  organizationId: string,
  incidentId: string,
  reason: string
): Promise<{ adaptedStrategy: RecoveryStrategy | null; actionId: string | null }> {
  const detail = await repository.incidentDetail(organizationId, incidentId).catch(() => null);
  if (!detail || detail.incident.status === 'RESOLVED' || detail.incident.status === 'DISMISSED') {
    return { adaptedStrategy: null, actionId: null };
  }
  const latest = detail.events.at(-1);
  const enrichment = [...detail.events].reverse().find(event => event.enrichment)?.enrichment ?? null;
  const customerProfile = latest?.event.customerHash ? await repository.customerProfile(organizationId, latest.event.customerHash).catch(() => null) : null;
  const autonomyPolicy = await repository.autonomyPolicy(organizationId).catch(() => null);

  const triedCapabilities = (detail.execution || []).map((a: { capability: ActionType }) => a.capability);
  const fakeRiskAnalysis = {
    failureRootCause: enrichment?.failureAttribution === 'gateway_degraded' ? 'gateway_degraded' : 'customer_error',
    evidenceStrength: 'moderate',
    confidence: 0.85,
    causalNarrative: `Adaptive replan triggered: ${reason}`,
    evidenceConfidenceRationale: 'Verified adaptive event trigger',
    alternativeHypotheses: [],
    falsePositiveCostEstimatePaise: detail.incident.remainingAmountPaise,
    missingEvidence: [],
    chargebackEvidenceReady: false,
    evidenceItems: [latest?.event.eventType ?? 'payment.failed'],
    recommendedActionCategory: 'deliver_recovery_link_email',
    toolResults: {},
  };

  const adapted = adaptRecoveryStrategy(triedCapabilities, detail.incident, enrichment, fakeRiskAnalysis as any, customerProfile, autonomyPolicy);
  if (!adapted) return { adaptedStrategy: null, actionId: null };

  const actionId = await repository.createExecutionActionForSaga(
    organizationId,
    incidentId,
    adapted.capabilities[0],
    `Adaptive recovery execution (Replan reason: ${reason})`,
    detail.incident.remainingAmountPaise
  );

  return { adaptedStrategy: adapted, actionId };
}
