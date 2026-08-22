import { randomUUID } from 'crypto';
import { MvpRepository } from '../db/mvp-repository';
import { PolicyDecisionSchema, QueueJob } from '../domain/contracts';
import { ModelProvider } from '../providers/model/interface';
import { runInvestigationSupervisor } from './investigation-supervisor';
import { evaluatePolicy } from './policy-evaluator';
import { runRecoveryPlanner } from './recovery-planner';
import { runRiskAnalyst } from './risk-analyst';

/** Executes only bounded agents and persists either a validated result or a safe escalation. */
export async function runDurableInvestigation(repository: MvpRepository, provider: ModelProvider, job: QueueJob): Promise<void> {
  if (!job.incidentId) throw new Error('Investigation job is missing incidentId');
  const started = Date.now();
  // A database read failure is transient infrastructure failure: let the
  // durable queue retry it rather than recording an incorrect agent outcome.
  const detail = await repository.incidentDetail(job.organizationId, job.incidentId);
  let output: { plan: Awaited<ReturnType<typeof runInvestigationSupervisor>>; risk: Awaited<ReturnType<typeof runRiskAnalyst>>; recovery: Awaited<ReturnType<typeof runRecoveryPlanner>>; policy: ReturnType<typeof PolicyDecisionSchema.parse> };
  try {
    const latest = detail.events.at(-1);
    const enrichment = [...detail.events].reverse().find(event => event.enrichment)?.enrichment ?? null;
    const policyContext = await repository.policyContext(job.organizationId, job.incidentId, latest?.event.customerHash);
    const supervisor = await runInvestigationSupervisor(provider, { incident: detail.incident, enrichment, merchantPolicyCount: 1, autoResolveBudgetRemaining: Math.max(0, 1 - policyContext.stats.autoResolveFraction) }, job.organizationId);
    const risk = await runRiskAnalyst(provider, {
      getIncidentTimeline: async () => detail.events.map(event => event.event),
      // Aggregate rate tooling is not implemented yet. Explicit unknowns are
      // safer than fabricated zero-risk signals in a payment investigation.
      getMerchantFailureRate: async () => null,
      getNetworkFailureRate: async () => null,
      getCustomerIncidentCount: async () => null,
    }, { incident: detail.incident, enrichment, customerHash: latest?.event.customerHash, gateway: latest?.event.paymentMethod ?? 'unknown' }, job.organizationId);
    const recovery = await runRecoveryPlanner(provider, { incident: detail.incident, riskAnalysis: risk.analysis, merchantOptedInToRecovery: policyContext.policy.merchantOptedIn }, job.organizationId);
    output = { plan: supervisor, risk, recovery, policy: PolicyDecisionSchema.parse(evaluatePolicy(detail.incident, risk.analysis, recovery.plan, [policyContext.policy], policyContext.stats, policyContext.contact)) };
  } catch (error) {
    await repository.recordInvestigationUnavailable(job.organizationId, job.incidentId, job.triggerEventId, `Agent investigation unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
    return;
  }
  const proposals = output.policy.permittedActions.map(action => ({
    id: randomUUID(),
    actionType: action.actionType,
    rationale: action.rationale,
    content: {
      rationale: action.rationale,
      estimatedRecoveryPaise: action.estimatedRecoveryPaise,
      ...(action.scriptContent ? { scriptContent: action.scriptContent } : {}),
    },
  }));
  await repository.persistInvestigation(job.organizationId, job.incidentId, output.plan.plan, output.risk.analysis, output.recovery.plan, output.policy, proposals, [output.plan.modelId, output.risk.modelId, output.recovery.modelId].join(','), output.plan.tokensUsed + output.risk.tokensUsed + output.recovery.tokensUsed, Date.now() - started);
}
