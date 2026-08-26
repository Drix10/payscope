import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { MvpRepository } from '../db/mvp-repository';
import { Incident, InvestigationPlan, InvestigationPlanSchema, NormalizedEvent, PolicyDecisionSchema, QueueJob, RecoveryPlan, RecoveryPlanSchema, RiskAnalysis, RiskAnalysisModelOutputSchema, RiskAnalysisSchema, VulcanEnrichment } from '../domain/contracts';
import { ModelProvider, ModelRequest, ModelResult } from '../providers/model/interface';
import { evaluatePolicy } from './policy-evaluator';
import { rankStrategies } from '../intelligence/recovery-engine';
import { llmFailureEvents, logger } from '../observability';

export function paymentLinkReferenceForProposalDirect(actionType: string): string {
  const hash = createHash('sha256').update(actionType).digest('hex').slice(0, 32);
  return `ps_${hash}`;
}

const AGENT_PIPELINE_DEADLINE_MS = 35_000;

export type SupervisorInput = {
  incident: Pick<Incident, 'id' | 'riskTier' | 'status' | 'totalFailedAmountPaise' | 'correlatedEventIds' | 'openedAt'>;
  enrichment: VulcanEnrichment | null;
  merchantPolicyCount: number;
  autoResolveBudgetRemaining: number;
};

export type RiskAnalystTools = {
  getIncidentTimeline(incidentId: string): Promise<NormalizedEvent[]>;
  getMerchantFailureRate(windowHours: 1 | 4 | 24): Promise<number | null>;
  getNetworkFailureRate(gateway: string, windowHours: 1 | 4 | 24): Promise<number | null>;
  getCustomerIncidentCount(customerHash: string): Promise<number | null>;
};

export type RiskAnalystInput = {
  incident: Pick<Incident, 'id' | 'riskTier' | 'status' | 'totalFailedAmountPaise' | 'remainingAmountPaise'>;
  enrichment: VulcanEnrichment | null;
  customerHash?: string;
  gateway: string;
};

export type RecoveryPlannerInput = {
  incident: Pick<Incident, 'id' | 'status' | 'remainingAmountPaise' | 'riskTier'>;
  riskAnalysis: RiskAnalysis;
  merchantOptedInToRecovery: boolean;
  directExecution?: boolean;
  memory?: Array<{ type: string; content: Record<string, unknown>; importance: number; createdAt: string }>;
};

const SUPERVISOR_PROMPT = `You are PayScope's Investigation Supervisor, the planning layer of an autonomous payment-operations system.
Your job is to turn the supplied facts into the smallest defensible plan. Return only JSON matching schema.`;

const RISK_PROMPT = `You are PayScope's Risk Analyst. Produce an evidence-bound causal assessment from facts. Return only JSON matching schema.`;

const PLANNER_PROMPT = `You are PayScope's Recovery Planner. Draft bounded action records for execution. Return only JSON matching schema.`;

export async function runInvestigationSupervisor(provider: ModelProvider, input: SupervisorInput, tenantId: string): Promise<{ plan: InvestigationPlan; modelId: string; tokensUsed: number }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await provider.complete({
        systemPrompt: SUPERVISOR_PROMPT,
        userContent: JSON.stringify(input),
        maxInputTokens: 2_048,
        maxTokens: 512,
        responseSchema: InvestigationPlanSchema,
        tenantId,
      });
      return { plan: result.content, modelId: result.modelId, tokensUsed: result.usage.inputTokens + result.usage.outputTokens };
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error('Supervisor failed');
}

