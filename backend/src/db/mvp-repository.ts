import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { ActionProposal, ActionProposalSchema, AuditEntry, AuditEntrySchema, Incident, IncidentSchema, InvestigationPlan, NormalizedEvent, NormalizedEventSchema, PolicyDecisionContract, QueueJobSchema, RecoveryPlan, RiskAnalysis, VulcanEnrichment, VulcanEnrichmentSchema } from '../domain/contracts';
import { CorrelationEvent, IncidentCandidate } from '../pipeline/correlation-engine';

type DemoOrganization = { id: string; customerHashSecret: string };
type IngestResult = { eventId: string; duplicate: boolean };
export type StoredEvent = CorrelationEvent & { organizationId: string };

function databaseError(operation: string, message: string): Error {
  return new Error(`PayScope durable database ${operation} failed: ${message}`);
}

/** Service-role-only persistence for the buildathon MVP pipeline. */
export class MvpRepository {
  constructor(private readonly client: SupabaseClient) {}

  async demoOrganization(organizationId: string): Promise<DemoOrganization> {
    const { data, error } = await this.client
      .from('payscope_organizations')
      .select('id, customer_hash_secret')
      .eq('id', organizationId)
      .maybeSingle();
    if (error) throw databaseError('organization lookup', error.message);
    if (!data) throw new Error('Configured PAYSCOPE_DEMO_ORGANIZATION_ID does not exist in payscope_organizations');
    const row = data as { id?: unknown; customer_hash_secret?: unknown };
    if (typeof row.id !== 'string' || typeof row.customer_hash_secret !== 'string' || row.customer_hash_secret.length < 32) throw new Error('Configured PayScope organization has an invalid customer hash secret');
    return { id: row.id, customerHashSecret: row.customer_hash_secret };
  }

  async ingestEventWithEnrichmentJob(organizationId: string, razorpayEventId: string, payloadHash: string, normalized: NormalizedEvent): Promise<IngestResult> {
    const eventId = randomUUID();
    const jobId = randomUUID();
    const createdAt = new Date().toISOString();
    const jobPayload = QueueJobSchema.parse({ jobId, organizationId, type: 'enrich_event', attemptNumber: 1, createdAt, eventId });
    const { data, error } = await this.client.rpc('payscope_ingest_event_and_enqueue', {
      p_event_id: eventId,
      p_organization_id: organizationId,
      p_razorpay_event_id: razorpayEventId,
      p_event_type: normalized.eventType,
      p_payload_hash: payloadHash,
      p_normalized: normalized,
      p_job_id: jobId,
      p_job_payload: jobPayload,
    });
    if (error) throw databaseError('event intake', error.message);
    const row = Array.isArray(data) ? data[0] : undefined;
    if (!row || typeof row.event_id !== 'string' || typeof row.duplicate !== 'boolean') throw new Error('PayScope durable database event intake returned an invalid response');
    return { eventId: row.event_id, duplicate: row.duplicate };
  }

  async eventById(organizationId: string, eventId: string): Promise<StoredEvent> {
    const { data, error } = await this.client
      .from('payscope_events')
      .select('id, organization_id, normalized, enrichment, enrichment_source')
      .eq('organization_id', organizationId)
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw databaseError('event lookup', error.message);
    if (!data) throw new Error('PayScope event was not found');
    return eventFromRow(data as Record<string, unknown>);
  }

  async completeEnrichmentAndEnqueueCorrelation(event: StoredEvent, enrichment: VulcanEnrichment | null): Promise<void> {
    const jobId = randomUUID();
    const createdAt = new Date().toISOString();
    const payload = QueueJobSchema.parse({ jobId, organizationId: event.organizationId, type: 'correlate_event', attemptNumber: 1, createdAt, eventId: event.id });
    const { error } = await this.client.rpc('payscope_complete_enrichment_and_enqueue', {
      p_event_id: event.id,
      p_organization_id: event.organizationId,
      p_enrichment: enrichment,
      p_enrichment_source: enrichment?.source ?? 'unavailable',
      p_job_id: jobId,
      p_job_payload: payload,
    });
    if (error) throw databaseError('enrichment completion', error.message);
  }

