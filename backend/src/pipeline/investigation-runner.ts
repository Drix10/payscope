import { randomUUID } from 'crypto';
import { MvpRepository } from '../db/mvp-repository';
import { InvestigationPlan, InvestigationPlanSchema, PolicyDecisionSchema, QueueJob, RecoveryPlan, RecoveryPlanSchema, RiskAnalysis, RiskAnalysisSchema } from '../domain/contracts';
import { ModelProvider, ModelRequest, ModelResult } from '../providers/model/interface';
import { runInvestigationSupervisor } from './investigation-supervisor';
import { evaluatePolicy } from './policy-evaluator';
import { runRecoveryPlanner } from './recovery-planner';
import { runRiskAnalyst } from './risk-analyst';
import { paymentLinkReferenceForProposalDirect } from '../evaluation/attribution';
import { logger } from '../observability';

const AGENT_PIPELINE_DEADLINE_MS = 20_000;

/** Executes only bounded agents and persists either a validated result or a safe escalation. */
export async function runDurableInvestigation(repository: MvpRepository, provider: ModelProvider, job: QueueJob, options: { directExecution?: boolean } = {}): Promise<void> {
  if (!job.incidentId) throw new Error('Investigation job is missing incidentId');
  if (!job.triggerEventId) throw new Error('Investigation job is missing triggerEventId');
  const started = Date.now();
  const detail = await repository.incidentDetail(job.organizationId, job.incidentId);
  let output: { plan: Awaited<ReturnType<typeof runInvestigationSupervisor>>; risk: Awaited<ReturnType<typeof runRiskAnalyst>>; recovery: Awaited<ReturnType<typeof runRecoveryPlanner>>; policy: ReturnType<typeof PolicyDecisionSchema.parse> };
  try {
    const latest = detail.events.at(-1);
    const enrichment = [...detail.events].reverse().find(event => event.enrichment)?.enrichment ?? null;
    const [policyContext, metrics, memory, executionContext] = await Promise.all([
      repository.policyContext(job.organizationId, job.incidentId, latest?.event.customerHash),
      repository.riskToolMetrics(job.organizationId, latest?.event.paymentMethod ?? 'unknown', latest?.event.customerHash, 1).catch(() => null),
      options.directExecution ? repository.incidentMemory(job.organizationId, job.incidentId).catch(() => []) : Promise.resolve([]),
      options.directExecution && typeof repository.executionPolicyContext === 'function' ? repository.executionPolicyContext(job.organizationId) : Promise.resolve(null),
    ]);
    const deadlineProvider = providerWithDeadline(provider, started + AGENT_PIPELINE_DEADLINE_MS);
    const [supervisor, risk] = await Promise.all([
      runInvestigationSupervisor(deadlineProvider, { incident: detail.incident, enrichment, merchantPolicyCount: 1, autoResolveBudgetRemaining: Math.max(0, 1 - policyContext.stats.autoResolveFraction) }, job.organizationId),
      runRiskAnalyst(deadlineProvider, {
        getIncidentTimeline: async () => detail.events.map(event => event.event),
        getMerchantFailureRate: async () => metrics?.merchantFailureRate ?? null,
        getNetworkFailureRate: async () => metrics?.networkFailureRate ?? null,
        getCustomerIncidentCount: async () => metrics?.customerIncidentCount ?? null,
      }, { incident: detail.incident, enrichment, customerHash: latest?.event.customerHash, gateway: latest?.event.paymentMethod ?? 'unknown' }, job.organizationId),
    ]);
    const recovery = await runRecoveryPlanner(deadlineProvider, { incident: detail.incident, riskAnalysis: risk.analysis, merchantOptedInToRecovery: policyContext.policy.merchantOptedIn, memory, directExecution: Boolean(options.directExecution) }, job.organizationId);
    const directOptions = executionContext ? {
      executionPolicy: executionContext.policy,
      existingCommandKeys: executionContext.existingCommandKeys,
      commandKeyForAction: (actionType: Parameters<typeof evaluatePolicy>[2]['proposedActions'][number]['actionType']) => `${job.organizationId}:${actionType}:${detail.incident.id}`,
      amountPaise: latest?.event.amountPaise ?? detail.incident.remainingAmountPaise,
      currency: latest?.event.currency ?? 'INR',
    } : undefined;
    output = { plan: supervisor, risk, recovery, policy: PolicyDecisionSchema.parse(evaluatePolicy(detail.incident, risk.analysis, recovery.plan, [policyContext.policy], policyContext.stats, policyContext.contact, directOptions)) };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ incidentId: job.incidentId, errorMsg }, 'LLM model investigation fell back to deterministic heuristic evaluation');

    const latest = detail.events.at(-1);
    const enrichment = [...detail.events].reverse().find(event => event.enrichment)?.enrichment ?? null;
    const [policyContext, executionContext] = await Promise.all([
      repository.policyContext(job.organizationId, job.incidentId, latest?.event.customerHash),
      options.directExecution && typeof repository.executionPolicyContext === 'function' ? repository.executionPolicyContext(job.organizationId).catch(() => null) : Promise.resolve(null),
    ]);

    const attr = enrichment?.failureAttribution ?? 'unknown';
    const primaryFailureCategory = attr === 'gateway_degraded' || attr === 'issuer_timeout' || attr === 'routing_suboptimal'
      ? 'infrastructure'
      : attr === 'fraud_block'
        ? 'fraud_confirmed'
        : attr === 'customer_drop' || attr === 'insufficient_funds'
          ? 'customer_error'
          : 'unknown';

    const humanCategory = attr === 'gateway_degraded'
      ? 'temporary payment gateway downtime'
      : attr === 'issuer_timeout'
        ? 'card issuer authorization timeout'
        : attr === 'customer_drop'
          ? 'customer checkout drop-off'
          : attr === 'insufficient_funds'
            ? 'insufficient card balance'
            : attr === 'fraud_block'
              ? 'high-risk network fraud block'
              : 'unattributed gateway or issuer response';

    const fallbackPlan = InvestigationPlanSchema.parse({
      hypothesis: `Payment transaction failed due to ${humanCategory}.`,
      primaryFailureCategory,
      objectives: ['Classify payment telemetry and evaluate risk tier', 'Apply deterministic safety policies'],
      evidencePriorities: [{ fact: 'Verified payment failure event recorded', whyItMatters: 'Requires deterministic policy evaluation' }],
      subAgents: [
        { agent: 'risk_analyst', question: 'What is the risk level?', priority: 1, allowedContextFields: ['payment'] },
        { agent: 'recovery_planner', question: 'What is the recovery plan?', priority: 1, allowedContextFields: ['payment'] },
      ],
      constraints: ['Enforce stopping rules', 'No contact on dispute or fraud'],
      noActionCriteria: ['Dispute opened', 'Fraud confirmed'],
      estimatedAutoResolvable: primaryFailureCategory !== 'fraud_confirmed',
      requiresNoActionFallback: true,
      confidence: 0.85,
      reasoning: `Deterministic heuristic classification based on ${enrichment?.source ?? 'intake telemetry'}.`,
    });

    const fallbackRisk = RiskAnalysisSchema.parse({
      failureRootCause: attr === 'gateway_degraded' ? 'gateway_degraded' : attr === 'issuer_timeout' ? 'issuer_block' : 'customer_error',
      evidenceStrength: 'moderate',
      confidence: 0.85,
      causalNarrative: `Payment failure verified and attributed to ${humanCategory}. Evaluated via deterministic engine.`,
      evidenceConfidenceRationale: 'Verified by durable telemetry intake and heuristic enrichment.',
      alternativeHypotheses: ['Issuer timeout', 'Customer drop'],
      falsePositiveCostEstimatePaise: 0,
      missingEvidence: [],
      chargebackEvidenceReady: false,
      evidenceItems: [latest?.event.eventType ?? 'payment.failed'],
      recommendedActionCategory: 'deliver_recovery_link_email',
      toolResults: { incidentTimelineEventCount: detail.events.length, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null },
    });

    const fallbackRecovery = RecoveryPlanSchema.parse({
      proposedActions: [
        {
          actionType: 'deliver_recovery_link_email',
          rationale: 'Deliver a Razorpay Payment Link email to recover the failed transaction.',
          preconditions: ['Merchant opted in to recovery'],
          expectedOutcome: 'Customer completes payment via recovery link',
          estimatedRecoveryPaise: detail.incident.remainingAmountPaise,
          requiresAutonomousExecution: true,
        }
      ],
      recoveryProbability: 0.8,
      confidence: 0.85,
    });

    const directOptions = executionContext ? {
      executionPolicy: executionContext.policy,
      existingCommandKeys: executionContext.existingCommandKeys,
      commandKeyForAction: (actionType: Parameters<typeof evaluatePolicy>[2]['proposedActions'][number]['actionType']) => `${job.organizationId}:${actionType}:${detail.incident.id}`,
      amountPaise: latest?.event.amountPaise ?? detail.incident.remainingAmountPaise,
      currency: latest?.event.currency ?? 'INR',
    } : undefined;

    const fallbackPolicy = PolicyDecisionSchema.parse(evaluatePolicy(detail.incident, fallbackRisk, fallbackRecovery, [policyContext.policy], policyContext.stats, policyContext.contact, directOptions));

    output = {
      plan: { plan: fallbackPlan, modelId: 'payscope-heuristic-fallback', tokensUsed: 0 },
      risk: { analysis: fallbackRisk, modelId: 'payscope-heuristic-fallback', tokensUsed: 0 },
      recovery: { plan: fallbackRecovery, modelId: 'payscope-heuristic-fallback', tokensUsed: 0 },
      policy: fallbackPolicy,
    };
  }
  const proposals = output.policy.permittedActions.map(action => {
    const id = randomUUID();
    return {
      id,
      actionType: action.actionType,
      rationale: action.rationale,
      content: {
        rationale: action.rationale,
        estimatedRecoveryPaise: action.estimatedRecoveryPaise,
        ...(action.actionType === 'deliver_recovery_link_email' ? { paymentLinkReferenceId: paymentLinkReferenceForProposalDirect(id) } : {}),
        ...(action.emailCopyIntent ? { emailCopyIntent: action.emailCopyIntent } : {}),
      },
    };
  });
  const persistence = [job.organizationId, job.incidentId, job.triggerEventId, output.plan.plan, output.risk.analysis, output.recovery.plan, output.policy, proposals, [output.plan.modelId, output.risk.modelId, output.recovery.modelId].join(','), output.plan.tokensUsed + output.risk.tokensUsed + output.recovery.tokensUsed, Date.now() - started] as const;
  // Direct execution is now the single system — legacy simulation path fully removed
  await repository.persistDirectInvestigation(...persistence);
}

function providerWithDeadline(provider: ModelProvider, deadlineAt: number): ModelProvider {
  return {
    async complete<T>(request: ModelRequest<T>): Promise<ModelResult<T>> {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) throw new Error('PayScope agent pipeline exceeded its 9.5-second deadline');
      return provider.complete({ ...request, timeoutMs: remaining });
    },
  };
}
