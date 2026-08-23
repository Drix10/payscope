import { randomUUID } from 'crypto';
import { MvpRepository } from '../db/mvp-repository';
import { PolicyDecisionSchema, QueueJob } from '../domain/contracts';
import { ModelProvider, ModelRequest, ModelResult } from '../providers/model/interface';
import { runInvestigationSupervisor } from './investigation-supervisor';
import { evaluatePolicy } from './policy-evaluator';
import { runRecoveryPlanner } from './recovery-planner';
import { runRiskAnalyst } from './risk-analyst';
import { paymentLinkReferenceForProposal } from '../evaluation/attribution';

const AGENT_PIPELINE_DEADLINE_MS = 9_500;

/** Executes only bounded agents and persists either a validated result or a safe escalation. */
export async function runDurableInvestigation(repository: MvpRepository, provider: ModelProvider, job: QueueJob): Promise<void> {
  if (!job.incidentId) throw new Error('Investigation job is missing incidentId');
  if (!job.triggerEventId) throw new Error('Investigation job is missing triggerEventId');
  const started = Date.now();
  // A database read failure is transient infrastructure failure: let the
  // durable queue retry it rather than recording an incorrect agent outcome.
  const detail = await repository.incidentDetail(job.organizationId, job.incidentId);
  let output: { plan: Awaited<ReturnType<typeof runInvestigationSupervisor>>; risk: Awaited<ReturnType<typeof runRiskAnalyst>>; recovery: Awaited<ReturnType<typeof runRecoveryPlanner>>; policy: ReturnType<typeof PolicyDecisionSchema.parse> };
  try {
    const latest = detail.events.at(-1);
    const enrichment = [...detail.events].reverse().find(event => event.enrichment)?.enrichment ?? null;
    const [policyContext, metrics] = await Promise.all([
      repository.policyContext(job.organizationId, job.incidentId, latest?.event.customerHash),
      // Aggregate signals are optional evidence. A database failure here is
      // represented as unknown instead of a fabricated healthy rate.
      repository.riskToolMetrics(job.organizationId, latest?.event.paymentMethod ?? 'unknown', latest?.event.customerHash, 1).catch(() => null),
    ]);
    const deadlineProvider = providerWithDeadline(provider, started + AGENT_PIPELINE_DEADLINE_MS);
    const supervisor = await runInvestigationSupervisor(deadlineProvider, { incident: detail.incident, enrichment, merchantPolicyCount: 1, autoResolveBudgetRemaining: Math.max(0, 1 - policyContext.stats.autoResolveFraction) }, job.organizationId);
    const risk = await runRiskAnalyst(deadlineProvider, {
      getIncidentTimeline: async () => detail.events.map(event => event.event),
      getMerchantFailureRate: async () => metrics?.merchantFailureRate ?? null,
      getNetworkFailureRate: async () => metrics?.networkFailureRate ?? null,
      getCustomerIncidentCount: async () => metrics?.customerIncidentCount ?? null,
    }, { incident: detail.incident, enrichment, customerHash: latest?.event.customerHash, gateway: latest?.event.paymentMethod ?? 'unknown' }, job.organizationId);
    // Recovery consumes the validated risk conclusion, so it is intentionally
    // ordered after Risk Analyst. No unsafe speculative parallel model call.
    const recovery = await runRecoveryPlanner(deadlineProvider, { incident: detail.incident, riskAnalysis: risk.analysis, merchantOptedInToRecovery: policyContext.policy.merchantOptedIn }, job.organizationId);
    output = { plan: supervisor, risk, recovery, policy: PolicyDecisionSchema.parse(evaluatePolicy(detail.incident, risk.analysis, recovery.plan, [policyContext.policy], policyContext.stats, policyContext.contact)) };
  } catch (error) {
    await repository.recordInvestigationUnavailable(job.organizationId, job.incidentId, job.triggerEventId, `Agent investigation unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
    return;
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
        ...(['retry_link_whatsapp', 'retry_link_sms'].includes(action.actionType) ? { paymentLinkReferenceId: paymentLinkReferenceForProposal(id) } : {}),
        ...(action.scriptContent ? { scriptContent: action.scriptContent } : {}),
      },
    };
  });
  await repository.persistInvestigation(job.organizationId, job.incidentId, job.triggerEventId, output.plan.plan, output.risk.analysis, output.recovery.plan, output.policy, proposals, [output.plan.modelId, output.risk.modelId, output.recovery.modelId].join(','), output.plan.tokensUsed + output.risk.tokensUsed + output.recovery.tokensUsed, Date.now() - started);
  await repository.autonomouslySimulatePendingProposals(job.organizationId, job.incidentId);
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