  async correlationCandidates(organizationId: string, incoming: StoredEvent): Promise<IncidentCandidate[]> {
    const includeTerminal = ['payment.dispute.created', 'payment.captured', 'order.paid'].includes(incoming.event.eventType);
    const { data, error } = await this.client.rpc('payscope_correlation_candidates', {
      p_organization_id: organizationId,
      p_payment_id: incoming.event.paymentId ?? null,
      p_order_id: incoming.event.orderId ?? null,
      p_subscription_id: incoming.event.subscriptionId ?? null,
      p_customer_hash: incoming.event.customerHash ?? null,
      p_occurred_at: incoming.event.occurredAt,
      p_include_terminal: includeTerminal,
    });
    if (error) throw databaseError('correlation candidate lookup', error.message);
    return ((data ?? []) as unknown[]).map(row => {
      const value = row as Record<string, unknown>;
      if (!Array.isArray(value.correlated_events)) throw new Error('PayScope correlation candidate response is invalid');
      return {
        incident: incidentFromRow(record(value.incident)),
        events: value.correlated_events.map(event => eventFromRow(record(event))),
      };
    });
  }

  async persistCorrelation(event: StoredEvent, incident: Incident | undefined, enqueueInvestigation: boolean): Promise<void> {
    const jobId = randomUUID();
    const createdAt = new Date().toISOString();
    const payload = incident && enqueueInvestigation
      ? QueueJobSchema.parse({ jobId, organizationId: event.organizationId, type: 'investigate_incident', attemptNumber: 1, createdAt, incidentId: incident.id, triggerEventId: event.id })
      : null;
    const { error } = await this.client.rpc('payscope_persist_correlation', {
      p_event_id: event.id,
      p_organization_id: event.organizationId,
      p_incident: incident ? incidentToRow(incident) : null,
      p_enqueue_investigation: Boolean(payload),
      p_job_id: jobId,
      p_job_payload: payload,
    });
    if (error) throw databaseError('correlation persistence', error.message);
  }

  async listIncidents(organizationId: string, limit = 100): Promise<Incident[]> {
    const { data, error } = await this.client
      .from('payscope_incidents')
      .select('*')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));
    if (error) throw databaseError('incident list', error.message);
    return (data ?? []).map(row => incidentFromRow(row as Record<string, unknown>));
  }

  async incidentDetail(organizationId: string, incidentId: string): Promise<{ incident: Incident; events: StoredEvent[]; proposals: ActionProposal[] }> {
    const { data, error } = await this.client
      .from('payscope_incidents')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', incidentId)
      .maybeSingle();
    if (error) throw databaseError('incident detail', error.message);
    if (!data) throw new Error('PayScope incident was not found');
    const incident = incidentFromRow(data as Record<string, unknown>);
    const [eventsResult, proposalsResult] = await Promise.all([
      incident.correlatedEventIds.length
        ? this.client.from('payscope_events').select('id, organization_id, normalized, enrichment, enrichment_source').eq('organization_id', organizationId).in('id', incident.correlatedEventIds)
        : Promise.resolve({ data: [], error: null }),
      this.client.from('payscope_action_proposals').select('*').eq('organization_id', organizationId).eq('incident_id', incidentId).order('proposed_at', { ascending: false }),
    ]);
    if (eventsResult.error) throw databaseError('incident events', eventsResult.error.message);
    if (proposalsResult.error) throw databaseError('incident proposals', proposalsResult.error.message);
    const events = (eventsResult.data ?? []).map(row => eventFromRow(row as Record<string, unknown>)).sort((left, right) => left.event.occurredAt.localeCompare(right.event.occurredAt));
    return { incident, events, proposals: (proposalsResult.data ?? []).map(row => proposalFromRow(row as Record<string, unknown>)) };
  }

  async auditEntries(organizationId: string, incidentId?: string): Promise<AuditEntry[]> {
    let query = this.client.from('payscope_audit_entries').select('*').eq('organization_id', organizationId).order('sequence_number', { ascending: true }).limit(200);
    if (incidentId) query = query.eq('incident_id', incidentId);
    const { data, error } = await query;
    if (error) throw databaseError('audit list', error.message);
    return (data ?? []).map(row => auditFromRow(row as Record<string, unknown>));
  }

  async recordInvestigationUnavailable(organizationId: string, incidentId: string, triggerEventId: string | undefined, reason: string): Promise<void> {
    const { error } = await this.client.rpc('payscope_record_investigation_failure', {
      p_organization_id: organizationId,
      p_incident_id: incidentId,
      p_trigger_event_id: triggerEventId ?? null,
      p_reason: reason.slice(0, 1_000),
    });
    if (error) throw databaseError('investigation failure record', error.message);
  }

  async persistInvestigation(organizationId: string, incidentId: string, plan: InvestigationPlan, risk: RiskAnalysis, recovery: RecoveryPlan, policy: PolicyDecisionContract, modelId: string, tokensUsed: number, latencyMs: number): Promise<void> {
    const { error } = await this.client.rpc('payscope_persist_investigation', {
      p_organization_id: organizationId,
      p_incident_id: incidentId,
      p_plan: plan,
      p_risk_analysis: risk,
      p_recovery_plan: recovery,
      p_policy_decision: policy,
      p_model_id: modelId,
      p_tokens_used: tokensUsed,
      p_latency_ms: latencyMs,
    });
    if (error) throw databaseError('investigation persistence', error.message);
  }
}