export async function runRiskAnalyst(provider: ModelProvider, tools: RiskAnalystTools, input: RiskAnalystInput, tenantId: string): Promise<{ analysis: RiskAnalysis; modelId: string; tokensUsed: number }> {
  const [timeline, merchantFailureRate, networkFailureRate, customerIncidentCount] = await Promise.all([
    tools.getIncidentTimeline(input.incident.id),
    tools.getMerchantFailureRate(1),
    tools.getNetworkFailureRate(input.gateway, 1),
    input.customerHash ? tools.getCustomerIncidentCount(input.customerHash) : Promise.resolve(null),
  ]);
  const safeTimeline = timeline.map(event => ({ eventType: event.eventType, occurredAt: event.occurredAt, amountPaise: event.amountPaise, paymentStatus: event.paymentStatus, paymentMethod: event.paymentMethod }));

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await provider.complete({
        systemPrompt: RISK_PROMPT,
        userContent: JSON.stringify({ incident: input.incident, enrichment: input.enrichment, timeline: safeTimeline, merchantFailureRate, networkFailureRate, customerIncidentCount }),
        maxInputTokens: 3_072,
        maxTokens: 768,
        responseSchema: RiskAnalysisModelOutputSchema,
        tenantId,
      });
      const analysis = RiskAnalysisSchema.parse({
        ...result.content,
        toolResults: { incidentTimelineEventCount: safeTimeline.length, merchantFailureRate, networkFailureRate, customerIncidentCount },
      });
      return { analysis, modelId: result.modelId, tokensUsed: result.usage.inputTokens + result.usage.outputTokens };
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error('Risk Analyst failed');
}

export async function runRecoveryPlanner(provider: ModelProvider, input: RecoveryPlannerInput, tenantId: string): Promise<{ plan: RecoveryPlan; modelId: string; tokensUsed: number }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await provider.complete({
        systemPrompt: PLANNER_PROMPT,
        userContent: JSON.stringify(input),
        maxInputTokens: 2_048,
        maxTokens: 512,
        responseSchema: RecoveryPlanSchema,
        tenantId,
      });
      return { plan: result.content, modelId: result.modelId, tokensUsed: result.usage.inputTokens + result.usage.outputTokens };
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error('Recovery Planner failed');
}

