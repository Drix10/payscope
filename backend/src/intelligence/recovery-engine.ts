import { ActionType, AutonomyPolicy, Incident, RecoveryPlanSchema, RiskAnalysis, VulcanEnrichment } from '../domain/contracts';
import { evaluatePolicy, ExecutionPolicy, MerchantPolicy, OrgDailyStats, CustomerContactStats } from '../pipeline/policy-evaluator';

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

const INFRASTRUCTURE_EVIDENCE_MAX_AGE_MS = 10 * 60 * 1_000;
// A strategy may only enter the autonomous path when it has an end-to-end
// provider adapter, receipt, reconciliation, and atomic outbox contract.
// Infrastructure routing is diagnostic-only until such a contract exists.
const DIRECTLY_EXECUTABLE_STRATEGIES = new Set(['deliver_recovery_link_email']);

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
  const enrichmentAgeMs = enrichment ? Date.now() - Date.parse(enrichment.enrichedAt) : Number.POSITIVE_INFINITY;
  const infrastructureEvidenceFresh = Number.isFinite(enrichmentAgeMs) && enrichmentAgeMs >= 0 && enrichmentAgeMs <= INFRASTRUCTURE_EVIDENCE_MAX_AGE_MS;

  for (const [name, baseScore] of Object.entries(scores)) {
    if (!DIRECTLY_EXECUTABLE_STRATEGIES.has(name)) continue;
    if (name === 'resolve_infrastructure' && !infrastructureEvidenceFresh) continue;
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
    events: Array<{ id: string; event: { customerHash?: string; eventType: string; currency?: string }; enrichment?: VulcanEnrichment | null }>;
    investigation: { riskAnalysis: RiskAnalysis | null } | null;
    execution: Array<{ id?: string; capability: ActionType; command_key?: string; state?: 'queued' | 'dispatching' | 'accepted' | 'unreconciled' | 'confirmed' | 'retry_scheduled' | 'compensating' | 'failed' | 'cancelled' }>;
  } | null>;
  customerProfile(organizationId: string, customerHash: string): Promise<CustomerProfile | null>;
  autonomyPolicy(organizationId: string): Promise<AutonomyPolicy | null>;
  policyContext?(organizationId: string, incidentId: string, customerHash?: string): Promise<{ policy: MerchantPolicy; stats: OrgDailyStats; contact: CustomerContactStats }>;
  executionPolicyContext?(organizationId: string): Promise<{ policy: ExecutionPolicy; existingCommandKeys: Set<string> }>;
  createExecutionActionForSaga(organizationId: string, incidentId: string, capability: ActionType, rationale: string, amountPaise: number): Promise<string>;
  recordAdaptiveReplanDecision?(input: {
    organizationId: string;
    incidentId: string;
    triggerReason: string;
    decision: 'no_action' | 'policy_permitted' | 'action_created';
    rationale: string;
    priorActionId?: string | null;
    adaptedStrategy?: string | null;
    actionId?: string | null;
    confidence?: number | null;
    policyOutcome?: string | null;
  }): Promise<void>;
};