function eventFromRow(row: Record<string, unknown>): StoredEvent {
  if (typeof row.id !== 'string' || typeof row.organization_id !== 'string') throw new Error('PayScope event row is invalid');
  const enrichment = row.enrichment === null || row.enrichment === undefined ? null : VulcanEnrichmentSchema.parse(row.enrichment);
  return { id: row.id, organizationId: row.organization_id, event: NormalizedEventSchema.parse(row.normalized), enrichment };
}

function incidentFromRow(row: Record<string, unknown>): Incident {
  return IncidentSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    riskTier: row.risk_tier,
    status: row.status,
    totalFailedAmountPaise: numeric(row.total_failed_amount_paise),
    recoveredAmountPaise: numeric(row.recovered_amount_paise),
    remainingAmountPaise: numeric(row.remaining_amount_paise),
    correlatedEventIds: Array.isArray(row.correlated_event_ids) ? row.correlated_event_ids : [],
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
  });
}

function incidentToRow(incident: Incident): Record<string, unknown> {
  return {
    id: incident.id,
    risk_tier: incident.riskTier,
    status: incident.status,
    total_failed_amount_paise: incident.totalFailedAmountPaise,
    recovered_amount_paise: incident.recoveredAmountPaise,
    correlated_event_ids: incident.correlatedEventIds,
    opened_at: incident.openedAt,
    resolved_at: incident.resolvedAt ?? '',
    updated_at: incident.updatedAt,
  };
}

function proposalFromRow(row: Record<string, unknown>): ActionProposal {
  return ActionProposalSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    incidentId: row.incident_id,
    actionType: row.action_type,
    content: row.content,
    status: row.status,
    proposedAt: row.proposed_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    deliveryResult: row.delivery_result,
  });
}

function auditFromRow(row: Record<string, unknown>): AuditEntry {
  return AuditEntrySchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    incidentId: row.incident_id,
    sequenceNumber: Number(row.sequence_number),
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorSessionHash: row.actor_session_hash,
    decision: row.decision,
    rationale: row.rationale,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    enrichmentSnapshot: row.enrichment_snapshot,
    prevEntryHash: row.prev_entry_hash,
    entryHash: row.entry_hash,
    createdAt: row.created_at,
  });
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('PayScope database row contains an invalid amount');
  return parsed;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PayScope database row is invalid');
  return value as Record<string, unknown>;
}
