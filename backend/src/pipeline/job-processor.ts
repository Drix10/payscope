import { Incident, QueueJob, VulcanEnrichment } from '../domain/contracts';
import { MvpRepository, StoredEvent } from '../db/mvp-repository';
import { EnrichmentProvider } from '../providers/enrichment/interface';
import { correlateEvent, IncidentCandidate } from './intake';
import { replanIncidentStrategy, ReplanRepository } from '../intelligence/recovery-engine';
import { incidentLifecycleEvents, logger, timeToRecoveryMs } from '../observability';

export interface DurablePipelineRepository {
  eventById(organizationId: string, eventId: string): Promise<StoredEvent>;
  completeEnrichmentAndEnqueueCorrelation(event: StoredEvent, enrichment: VulcanEnrichment | null): Promise<void>;
  correlationCandidates(organizationId: string, incoming: StoredEvent): Promise<IncidentCandidate[]>;
  persistCorrelation(event: StoredEvent, incident: Incident | undefined, enqueueInvestigation: boolean): Promise<void>;
  reconcileDirectPaymentLinkEvent?(organizationId: string, event: StoredEvent['event']): Promise<void>;
  incidentDetail: ReplanRepository['incidentDetail'];
  customerProfile: ReplanRepository['customerProfile'];
  autonomyPolicy: ReplanRepository['autonomyPolicy'];
  policyContext: NonNullable<ReplanRepository['policyContext']>;
  executionPolicyContext: NonNullable<ReplanRepository['executionPolicyContext']>;
  createExecutionActionForSaga: ReplanRepository['createExecutionActionForSaga'];
  recordAdaptiveReplanDecision: NonNullable<ReplanRepository['recordAdaptiveReplanDecision']>;
}

export type InvestigationDispatcher = (job: QueueJob) => Promise<void>;

/** Dispatches only durable, tenant-scoped queue jobs. Provider failure degrades safely. */
export class PipelineJobProcessor {
  constructor(
    private readonly repository: DurablePipelineRepository,
    private readonly enrichmentProvider: EnrichmentProvider,
    private readonly dispatchInvestigation: InvestigationDispatcher,
  ) {}

  async process(job: QueueJob): Promise<void> {
    if (job.type === 'enrich_event') return this.enrich(job);
    if (job.type === 'correlate_event') return this.correlate(job);
    return this.dispatchInvestigation(job);
  }

  private async enrich(job: QueueJob): Promise<void> {
    if (!job.eventId) throw new Error('Enrichment job is missing eventId');
    const event = await this.repository.eventById(job.organizationId, job.eventId);
    let enrichment: VulcanEnrichment | null = null;
    try {
      enrichment = await this.enrichmentProvider.enrich(event.event);
    } catch (error) {
      // An unavailable/malformed external signal is an auditable degraded mode,
      // not a reason to discard the verified payment event.
      logger.warn({ eventId: event.id, errorMessage: error instanceof Error ? error.message : String(error) }, 'PayScope enrichment unavailable');
    }
    await this.repository.completeEnrichmentAndEnqueueCorrelation(event, enrichment);
  }

  private async correlate(job: QueueJob): Promise<void> {
    if (!job.eventId) throw new Error('Correlation job is missing eventId');
    const event = await this.repository.eventById(job.organizationId, job.eventId);
    const candidates = await this.repository.correlationCandidates(job.organizationId, event);
    const result = correlateEvent(event, candidates, job.organizationId);
    const shouldInvestigate = Boolean(result && ['risk_event_opened_incident', 'linked_risk_event', 'dispute_opened'].includes(result.reason));
    await this.repository.persistCorrelation(event, result?.incident, shouldInvestigate);
    if (result?.incident) {
      incidentLifecycleEvents.inc({ event: result.reason, status: result.incident.status });
      if (result.incident.status === 'RESOLVED') {
        const openedAt = Date.parse(result.incident.openedAt);
        const resolvedAt = result.incident.resolvedAt ? Date.parse(result.incident.resolvedAt) : NaN;
        if (Number.isFinite(openedAt) && Number.isFinite(resolvedAt) && resolvedAt >= openedAt) timeToRecoveryMs.observe(resolvedAt - openedAt);
      }
    }
    // Reconciliation is downstream of durable event/correlation persistence.
    // A repeated worker delivery is safe because receipt/compensation writes
    // are idempotent and execution transitions are monotonic.
    if (event.event.eventType === 'payment_link.paid' || event.event.eventType === 'payment_link.expired') {
      await this.repository.reconcileDirectPaymentLinkEvent?.(job.organizationId, event.event);
    }
    if (!result?.created && result?.incident && ['payment_link.expired', 'recovery.failed'].includes(event.event.eventType)) {
      await replanIncidentStrategy(this.repository, job.organizationId, result.incident.id, event.event.eventType.replace('.', '_'));
    }
  }
}

// Ensures the concrete repository continues to satisfy the pipeline contract.
void (MvpRepository satisfies new (...args: never[]) => DurablePipelineRepository);
