import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ActionProposal, ActionProposalSchema, ActionTypeSchema, AuditEntry, AuditEntrySchema, DashboardMetrics, DashboardMetricsSchema, DashboardQueryResponse, DashboardQueryResponseSchema, EnrichmentSource, EnrichmentSourceSchema, ExecutionActionSummary, ExecutionActionSummarySchema, ExecutionStateSchema, Incident, IncidentSchema, Investigation, InvestigationPlan, InvestigationPlanSchema, InvestigationSchema, NormalizedEvent, NormalizedEventSchema, PolicyDecisionContract, PolicyDecisionSchema, QueueJobSchema, RecoveryPlan, RecoveryPlanSchema, RiskAnalysis, RiskAnalysisSchema, RiskTier, VulcanEnrichment, VulcanEnrichmentSchema } from '../domain/contracts';
import { CorrelationEvent, IncidentCandidate } from '../pipeline/correlation-engine';
import { CustomerContactStats, ExecutionPolicy, MerchantPolicy, OrgDailyStats } from '../pipeline/policy-evaluator';
import { canCorrelateWithTerminalIncident } from '../pipeline/webhook-event-policy';
import { Reconciler } from '../providers/execution/reconciliation';
type DemoOrganization = { id: string; customerHashSecret: string };
type IngestResult = { eventId: string; duplicate: boolean };
export type StoredEvent = CorrelationEvent & { organizationId: string; enrichmentSource: EnrichmentSource | null };
export type ProposalDraft = { id: string; actionType: ActionProposal['actionType']; content: Record<string, unknown>; rationale: string };
export type PolicyContext = { policy: MerchantPolicy; stats: OrgDailyStats; contact: CustomerContactStats };
export type ExecutionPolicyContext = { policy: ExecutionPolicy; existingCommandKeys: Set<string> };
export type RiskToolMetrics = { merchantFailureRate: number | null; networkFailureRate: number | null; customerIncidentCount: number | null };
export type AuditIntegrity = { status: 'intact' | 'broken'; entryCount: number; checkedAt: string };
export type IncidentMemory = { type: 'event_summary' | 'investigation' | 'execution' | 'customer_message' | 'customer_reply'; content: Record<string, unknown>; importance: number; createdAt: string };

const PolicyContextSchema = z.object({
  policy: z.object({
    id: z.string().uuid(), enabled: z.boolean(), minimumConfidence: z.number().min(0).max(1),
    rootCauses: z.array(z.enum(['gateway_degraded', 'issuer_block', 'fraud_confirmed', 'fraud_suspected', 'customer_error', 'subscription_lapse', 'unknown'])).min(1).max(7),
    allowedActions: z.array(ActionTypeSchema).min(1).max(8),
    merchantOptedIn: z.boolean(),
  }).strict(),
  stats: z.object({ autoResolveFraction: z.number().min(0).max(1) }).strict(),
  contact: z.object({ incidentAttempts: z.number().int().nonnegative(), attemptsLast24Hours: z.number().int().nonnegative(), attemptsLast7Days: z.number().int().nonnegative(), merchantOptedIn: z.boolean(), customerReferenceAvailable: z.boolean() }).strict(),
}).strict();

const RiskToolMetricsSchema = z.object({
  merchantFailureRate: z.number().min(0).max(1).nullable(),
  networkFailureRate: z.number().min(0).max(1).nullable(),
  customerIncidentCount: z.number().int().nonnegative().nullable(),
}).strict();

const AuditIntegritySchema = z.object({
  status: z.enum(['intact', 'broken']),
  entryCount: z.number().int().nonnegative(),
  checkedAt: z.string().datetime({ offset: true }),
}).strict();

function databaseError(operation: string, message: string): Error {
  return new Error(`PayScope durable database ${operation} failed: ${message}`);
}

/** Service-role-only persistence for the buildathon MVP pipeline. */
export class MvpRepository {
  constructor(private readonly client: SupabaseClient) { }

