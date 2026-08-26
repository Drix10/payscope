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

export function mapAttributionToRootCause(attribution: string | undefined): 'gateway_degraded' | 'issuer_block' | 'fraud_confirmed' | 'customer_error' {
  switch (attribution) {
    case 'gateway_degraded':
      return 'gateway_degraded';
    case 'issuer_timeout':
    case 'issuer_block':
      return 'issuer_block';
    case 'fraud_block':
      return 'fraud_confirmed';
    case 'customer_drop':
    case 'subscription_lapse':
    default:
      return 'customer_error';
  }
}

export function adaptRecoveryStrategy(
  previousStrategiesTried: string[],
  incident: Incident,
  enrichment: VulcanEnrichment | null,
  riskAnalysis: RiskAnalysis,
  customerProfile: CustomerProfile | null,
  autonomyPolicy: AutonomyPolicy | null
): RecoveryStrategy | null {
  // Fraud and dispute hard stops
  if (
    incident.status === 'DISPUTE_OPENED' ||
    riskAnalysis.failureRootCause === 'fraud_confirmed' ||
    riskAnalysis.failureRootCause === 'fraud_suspected' ||
    enrichment?.failureAttribution === 'fraud_block'
  ) {
    return null;
  }
  const ranked = rankStrategies(incident, enrichment, riskAnalysis, customerProfile, autonomyPolicy);
  const untried = ranked.filter(s =>
    !previousStrategiesTried.includes(s.name) &&
    s.capabilities.every(cap => !previousStrategiesTried.includes(cap))
  );
  return untried[0] ?? null;
}

export type ReplanRepository = {
  incidentDetail(organizationId: string, incidentId: string): Promise<{
    incident: Incident;
    events: Array<{ id: string; event: { customerHash?: string; eventType: string }; enrichment?: VulcanEnrichment | null }>;
    investigation: { riskAnalysis: RiskAnalysis } | null;
    execution: Array<{ capability: ActionType; command_key?: string }>;
  } | null>;
  customerProfile(organizationId: string, customerHash: string): Promise<CustomerProfile | null>;
  autonomyPolicy(organizationId: string): Promise<AutonomyPolicy | null>;
  createExecutionActionForSaga(organizationId: string, incidentId: string, capability: ActionType, rationale: string, amountPaise: number): Promise<string>;
};

export async function replanIncidentStrategy(
  repository: ReplanRepository,
  organizationId: string,
  incidentId: string,
  reason: string
): Promise<{ adaptedStrategy: RecoveryStrategy | null; actionId: string | null }> {
  const detail = await repository.incidentDetail(organizationId, incidentId).catch(() => null);
  if (!detail || !detail.execution || detail.execution.length === 0 || detail.incident.status === 'RESOLVED' || detail.incident.status === 'DISMISSED' || detail.incident.status === 'DISPUTE_OPENED') {
    return { adaptedStrategy: null, actionId: null };
  }
  const latest = detail.events.at(-1);
  const enrichment = [...detail.events].reverse().find(event => event.enrichment)?.enrichment ?? null;

  // Enforce fraud hard stop on telemetry attribution
  if (enrichment?.failureAttribution === 'fraud_block') {
    return { adaptedStrategy: null, actionId: null };
  }

  // Real risk analysis derived directly from existing durable investigation
  const realRiskAnalysis = detail.investigation?.riskAnalysis;
  if (!realRiskAnalysis) {
    return { adaptedStrategy: null, actionId: null };
  }

  const customerProfile = latest?.event.customerHash ? await repository.customerProfile(organizationId, latest.event.customerHash).catch(() => null) : null;
  const autonomyPolicy = await repository.autonomyPolicy(organizationId).catch(() => null);

  const tried = (detail.execution || []).flatMap((a: { capability: ActionType; command_key?: string }) => {
    const list: string[] = [a.capability];
    if (a.command_key) list.push(a.command_key);
    return list;
  });

  const adapted = adaptRecoveryStrategy(tried, detail.incident, enrichment, realRiskAnalysis, customerProfile, autonomyPolicy);
  if (!adapted) return { adaptedStrategy: null, actionId: null };

  // Idempotency check: Ensure we do not create duplicate actions for the same capability/incident
  const canonicalKey = `${organizationId}:${adapted.capabilities[0]}:${incidentId}`;
  const existingExecution = (detail.execution || []).some((a: { capability?: string; command_key?: string }) =>
    a.capability === adapted.capabilities[0] || a.command_key === canonicalKey
  );
  if (existingExecution) {
    return { adaptedStrategy: null, actionId: null };
  }

  const actionId = await repository.createExecutionActionForSaga(
    organizationId,
    incidentId,
    adapted.capabilities[0],
    `Adaptive recovery execution (Replan reason: ${reason})`,
    detail.incident.remainingAmountPaise
  );

  return { adaptedStrategy: adapted, actionId };
}