export async function runDurableInvestigation(repository: MvpRepository, provider: ModelProvider, job: QueueJob, options: { directExecution?: boolean } = {}): Promise<void> {
  if (!job.incidentId) throw new Error('Investigation job is missing incidentId');
  if (!job.triggerEventId) throw new Error('Investigation job is missing triggerEventId');
  const started = Date.now();
  const detail = await repository.incidentDetail(job.organizationId, job.incidentId);
  const latest = detail.events.at(-1);
  const enrichment = [...detail.events].reverse().find(event => event.enrichment)?.enrichment ?? null;
  let policyContextResult: Awaited<ReturnType<typeof repository.policyContext>> | null = null;
  let executionContextResult: Awaited<ReturnType<typeof repository.executionPolicyContext>> | null = null;
  let output: { plan: Awaited<ReturnType<typeof runInvestigationSupervisor>>; risk: Awaited<ReturnType<typeof runRiskAnalyst>>; recovery: Awaited<ReturnType<typeof runRecoveryPlanner>>; policy: ReturnType<typeof PolicyDecisionSchema.parse> };
  try {
    const [policyContext, metrics, memory, executionContext] = await Promise.all([
      repository.policyContext(job.organizationId, job.incidentId, latest?.event.customerHash),
      repository.riskToolMetrics(job.organizationId, latest?.event.paymentMethod ?? 'unknown', latest?.event.customerHash, 1).catch(() => null),
      options.directExecution ? repository.incidentMemory(job.organizationId, job.incidentId).catch(() => []) : Promise.resolve([]),
      options.directExecution && typeof repository.executionPolicyContext === 'function' ? repository.executionPolicyContext(job.organizationId) : Promise.resolve(null),
    ]);
    policyContextResult = policyContext;
    executionContextResult = executionContext;
    const deadlineProvider = providerWithDeadline(provider, started + AGENT_PIPELINE_DEADLINE_MS);
    const supervisor = await runInvestigationSupervisor(deadlineProvider, {
      incident: detail.incident,
      enrichment,
      merchantPolicyCount: policyContext.policy.enabled ? 1 : 0,
      autoResolveBudgetRemaining: Math.max(0, 1 - policyContext.stats.autoResolveFraction)
    }, job.organizationId);

    const risk = await runRiskAnalyst(deadlineProvider, {
      getIncidentTimeline: async () => detail.events.map(event => event.event),
      getMerchantFailureRate: async _windowHours => metrics?.merchantFailureRate ?? null,
      getNetworkFailureRate: async (_gateway, _windowHours) => metrics?.networkFailureRate ?? null,
      getCustomerIncidentCount: async () => metrics?.customerIncidentCount ?? null,
    }, {
      incident: detail.incident,
      enrichment,
      customerHash: latest?.event.customerHash,
      gateway: latest?.event.paymentMethod ?? 'unknown',
    }, job.organizationId);

    const recovery = await runRecoveryPlanner(deadlineProvider, {
      incident: detail.incident,
      riskAnalysis: risk.analysis,
      merchantOptedInToRecovery: policyContext.policy.merchantOptedIn,
      directExecution: options.directExecution,
      memory,
    }, job.organizationId);

    // Dynamic Recovery Engine Selection: The Recovery Engine ranks optimal economic strategies based on telemetry & risk
    const customerProfile = latest?.event.customerHash ? await repository.customerProfile(job.organizationId, latest.event.customerHash).catch(() => null) : null;
    const autonomyPolicy = await repository.autonomyPolicy(job.organizationId).catch(() => null);
    const rankedStrategies = rankStrategies(detail.incident, enrichment, risk.analysis, customerProfile, autonomyPolicy);
    const topStrategy = rankedStrategies[0];

    logger.info({
      incidentId: job.incidentId,
      topStrategy: topStrategy?.name ?? 'no_strategy_available',
      recoveryValueScore: topStrategy?.recoveryValueScore ?? 0,
      heuristicRecoveryEstimatePaise: topStrategy?.heuristicRecoveryEstimatePaise ?? 0,
    }, 'Recovery Engine calculated optimal strategy');

    const llmCopyIntent = recovery.plan.proposedActions.find(a => a.emailCopyIntent)?.emailCopyIntent;
    // An absent deterministic strategy is a terminal no-action outcome.  In
    // particular, never turn strategy exhaustion (or a fraud hard-stop) into
    // a default customer-contact action merely because the model suggested it.
    const strategyCapabilities = topStrategy?.capabilities ?? [];

    const enginePlan: RecoveryPlan = RecoveryPlanSchema.parse({
      proposedActions: strategyCapabilities.map(cap => ({
        actionType: cap,
        rationale: `Optimal strategy chosen by Recovery Engine: ${topStrategy?.displayName ?? cap} (Score: ${topStrategy?.recoveryValueScore ?? 80}).`,
        preconditions: ['Merchant opted in to recovery', 'Deterministic policy clearance'],
        expectedOutcome: `Recover ${detail.incident.remainingAmountPaise} paise via ${topStrategy?.displayName ?? cap}`,
        estimatedRecoveryPaise: topStrategy?.heuristicRecoveryEstimatePaise ?? 0,
        requiresAutonomousExecution: true,
        emailCopyIntent: cap === 'deliver_recovery_link_email' ? (llmCopyIntent ?? 'Complete your recent payment securely using our 1-click Razorpay payment link. Reply STOP to opt out.') : undefined,
      })),
      noActionReason: topStrategy ? undefined : 'NO_RECOVERY_STRATEGY_AVAILABLE',
      // This is a planner compatibility field, not a calibrated probability.
      // The durable audit record carries the Recovery Engine's explicitly
      // named heuristic score/estimate instead.
      heuristicRecoveryScore: topStrategy ? (topStrategy.recoveryValueScore / 100) : 0,
      confidence: risk.analysis.confidence,
    });

    const decision = evaluatePolicy(detail.incident, risk.analysis, enginePlan, [policyContext.policy], policyContext.stats, policyContext.contact, {
      executionPolicy: executionContext?.policy ?? undefined,
      existingCommandKeys: new Set((detail.execution || []).map(action => `${job.organizationId}:${action.capability}:${job.incidentId}`)),
      commandKeyForAction: actionType => `${job.organizationId}:${actionType}:${job.incidentId}`,
      currentRetryCount: (detail.execution || []).filter(action => action.capability === 'deliver_recovery_link_email').length,
      amountPaise: detail.incident.remainingAmountPaise,
      currency: latest?.event.currency ?? 'INR',
    });
    output = { plan: supervisor, risk, recovery: { plan: enginePlan, modelId: recovery.modelId, tokensUsed: recovery.tokensUsed }, policy: decision };
  } catch (error) {
    llmFailureEvents.inc({ stage: 'investigation_pipeline' });
    const attr = enrichment?.failureAttribution ?? 'customer_drop';
    const primaryFailureCategory = attr === 'fraud_block' ? 'fraud_confirmed' : attr === 'gateway_degraded' ? 'infrastructure' : 'customer_error';
    const fallbackSupervisor = {
      plan: InvestigationPlanSchema.parse({
        hypothesis: `Failure attributed to ${attr.replace(/_/g, ' ')}.`,
        primaryFailureCategory,
        objectives: ['Validate telemetry signal', 'Assess customer recovery eligibility'],
        evidencePriorities: [{ fact: 'Razorpay telemetry intake', whyItMatters: 'Establishes root cause attribution' }],
        subAgents: [
          { agent: 'risk_analyst', question: 'What is the risk level?', priority: 1, allowedContextFields: ['payment'] },
          { agent: 'recovery_planner', question: 'What is the recovery plan?', priority: 1, allowedContextFields: ['payment'] },
        ],
        constraints: ['Enforce stopping rules', 'No contact on dispute or fraud'],
        noActionCriteria: ['Dispute opened', 'Fraud confirmed'],
        estimatedAutoResolvable: primaryFailureCategory !== 'fraud_confirmed',
        requiresNoActionFallback: true,
        confidence: 0.50,
        reasoning: `Razorpay payment telemetry classification based on ${enrichment?.source ?? 'real-time telemetry'}.`,
      }),
      modelId: 'telemetry-deterministic-fallback',
      tokensUsed: 0,
    };
    const fallbackRisk = {
      analysis: RiskAnalysisSchema.parse({
        failureRootCause: attr === 'gateway_degraded' ? 'gateway_degraded' : attr === 'issuer_timeout' ? 'issuer_block' : attr === 'fraud_block' ? 'fraud_confirmed' : 'customer_error',
        evidenceStrength: 'weak',
        confidence: 0.50,
        causalNarrative: `Payment failure attributed to ${attr.replace(/_/g, ' ')} via Razorpay telemetry intake (Fallback).`,
        evidenceConfidenceRationale: 'Uncertainty during pipeline fallback — requires deterministic policy clearance.',
        alternativeHypotheses: ['Issuer timeout', 'Customer drop'],
        falsePositiveCostEstimatePaise: detail.incident.remainingAmountPaise,
        missingEvidence: ['Complete multi-agent LLM analysis'],
        chargebackEvidenceReady: attr === 'fraud_block',
        evidenceItems: [latest?.event.eventType ?? 'payment.failed'],
        recommendedActionCategory: attr === 'fraud_block' ? 'no_action' : 'deliver_recovery_link_email',
        toolResults: { incidentTimelineEventCount: detail.events.length, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null },
      }),
      modelId: 'telemetry-deterministic-fallback',
      tokensUsed: 0,
    };
    const isFraudOrDispute = primaryFailureCategory === 'fraud_confirmed' || detail.incident.status === 'DISPUTE_OPENED';
    const fallbackRecovery = {
      plan: RecoveryPlanSchema.parse({
        proposedActions: isFraudOrDispute ? [] : [
          {
            actionType: 'deliver_recovery_link_email',
            rationale: 'Deliver a Razorpay Payment Link email to recover the failed transaction.',
            preconditions: ['Merchant opted in to recovery'],
            expectedOutcome: 'Customer completes payment via recovery link',
            estimatedRecoveryPaise: detail.incident.remainingAmountPaise,
            requiresAutonomousExecution: true,
            emailCopyIntent: 'Complete your recent payment securely using our 1-click Razorpay payment link. Reply STOP to opt out.',
          },
        ],
        noActionReason: isFraudOrDispute ? 'DISPUTE_OR_FRAUD_HARD_STOP' : undefined,
        heuristicRecoveryScore: isFraudOrDispute ? 0 : 0.50,
        confidence: 0.50,
      }),
      modelId: 'telemetry-deterministic-fallback',
      tokensUsed: 0,
    };
    const safeFallbackPolicy = policyContextResult ? evaluatePolicy(detail.incident, fallbackRisk.analysis, fallbackRecovery.plan, [policyContextResult.policy], policyContextResult.stats, policyContextResult.contact, {
      executionPolicy: executionContextResult?.policy ?? undefined,
      existingCommandKeys: new Set((detail.execution || []).map(action => `${job.organizationId}:${action.capability}:${job.incidentId}`)),
      commandKeyForAction: actionType => `${job.organizationId}:${actionType}:${job.incidentId}`,
      currentRetryCount: (detail.execution || []).filter(action => action.capability === 'deliver_recovery_link_email').length,
      amountPaise: detail.incident.remainingAmountPaise,
      currency: latest?.event.currency ?? 'INR',
    }) : evaluatePolicy(detail.incident, fallbackRisk.analysis, fallbackRecovery.plan, [{ id: 'payscope-fallback-policy', enabled: false, minimumConfidence: 1, rootCauses: [] as never[], allowedActions: [] as never[], merchantOptedIn: false }], { autoResolveFraction: 0 }, { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: false, customerReferenceAvailable: false });

    output = { plan: fallbackSupervisor, risk: fallbackRisk, recovery: fallbackRecovery, policy: safeFallbackPolicy };
    logger.warn({ incidentId: job.incidentId, errorMsg: error instanceof Error ? error.message : String(error) }, 'Multi-agent LLM investigation fell back to Razorpay telemetry evaluation');
  }

  const proposals = output.policy.permittedActions.map(action => {
    const ref = paymentLinkReferenceForProposalDirect(action.actionType);
    return {
      id: randomUUID(),
      organizationId: job.organizationId,
      incidentId: job.incidentId,
      actionType: action.actionType,
      rationale: action.rationale,
      status: options.directExecution ? 'pending' as const : 'simulated' as const,
      proposedAt: new Date().toISOString(),
      simulatedAt: options.directExecution ? null : new Date().toISOString(),
      content: { rationale: action.rationale, preconditions: action.preconditions, expectedOutcome: action.expectedOutcome },
      deliveryResult: {
        simulatedDelivery: !options.directExecution,
        referenceId: ref,
        note: options.directExecution ? 'Queued for direct autonomous outbox execution.' : 'Simulation mode: Action recorded in audit ledger without provider dispatch.',
        ...(action.emailCopyIntent ? { emailCopyIntent: action.emailCopyIntent } : {}),
      },
    };
  });
  const persistence = [job.organizationId, job.incidentId, job.triggerEventId, output.plan.plan, output.risk.analysis, output.recovery.plan, output.policy, proposals, [output.plan.modelId, output.risk.modelId, output.recovery.modelId].join(','), output.plan.tokensUsed + output.risk.tokensUsed + output.recovery.tokensUsed, Date.now() - started] as const;
  await repository.persistDirectInvestigation(...persistence);

  if (output.policy.outcome === 'auto_with_proposals' && output.policy.permittedActions.length > 0) {
    try {
      const customerProfile = typeof repository.customerProfile === 'function' ? await repository.customerProfile(job.organizationId, latest?.event.customerHash ?? '') : null;
      const autonomyPolicy = typeof repository.autonomyPolicy === 'function' ? await repository.autonomyPolicy(job.organizationId) : null;
      const ranked = rankStrategies(detail.incident, enrichment, output.risk.analysis, customerProfile, autonomyPolicy);
      logger.info({ incidentId: job.incidentId, topStrategy: ranked[0]?.name ?? 'no_strategy_available', score: ranked[0]?.recoveryValueScore ?? 0 }, 'PayScope strategy ranked for recovery outbox execution');
    } catch (err) {
      logger.warn({ incidentId: job.incidentId, error: err instanceof Error ? err.message : String(err) }, 'PayScope strategy ranking evaluation warning');
    }
  }
}

function providerWithDeadline(provider: ModelProvider, deadlineAt: number): ModelProvider {
  return {
    async complete<T>(request: ModelRequest<T>): Promise<ModelResult<T>> {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) throw new Error('PayScope agent pipeline exceeded its deadline');
      return provider.complete({ ...request, timeoutMs: remaining });
    },
  };
}