export async function replanIncidentStrategy(
  repository: ReplanRepository,
  organizationId: string,
  incidentId: string,
  reason: string
): Promise<{ adaptedStrategy: RecoveryStrategy | null; actionId: string | null }> {
  const detail = await repository.incidentDetail(organizationId, incidentId).catch(() => null);
  if (!detail) {
    return { adaptedStrategy: null, actionId: null };
  }
  if (!repository.recordAdaptiveReplanDecision) throw new Error('Adaptive replan audit persistence is not configured');
  const audit = async (
    decision: 'no_action' | 'policy_permitted' | 'action_created',
    rationale: string,
    extra: { priorActionId?: string | null; adaptedStrategy?: string | null; actionId?: string | null; confidence?: number | null; policyOutcome?: string | null } = {},
  ): Promise<void> => repository.recordAdaptiveReplanDecision!({ organizationId, incidentId, triggerReason: reason, decision, rationale, ...extra });
  if (!detail.execution || detail.execution.length === 0 || detail.incident.status === 'RESOLVED' || detail.incident.status === 'DISMISSED' || detail.incident.status === 'DISPUTE_OPENED') {
    await audit('no_action', `Adaptive replan skipped for terminal incident or missing prior execution: ${detail.incident.status}.`);
    return { adaptedStrategy: null, actionId: null };
  }
  // A prior command is not evidence of a failed intervention. Only a
  // terminal failure/unknown/cancelled command can unlock adaptive planning;
  // queued, dispatching, accepted, and confirmed actions remain in their
  // normal execution/reconciliation lifecycle.
  const priorFailedAction = [...detail.execution].reverse().find(action =>
    action.state === 'failed' || action.state === 'unreconciled' || action.state === 'cancelled'
  );
  if (!priorFailedAction) {
    await audit('no_action', 'Adaptive replan skipped because no prior action is failed, unreconciled, or cancelled.');
    return { adaptedStrategy: null, actionId: null };
  }
  const latest = detail.events.at(-1);
  const enrichment = [...detail.events].reverse().find(event => event.enrichment)?.enrichment ?? null;

  // Enforce fraud hard stop on telemetry attribution
  if (enrichment?.failureAttribution === 'fraud_block') {
    await audit('no_action', 'Adaptive replan skipped by fraud telemetry hard stop.', { priorActionId: priorFailedAction.id ?? null });
    return { adaptedStrategy: null, actionId: null };
  }

  // Real risk analysis derived directly from existing durable investigation
  const realRiskAnalysis = detail.investigation?.riskAnalysis;
  if (!realRiskAnalysis) {
    await audit('no_action', 'Adaptive replan skipped because no durable risk analysis exists for the incident.', { priorActionId: priorFailedAction.id ?? null });
    return { adaptedStrategy: null, actionId: null };
  }

  // Durable reads fail closed here: a database outage aborts adaptive
  // replanning entirely (the queue job retries) rather than degrading to a
  // synthetic "customer without history" profile that could unlock action.
  const customerProfile = latest?.event.customerHash ? await repository.customerProfile(organizationId, latest.event.customerHash) : null;
  const autonomyPolicy = await repository.autonomyPolicy(organizationId);

  const tried = (detail.execution || []).flatMap((a: { capability: ActionType; command_key?: string }) => {
    const list: string[] = [a.capability];
    if (a.command_key) list.push(a.command_key);
    return list;
  });

  const adapted = adaptRecoveryStrategy(tried, detail.incident, enrichment, realRiskAnalysis, customerProfile, autonomyPolicy);
  if (!adapted) {
    await audit('no_action', 'Adaptive replan skipped because no untried provider-backed strategy is available.', { priorActionId: priorFailedAction.id ?? null, confidence: realRiskAnalysis.confidence });
    return { adaptedStrategy: null, actionId: null };
  }

  // Replanning has exactly the same authorization boundary as initial
  // execution.  A repository that cannot supply fresh durable policy context
  // fails closed rather than creating an outbox command from strategy ranking.
  if (!repository.policyContext || !repository.executionPolicyContext) {
    await audit('no_action', 'Adaptive replan skipped because durable policy context is unavailable.', { priorActionId: priorFailedAction.id ?? null, adaptedStrategy: adapted.name, confidence: realRiskAnalysis.confidence });
    return { adaptedStrategy: null, actionId: null };
  }
  const policyContext = await repository.policyContext(organizationId, incidentId, latest?.event.customerHash);
  const executionContext = await repository.executionPolicyContext(organizationId);
  const replan = RecoveryPlanSchema.parse({
    proposedActions: adapted.capabilities.map(actionType => ({
      actionType,
      rationale: `Adaptive recovery strategy selected after ${reason}.`,
      preconditions: ['Fresh deterministic policy clearance'],
      expectedOutcome: adapted.displayName,
      estimatedRecoveryPaise: adapted.heuristicRecoveryEstimatePaise,
      requiresAutonomousExecution: true,
    })),
    noActionReason: undefined,
    heuristicRecoveryScore: adapted.recoveryValueScore / 100,
    confidence: realRiskAnalysis.confidence,
  });
  const decision = evaluatePolicy(detail.incident, realRiskAnalysis, replan, [policyContext.policy], policyContext.stats, policyContext.contact, {
    executionPolicy: executionContext.policy,
    existingCommandKeys: executionContext.existingCommandKeys,
    commandKeyForAction: actionType => `${organizationId}:${actionType}:${incidentId}`,
    currentRetryCount: (detail.execution || []).filter(action => action.capability === 'deliver_recovery_link_email').length,
    amountPaise: detail.incident.remainingAmountPaise,
    currency: latest?.event.currency ?? 'INR',
  });
  if (decision.outcome !== 'auto_with_proposals' || decision.permittedActions.length !== 1 || decision.permittedActions[0].actionType !== adapted.capabilities[0]) {
    await audit('no_action', `Adaptive replan blocked by deterministic policy: ${decision.noActionReason ?? 'NO_PERMITTED_ACTION'}.`, { priorActionId: priorFailedAction.id ?? null, adaptedStrategy: adapted.name, confidence: realRiskAnalysis.confidence, policyOutcome: decision.outcome });
    return { adaptedStrategy: null, actionId: null };
  }

  // Idempotency check: Ensure we do not create duplicate actions for the same capability/incident
  const canonicalKey = `${organizationId}:${adapted.capabilities[0]}:${incidentId}`;
  const existingExecution = (detail.execution || []).some((a: { capability?: string; command_key?: string }) =>
    a.capability === adapted.capabilities[0] || a.command_key === canonicalKey
  );
  if (existingExecution) {
    await audit('no_action', 'Adaptive replan skipped by idempotency: capability already exists for this incident.', { priorActionId: priorFailedAction.id ?? null, adaptedStrategy: adapted.name, confidence: realRiskAnalysis.confidence, policyOutcome: decision.outcome });
    return { adaptedStrategy: null, actionId: null };
  }

  await audit('policy_permitted', 'Adaptive replan passed deterministic policy and will enqueue a provider-backed command.', { priorActionId: priorFailedAction.id ?? null, adaptedStrategy: adapted.name, confidence: realRiskAnalysis.confidence, policyOutcome: decision.outcome });
  const actionId = await repository.createExecutionActionForSaga(
    organizationId,
    incidentId,
    adapted.capabilities[0],
    `Adaptive recovery execution (Replan reason: ${reason})`,
    detail.incident.remainingAmountPaise
  );
  await audit('action_created', 'Adaptive replan created an immutable provider-backed execution action.', { priorActionId: priorFailedAction.id ?? null, adaptedStrategy: adapted.name, actionId, confidence: realRiskAnalysis.confidence, policyOutcome: decision.outcome });

  return { adaptedStrategy: adapted, actionId };
}