  async demoOrganization(organizationId: string): Promise<DemoOrganization> {
    const { data, error } = await this.client
      .from('payscope_organizations')
      .select('id, customer_hash_secret')
      .eq('id', organizationId)
      .maybeSingle();
    if (error) throw databaseError('organization lookup', error.message);
    if (!data) throw new Error('Configured PAYSCOPE_ORGANIZATION_ID does not exist in payscope_organizations');
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

  /** Reconciles a verified Payment Link completion to the immutable email action. */
  async reconcileDirectPaymentLinkEvent(organizationId: string, event: NormalizedEvent): Promise<void> {
    if (event.eventType !== 'payment_link.paid') return;
    const referenceId = typeof event.providerData.payment_link_reference_id === 'string' ? event.providerData.payment_link_reference_id : undefined;
    if (!referenceId || !/^ps_[a-f0-9]{32}$/.test(referenceId)) return;
    const reconciler = new Reconciler(this.client);
    await reconciler.reconcilePaymentLinkPaid(organizationId, referenceId, event.eventId, event.paymentId ?? null);
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
    const includeTerminal = canCorrelateWithTerminalIncident(incoming.event.eventType);
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

  /** A real query, used to keep the autonomous health response honest. */
  async healthCheck(organizationId: string): Promise<void> {
    const { data, error } = await this.client
      .from('payscope_organizations')
      .select('id')
      .eq('id', organizationId)
      .maybeSingle();
    if (error) throw databaseError('health check', error.message);
    if (!data) throw new Error('Configured PayScope organization is not available to the durable database');
  }

  async policyContext(organizationId: string, incidentId: string, customerHash: string | undefined): Promise<PolicyContext> {
    const { data, error } = await this.client.rpc('payscope_policy_context', {
      p_organization_id: organizationId,
      p_incident_id: incidentId,
      p_customer_hash: customerHash ?? null,
    });
    if (error) throw databaseError('policy context', error.message);
    const parsed = PolicyContextSchema.parse(data);
    const merchantOptedIn = parsed.policy.merchantOptedIn || parsed.contact.merchantOptedIn;
    return {
      ...parsed,
      policy: {
        ...parsed.policy,
        merchantOptedIn,
        rootCauses: merchantOptedIn
          ? Array.from(new Set([...parsed.policy.rootCauses, 'gateway_degraded' as const, 'issuer_block' as const, 'customer_error' as const, 'unknown' as const]))
          : parsed.policy.rootCauses,
        allowedActions: merchantOptedIn
          ? Array.from(new Set([...parsed.policy.allowedActions, 'deliver_recovery_link_email' as const, 'resolve_infrastructure' as const, 'record_risk_signal' as const]))
          : parsed.policy.allowedActions,
      },
      contact: {
        ...parsed.contact,
        merchantOptedIn,
        customerReferenceAvailable: parsed.contact.customerReferenceAvailable || Boolean(customerHash),
      },
    };
  }

  async executionPolicyContext(organizationId: string): Promise<ExecutionPolicyContext> {
    const [{ data: policy, error: policyError }, { data: actions, error: actionError }] = await Promise.all([
      this.client.from('payscope_organization_execution_policy').select('*').eq('organization_id', organizationId).maybeSingle(),
      this.client.from('payscope_execution_actions').select('command_key, incident_id, capability').eq('organization_id', organizationId),
    ]);
    if (policyError) throw databaseError('execution policy', policyError.message);
    if (actionError) throw databaseError('execution command keys', actionError.message);
    const row = policy && typeof policy === 'object' && !Array.isArray(policy) ? (policy as Record<string, unknown>) : null;
    const hasRow = row !== null && Array.isArray(row.enabled_capabilities);
    const parsedPolicy: ExecutionPolicy = hasRow && row ? {
      enabledCapabilities: row.enabled_capabilities as ExecutionPolicy['enabledCapabilities'],
      maxAmountPaise: typeof row.max_amount_paise === 'number' ? row.max_amount_paise : 5000000,
      allowedCurrencies: Array.isArray(row.allowed_currencies) ? row.allowed_currencies as string[] : ['INR'],
      emailConsentRequired: typeof row.email_consent_required === 'boolean' ? row.email_consent_required : false,
      providerHealthy: typeof row.provider_healthy === 'boolean' ? row.provider_healthy : true,
      emergencyPaused: typeof row.emergency_paused === 'boolean' ? row.emergency_paused : false,
      retryBudget: typeof row.retry_budget === 'number' ? row.retry_budget : 3,
      quietHoursStart: typeof row.quiet_hours_start === 'number' ? row.quiet_hours_start : undefined,
      quietHoursEnd: typeof row.quiet_hours_end === 'number' ? row.quiet_hours_end : undefined,
    } : {
      enabledCapabilities: ['deliver_recovery_link_email', 'record_risk_signal', 'submit_dispute_evidence', 'capture_authorized_payment', 'refund_payment', 'resolve_infrastructure'],
      maxAmountPaise: 5000000,
      allowedCurrencies: ['INR'],
      emailConsentRequired: false,
      providerHealthy: true,
      emergencyPaused: false,
      retryBudget: 3,
    };

    return {
      policy: parsedPolicy,
      existingCommandKeys: new Set((actions ?? []).flatMap(action => {
        const value = action as Record<string, unknown>;
        const keys = typeof value.command_key === 'string' ? [value.command_key] : [];
        if (typeof value.incident_id === 'string' && typeof value.capability === 'string') keys.push(`${organizationId}:${value.capability}:${value.incident_id}`);
        return keys;
      })),
    };
  }

  /** Read-only, server-scoped facts supplied to the bounded Risk Analyst. */
  async riskToolMetrics(organizationId: string, gateway: string, customerHash: string | undefined, windowHours: 1 | 4 | 24): Promise<RiskToolMetrics> {
    const { data, error } = await this.client.rpc('payscope_risk_tool_metrics', {
      p_organization_id: organizationId,
      p_gateway: gateway.slice(0, 80),
      p_customer_hash: customerHash ?? null,
      p_window_hours: windowHours,
    });
    if (error) throw databaseError('risk-tool metrics', error.message);
    return RiskToolMetricsSchema.parse(data);
  }

  async listIncidents(organizationId: string, limit = 100, status?: Incident['status']): Promise<Incident[]> {
    let query = this.client
      .from('payscope_incidents')
      .select('*')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw databaseError('incident list', error.message);
    return (data ?? []).map(row => incidentFromRow(row as Record<string, unknown>));
  }

  async incidentDetail(organizationId: string, incidentId: string): Promise<{ incident: Incident; events: StoredEvent[]; proposals: ActionProposal[]; investigation: Investigation | null; execution: ExecutionActionSummary[] }> {
    const { data, error } = await this.client
      .from('payscope_incidents')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', incidentId)
      .maybeSingle();
    if (error) throw databaseError('incident detail', error.message);
    if (!data) throw new Error('PayScope incident was not found');
    const incident = incidentFromRow(data as Record<string, unknown>);
    const [eventsResult, proposalsResult, investigationResult, executionResult] = await Promise.all([
      incident.correlatedEventIds.length
        ? this.client.from('payscope_events').select('id, organization_id, normalized, enrichment, enrichment_source').eq('organization_id', organizationId).in('id', incident.correlatedEventIds)
        : Promise.resolve({ data: [], error: null }),
      this.client.from('payscope_action_proposals').select('*').eq('organization_id', organizationId).eq('incident_id', incidentId).order('proposed_at', { ascending: false }),
      this.client.from('payscope_investigations').select('*').eq('organization_id', organizationId).eq('incident_id', incidentId).order('started_at', { ascending: false }).limit(1).maybeSingle(),
      this.client.from('payscope_execution_actions').select('id, capability, state, amount_paise, currency, terminal_reason, provider_object_id, retry_count, policy_version, capability_version, created_at, dispatched_at, completed_at').eq('organization_id', organizationId).eq('incident_id', incidentId).order('created_at', { ascending: false }).limit(50),
    ]);
    if (eventsResult.error) throw databaseError('incident events', eventsResult.error.message);
    if (proposalsResult.error) throw databaseError('incident proposals', proposalsResult.error.message);
    if (investigationResult.error) throw databaseError('incident investigation', investigationResult.error.message);
    if (executionResult.error) throw databaseError('incident execution', executionResult.error.message);
    const events = (eventsResult.data ?? []).map(row => eventFromRow(row as Record<string, unknown>)).sort((left, right) => left.event.occurredAt.localeCompare(right.event.occurredAt));
    return { incident, events, proposals: (proposalsResult.data ?? []).map(row => proposalFromRow(row as Record<string, unknown>)), investigation: investigationResult.data ? investigationFromRow(investigationResult.data as Record<string, unknown>) : null, execution: (executionResult.data ?? []).map(row => executionSummaryFromRow(row as Record<string, unknown>)) };
  }

  async auditEntries(organizationId: string, incidentId?: string): Promise<AuditEntry[]> {
    let query = this.client.from('payscope_audit_entries').select('*').eq('organization_id', organizationId).order('sequence_number', { ascending: true }).limit(200);
    if (incidentId) query = query.eq('incident_id', incidentId);
    const { data, error } = await query;
    if (error) throw databaseError('audit list', error.message);
    return (data ?? []).map(row => auditFromRow(row as Record<string, unknown>));
  }

  async auditIntegrity(organizationId: string): Promise<AuditIntegrity> {
    const { data, error } = await this.client.rpc('payscope_audit_chain_summary', { p_organization_id: organizationId });
    if (error) throw databaseError('audit integrity', error.message);
    return AuditIntegritySchema.parse(data);
  }

  /** Bounded redacted incident memory for agent continuity; never returns recipients or raw provider payloads. */
  async incidentMemory(organizationId: string, incidentId: string, limit = 12): Promise<IncidentMemory[]> {
    const { data, error } = await this.client.from('payscope_incident_memory').select('memory_type, content, importance, created_at, expires_at').eq('organization_id', organizationId).eq('incident_id', incidentId).order('importance', { ascending: false }).order('created_at', { ascending: false }).limit(48);
    if (error) throw databaseError('incident memory lookup', error.message);
    const now = Date.now();
    return (data ?? []).filter(row => {
      const expiresAt = (row as Record<string, unknown>).expires_at;
      return expiresAt === null || expiresAt === undefined || (typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > now);
    }).slice(0, Math.min(Math.max(limit, 1), 12)).flatMap(row => {
      const value = record(row as Record<string, unknown>);
      if (!['event_summary', 'investigation', 'execution', 'customer_message', 'customer_reply'].includes(String(value.memory_type)) || !record(value.content) || Buffer.byteLength(JSON.stringify(value.content), 'utf8') > 1_200 || !Number.isInteger(Number(value.importance)) || typeof value.created_at !== 'string') return [];
      return [{ type: value.memory_type as IncidentMemory['type'], content: record(value.content), importance: Number(value.importance), createdAt: value.created_at }];
    });
  }

  /** Aggregate only presentation-safe tenant metrics; no PII or raw events. */
  async dashboardMetrics(organizationId: string): Promise<DashboardMetrics> {
    const { data, error } = await this.client.rpc('payscope_dashboard_metrics', { p_organization_id: organizationId });
    if (error) throw databaseError('dashboard metrics', error.message);
    return DashboardMetricsSchema.parse(data);
  }

  /**
   * A bounded deterministic interpreter for the MVP's read-only dashboard.
   * User text never reaches SQL, a model prompt, or an organization selector.
   */
  async dashboardQuery(organizationId: string, query: string, limit: number): Promise<DashboardQueryResponse> {
    const normalizedQuery = query.trim();
    const parsed = parseDashboardFilters(normalizedQuery);
    const incidents = await this.listIncidents(organizationId, 100);
    // Execution-state / provider / unresolved-receipt filters require a bounded
    // join from execution actions back to their incidents (read-only, deterministic).
    let executionIncidentIds: Set<string> | null = null;
    if (parsed.executionStates.length || parsed.providers.length || parsed.unresolvedReceipts) {
      const candidateIncidentIds = incidents.map(incident => incident.id);
      let actionQuery = this.client.from('payscope_execution_actions').select('incident_id, state, capability').eq('organization_id', organizationId).in('incident_id', candidateIncidentIds);
      if (parsed.providers.length) actionQuery = actionQuery.in('capability', parsed.providers);
      const requestedStates = new Set<string>(parsed.executionStates);
      if (parsed.unresolvedReceipts) {
        const unresolved = ['accepted', 'dispatching'];
        if (requestedStates.size) {
          const intersected = unresolved.filter(s => requestedStates.has(s));
          actionQuery = actionQuery.in('state', intersected.length ? intersected : ['__none__']);
        } else {
          actionQuery = actionQuery.in('state', unresolved);
        }
      } else if (parsed.executionStates.length) {
        actionQuery = actionQuery.in('state', parsed.executionStates);
      }
      const { data: actionRows, error: actionError } = await actionQuery.limit(200);
      if (actionError) throw databaseError('dashboard execution filter', actionError.message);
      executionIncidentIds = new Set((actionRows ?? [])
        .filter(row => {
          const value = record(row as Record<string, unknown>);
          const state = String(value.state ?? '');
          return typeof value.incident_id === 'string';
        })
        .map(row => (row as Record<string, unknown>).incident_id as string));
    }
    const matching = incidents.filter(incident =>
      (!parsed.statuses.length || parsed.statuses.includes(incident.status)) &&
      (!parsed.riskTiers.length || parsed.riskTiers.includes(incident.riskTier)) &&
      (!executionIncidentIds || executionIncidentIds.has(incident.id)),
    );
    const displayed = matching.slice(0, limit).map(incident => ({
      id: incident.id,
      status: incident.status,
      riskTier: incident.riskTier,
      remainingAmountPaise: incident.remainingAmountPaise,
      updatedAt: incident.updatedAt,
    }));
    const matchedRemainingAmountPaise = matching.reduce((sum, incident) => {
      const next = sum + incident.remainingAmountPaise;
      if (!Number.isSafeInteger(next)) throw new Error('PayScope dashboard metric exceeds the safe integer range');
      return next;
    }, 0);
    return DashboardQueryResponseSchema.parse({
      query: normalizedQuery,
      interpretation: describeDashboardFilters(parsed),
      matchedIncidentCount: matching.length,
      matchedRemainingAmountPaise,
      incidents: displayed,
      limitations: [
        'Read-only tenant incident summary; this query cannot trigger an action or contact a customer.',
        'Only lifecycle state, risk tier, execution state, provider, and unresolved-receipt terms are interpreted; other wording is not executed or translated to SQL.',
        'Incident summaries exclude customer identifiers, payment/order IDs, raw provider data, and recovery claims without causal attribution.',
        'The query considers at most the 100 most recently updated incidents, then returns up to the requested display limit.',
      ],
    });
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

  /** Direct-execution persistence — legacy `persistInvestigation` (simulation) has been removed. */
  async persistDirectInvestigation(organizationId: string, incidentId: string, triggerEventId: string, plan: InvestigationPlan, risk: RiskAnalysis, recovery: RecoveryPlan, policy: PolicyDecisionContract, proposals: ProposalDraft[], modelId: string, tokensUsed: number, latencyMs: number): Promise<void> {
    const { error } = await this.client.rpc('payscope_persist_direct_investigation', {
      p_organization_id: organizationId,
      p_incident_id: incidentId,
      p_trigger_event_id: triggerEventId,
      p_plan: plan,
      p_risk_analysis: risk,
      p_recovery_plan: recovery,
      p_policy_decision: policy,
      p_proposals: proposals.map(proposal => ({ id: proposal.id, action_type: proposal.actionType, content: proposal.content, rationale: proposal.rationale })),
      p_model_id: modelId,
      p_tokens_used: tokensUsed,
      p_latency_ms: latencyMs,
    });
    if (error) throw databaseError('direct investigation persistence', error.message);
  }

}

function eventFromRow(row: Record<string, unknown>): StoredEvent {
  if (typeof row.id !== 'string' || typeof row.organization_id !== 'string') throw new Error('PayScope event row is invalid');
  const enrichment = row.enrichment === null || row.enrichment === undefined ? null : VulcanEnrichmentSchema.parse(row.enrichment);
  return { id: row.id, organizationId: row.organization_id, event: NormalizedEventSchema.parse(row.normalized), enrichment, enrichmentSource: row.enrichment_source === null || row.enrichment_source === undefined ? null : EnrichmentSourceSchema.parse(row.enrichment_source) };
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
    resolved_at: incident.resolvedAt ?? null,
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
    simulatedAt: row.simulated_at ?? simulatedAt(row.delivery_result),
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
    actorType: row.actor_type === 'system' ? 'system' : 'legacy',
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

function executionSummaryFromRow(row: Record<string, unknown>): ExecutionActionSummary {
  return ExecutionActionSummarySchema.parse({
    id: row.id,
    capability: row.capability,
    state: ExecutionStateSchema.parse(row.state),
    amountPaise: row.amount_paise === null || row.amount_paise === undefined ? null : numeric(row.amount_paise),
    currency: typeof row.currency === 'string' ? row.currency : null,
    terminalReason: typeof row.terminal_reason === 'string' ? row.terminal_reason : null,
    providerObjectId: typeof row.provider_object_id === 'string' ? row.provider_object_id : null,
    retryCount: Number.isSafeInteger(Number(row.retry_count)) ? Number(row.retry_count) : 0,
    policyVersion: row.policy_version,
    capabilityVersion: row.capability_version,
    createdAt: row.created_at,
    dispatchedAt: typeof row.dispatched_at === 'string' ? row.dispatched_at : null,
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
  });
}

function investigationFromRow(row: Record<string, unknown>): Investigation {
  const plan = row.plan === null || row.plan === undefined ? null : legacyPlan(record(row.plan));
  const risk = row.risk_analysis === null || row.risk_analysis === undefined
    ? null
    : legacyRisk(record(row.risk_analysis));
  const recovery = row.recovery_plan === null || row.recovery_plan === undefined ? null : legacyRecovery(record(row.recovery_plan));
  return InvestigationSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    incidentId: row.incident_id,
    status: row.status,
    plan,
    riskAnalysis: risk,
    recoveryPlan: recovery,
    policyDecision: row.policy_decision === null || row.policy_decision === undefined ? null : legacyPolicy(record(row.policy_decision)),
    modelId: row.model_id ?? null,
    tokensUsed: row.tokens_used === null || row.tokens_used === undefined ? null : numeric(row.tokens_used),
    latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : numeric(row.latency_ms),
    startedAt: row.started_at,
    completedAt: row.completed_at ?? null,
  });
}

function legacyPlan(value: Record<string, unknown>): InvestigationPlan {
  return InvestigationPlanSchema.parse({
    ...value,
    objectives: value.objectives ?? ['Classify the persisted incident evidence.'],
    evidencePriorities: value.evidencePriorities ?? [{ fact: 'Razorpay payment investigation record', whyItMatters: 'The original plan did not retain detailed evidence priorities for this payment failure.' }],
    constraints: value.constraints ?? ['No PII, customer outreach, or financial execution.'],
    noActionCriteria: value.noActionCriteria ?? ['Insufficient or conflicting evidence requires autonomous no action.'],
  });
}

function legacyRisk(value: Record<string, unknown>): RiskAnalysis {
  return RiskAnalysisSchema.parse({
    ...value,
    causalNarrative: value.causalNarrative ?? 'Razorpay payment investigation did not retain a causal narrative for this transaction.',
    evidenceConfidenceRationale: value.evidenceConfidenceRationale ?? 'Razorpay payment investigation did not retain confidence rationale for this payment evidence.',
    alternativeHypotheses: value.alternativeHypotheses ?? [],
    // Historical investigations predate the explicit server-tool trace.
    toolResults: value.toolResults ?? { incidentTimelineEventCount: 0, merchantFailureRate: null, networkFailureRate: null, customerIncidentCount: null },
  });
}

function legacyRecovery(value: Record<string, unknown>): RecoveryPlan {
  const actions = Array.isArray(value.proposedActions)
    ? value.proposedActions.map(action => {
      const proposal = record(action);
      return {
        ...proposal,
        preconditions: proposal.preconditions ?? ['Validated deterministic policy permission.'],
        expectedOutcome: proposal.expectedOutcome ?? 'A bounded autonomous simulation record is stored.',
      };
    })
    : value.proposedActions;
  return RecoveryPlanSchema.parse({ ...value, proposedActions: actions });
}

function legacyPolicy(value: Record<string, unknown>): PolicyDecisionContract {
  const { escalationReason, ...withoutLegacyReason } = value;
  const activeGates = Array.isArray(value.gates)
    ? value.gates
      .filter(gate => !(gate && typeof gate === 'object' && !Array.isArray(gate) && (gate as Record<string, unknown>).name === 'human_review_floor'))
      .slice(0, 6)
    : value.gates;
  return PolicyDecisionSchema.parse({
    ...withoutLegacyReason,
    gates: activeGates,
    outcome: value.outcome === 'escalate' ? 'auto_no_action' : value.outcome,
    noActionReason: value.noActionReason ?? (typeof escalationReason === 'string' ? escalationReason : null),
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

function parseDashboardFilters(query: string): { statuses: Incident['status'][]; riskTiers: RiskTier[]; executionStates: string[]; providers: string[]; unresolvedReceipts: boolean } {
  const text = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/[_-]/g, ' ');
  const statuses = ([
    ['open', 'OPEN'], ['monitoring', 'MONITORING'], ['dispute opened', 'DISPUTE_OPENED'],
    ['resolved', 'RESOLVED'], ['dismissed', 'DISMISSED'],
  ] as const).filter(([term]) => includesTerm(text, term)).map(([, value]) => value);
  const riskTiers = ([['critical', 'CRITICAL'], ['high', 'HIGH'], ['medium', 'MEDIUM'], ['monitor', 'MONITOR']] as const)
    .filter(([term]) => includesTerm(text, term)).map(([, value]) => value);
  const executionStates = ([
    ['queued', 'queued'], ['dispatching', 'dispatching'], ['accepted', 'accepted'],
    ['unreconciled', 'unreconciled'], ['confirmed', 'confirmed'], ['retry scheduled', 'retry_scheduled'],
    ['compensating', 'compensating'], ['failed', 'failed'], ['cancelled', 'cancelled'],
  ] as const).filter(([term]) => includesTerm(text, term)).map(([, value]) => value);
  const providers = ([
    ['recovery email', 'deliver_recovery_link_email'], ['capture', 'capture_authorized_payment'],
    ['refund', 'refund_payment'], ['dispute evidence', 'submit_dispute_evidence'],
    ['risk signal', 'record_risk_signal'], ['infrastructure', 'resolve_infrastructure'],
  ] as const).filter(([term]) => includesTerm(text, term)).map(([, value]) => value);
  const unresolvedReceipts = includesTerm(text, 'pending receipt') || includesTerm(text, 'awaiting receipt') || includesTerm(text, 'unresolved receipt');
  return { statuses, riskTiers, executionStates, providers, unresolvedReceipts };
}

function simulatedAt(value: unknown): string | null {
  const result = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  return typeof result?.simulatedAt === 'string' ? result.simulatedAt : null;
}

function includesTerm(text: string, term: string): boolean {
  return new RegExp(`(^|\\s)${term.replace(/ /g, '\\s+')}(?=\\s|$)`, 'i').test(text);
}

function describeDashboardFilters(parsed: { statuses: Incident['status'][]; riskTiers: RiskTier[]; executionStates: string[]; providers: string[]; unresolvedReceipts: boolean }): string {
  const parts = [
    parsed.statuses.length ? `lifecycle: ${parsed.statuses.map(value => value.replace(/_/g, ' ').toLowerCase()).join(', ')}` : 'all lifecycle states',
    parsed.riskTiers.length ? `risk tier: ${parsed.riskTiers.map(value => value.toLowerCase()).join(', ')}` : 'all risk tiers',
    parsed.executionStates.length ? `execution state: ${parsed.executionStates.map(value => value.replace(/_/g, ' ')).join(', ')}` : '',
    parsed.providers.length ? `provider: ${parsed.providers.map(value => value.replace(/_/g, ' ')).join(', ')}` : '',
    parsed.unresolvedReceipts ? 'unresolved receipts' : '',
  ].filter(Boolean);
  return `Showing recent tenant-scoped incidents for ${parts.join(' · ')}.`;
}

function numberInRange(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error('PayScope evaluation report contains an invalid metric');
  return parsed;
}
