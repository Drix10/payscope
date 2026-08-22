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
    const supervisor = await runInvestigationSupervisor(provider, { incident: detail.incident, enrichment, merchantPolicyCount: 0, autoResolveBudgetRemaining: 0 }, job.organizationId);
    const risk = await runRiskAnalyst(provider, {
      getIncidentTimeline: async () => detail.events.map(event => event.event),
      // Aggregate rate tooling is not implemented yet. Explicit unknowns are
      // safer than fabricated zero-risk signals in a payment investigation.
      getMerchantFailureRate: async () => null,
      getNetworkFailureRate: async () => null,
      getCustomerIncidentCount: async () => null,
    }, { incident: detail.incident, enrichment, customerHash: latest?.event.customerHash, gateway: latest?.event.paymentMethod ?? 'unknown' }, job.organizationId);
    const recovery = await runRecoveryPlanner(provider, { incident: detail.incident, riskAnalysis: risk.analysis, merchantOptedInToRecovery: false }, job.organizationId);
    output = { plan: supervisor, risk, recovery, policy: PolicyDecisionSchema.parse(evaluatePolicy(detail.incident, risk.analysis, recovery.plan, [], { autoResolveFraction: 0, humanReviewFraction: 0.1 }, { incidentAttempts: 0, attemptsLast24Hours: 0, attemptsLast7Days: 0, merchantOptedIn: false })) };
  } catch (error) {
    await repository.recordInvestigationUnavailable(job.organizationId, job.incidentId, job.triggerEventId, `Agent investigation unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
    return;
  }
  await repository.persistInvestigation(job.organizationId, job.incidentId, output.plan.plan, output.risk.analysis, output.recovery.plan, output.policy, [output.plan.modelId, output.risk.modelId, output.recovery.modelId].join(','), output.plan.tokensUsed + output.risk.tokensUsed + output.recovery.tokensUsed, Date.now() - started);
}
