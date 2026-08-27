import { createHash, randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ActionProposal, ActionProposalSchema, ActionType, ActionTypeSchema, AuditEntry, AuditEntrySchema, AutonomyPolicy, DashboardMetrics, DashboardMetricsSchema, DashboardQueryResponse, DashboardQueryResponseSchema, EnrichmentSource, EnrichmentSourceSchema, ExecutionActionSummary, ExecutionActionSummarySchema, ExecutionStateSchema, Incident, IncidentSchema, IncidentStatus, Investigation, InvestigationPlan, InvestigationPlanSchema, InvestigationSchema, NormalizedEvent, NormalizedEventSchema, PolicyDecisionContract, PolicyDecisionSchema, QueueJobSchema, RecoveryOutcome, RecoveryOutcomeSchema, RecoveryOutcomeStats, RecoveryPlan, RecoveryPlanSchema, RiskAnalysis, RiskAnalysisSchema, RiskTier, TelemetryEnrichment, TelemetryEnrichmentSchema } from '../domain/contracts';
import { CustomerContactStats, ExecutionPolicy, MerchantPolicy, OrgDailyStats } from '../pipeline/policy-evaluator';
import { canCorrelateWithTerminalIncident, CorrelationEvent, IncidentCandidate } from '../pipeline/intake';
import { Reconciler } from '../providers/execution/reconciliation';
import { VerifiedCallback } from '../providers/execution/callback-verifier';
import { CustomerProfile } from '../intelligence/recovery-engine';
import { logger } from '../observability';

export type RevenueIntelligence = {
  atRiskPaise: number;
  recoverablePaise: number;
  recoveredThisWeekPaise: number;
  protectedPaise: number;
  recoveryRate: number;
  merchantInterventionCount: number;
  telemetrySignalCoverage: number;
  activeRescues: Array<{
    incidentId: string;
    amountPaise: number;
    strategyName: string;
    strategyDisplayName: string;
    telemetryAttribution: string;
    telemetryDataSource: 'razorpay_fields_heuristic';
    sagaStep: string; // deprecated: use step
    step: string;
    elapsedMs: number;
  }>;
  autonomous: {
    investigated: number;
    sagasCreated: number; // deprecated: use investigationsCreated
    investigationsCreated: number;
    actionsExecuted: number;
    paymentsRecovered: number;
  };
};
type DemoOrganization = { id: string; customerHashSecret: string };
type IngestResult = { eventId: string; duplicate: boolean };
export type StoredEvent = CorrelationEvent & { organizationId: string; enrichmentSource: EnrichmentSource | null };
export type WebhookIntakeResult = { eventId: string; duplicate: boolean; incidentId: string | null; createdNewIncident: boolean };
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

  /**
   * The webhook boundary only persists a verified event and its first durable
   * job. Correlation (and therefore adaptive replanning) happens later in the
   * leased job pipeline; claiming an incident here would race that transaction.
   */
  async recordWebhookIntake(organizationId: string, rawBody: Buffer, normalized: NormalizedEvent): Promise<WebhookIntakeResult> {
    const result = await this.ingestEventWithEnrichmentJob(
      organizationId,
      normalized.eventId,
      createHash('sha256').update(rawBody).digest('hex'),
      normalized,
    );
    return { eventId: result.eventId, duplicate: result.duplicate, incidentId: null, createdNewIncident: false };
  }

  async recordVerifiedCallback(organizationId: string, callback: VerifiedCallback, rawBodyEncrypted: Record<string, unknown>, source: string): Promise<void> {
    let actionMatch = callback.actionMatch;
    const referenceId = typeof callback.normalized.referenceId === 'string' ? callback.normalized.referenceId : undefined;
    if (referenceId && /^ps_[a-f0-9]{32}$/i.test(referenceId)) {
      const { data, error } = await this.client
        .from('payscope_execution_actions')
        .select('id, incident_id, capability, state')
        .eq('organization_id', organizationId)
        .eq('capability', 'deliver_recovery_link_email')
        .eq('command_payload->>referenceId', referenceId)
        .limit(1)
        .maybeSingle();
      if (error) throw databaseError('callback action match lookup', error.message);
      const row = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
      if (row && typeof row.id === 'string') {
        actionMatch = {
          actionId: row.id,
          incidentId: typeof row.incident_id === 'string' ? row.incident_id : null,
          capability: row.capability,
          state: row.state,
          referenceId,
        };
      }
    }
    const reconciler = new Reconciler(this.client);
    await reconciler.verifyAndStoreCallback({ ...callback, actionMatch, organizationId, rawBodyEncrypted, source, provider: 'razorpay' });
  }

  /** Reconciles a verified Payment Link completion to the immutable email action. Returns the owning incidentId when a matching action exists. */
  async reconcileDirectPaymentLinkEvent(organizationId: string, event: NormalizedEvent): Promise<{ incidentId: string | null }> {
    if (event.eventType !== 'payment_link.paid' && event.eventType !== 'payment_link.expired') return { incidentId: null };
    const referenceId = typeof event.providerData.payment_link_reference_id === 'string' ? event.providerData.payment_link_reference_id : undefined;
    if (!referenceId || !/^ps_[a-f0-9]{32}$/.test(referenceId)) return { incidentId: null };
    const reconciler = new Reconciler(this.client);
    if (event.eventType === 'payment_link.paid') return { incidentId: await reconciler.reconcilePaymentLinkPaid(organizationId, referenceId, event.eventId, event.paymentId ?? null, event.amountPaise ?? null) };
    return { incidentId: await reconciler.reconcilePaymentLinkExpired(organizationId, referenceId, event.eventId) };
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

  async completeEnrichmentAndEnqueueCorrelation(event: StoredEvent, enrichment: TelemetryEnrichment | null): Promise<void> {
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
      stats: { autoResolveFraction: 0.0 },
      policy: {
        ...parsed.policy,
        merchantOptedIn,
        rootCauses: merchantOptedIn
          ? Array.from(new Set([...parsed.policy.rootCauses, 'gateway_degraded' as const, 'issuer_block' as const, 'customer_error' as const, 'unknown' as const]))
          : parsed.policy.rootCauses,
        allowedActions: merchantOptedIn
          ? Array.from(new Set([...parsed.policy.allowedActions, 'deliver_recovery_link_email' as const]))
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
      timezone: typeof row.merchant_timezone === 'string' ? row.merchant_timezone : 'Asia/Kolkata',
    } : {
      enabledCapabilities: ['deliver_recovery_link_email'],
      maxAmountPaise: 5000000,
      allowedCurrencies: ['INR'],
      emailConsentRequired: false,
      providerHealthy: true,
      emergencyPaused: false,
      retryBudget: 3,
      timezone: 'Asia/Kolkata',
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
    if (error) {
      if (error.message.includes('incident was not found')) {
        // Attempt to upsert the incident row if a race condition delayed its insertion
        const event = await this.eventById(organizationId, triggerEventId).catch(() => null);
        if (event) {
          try {
            await this.client.from('payscope_incidents').upsert({
              id: incidentId,
              organization_id: organizationId,
              status: 'OPEN',
              risk_tier: 'EVIDENCE_TIER_STANDARD',
              total_failed_amount_paise: event.event.amountPaise,
              remaining_amount_paise: event.event.amountPaise,
              correlated_event_ids: [triggerEventId],
              opened_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          } catch {
            // Ignore upsert race condition error
          }
          const retry = await this.client.rpc('payscope_persist_direct_investigation', {
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
          if (!retry.error) return;
        }
      }
      throw databaseError('direct investigation persistence', error.message);
    }
  }

  async autonomyPolicy(organizationId: string): Promise<AutonomyPolicy> {
    const [{ data: merchant, error: merchantError }, { data: execution, error: executionError }] = await Promise.all([
      this.client.from('payscope_merchant_policies').select('merchant_opted_in_to_recovery, allowed_actions').eq('organization_id', organizationId).maybeSingle(),
      this.client.from('payscope_organization_execution_policy').select('max_amount_paise, enabled_capabilities, quiet_hours_start, quiet_hours_end').eq('organization_id', organizationId).maybeSingle(),
    ]);
    if (merchantError) throw databaseError('autonomy merchant policy lookup', merchantError.message);
    if (executionError) throw databaseError('autonomy execution policy lookup', executionError.message);
    const merchantRow = merchant && typeof merchant === 'object' && !Array.isArray(merchant) ? merchant as Record<string, unknown> : {};
    const executionRow = execution && typeof execution === 'object' && !Array.isArray(execution) ? execution as Record<string, unknown> : {};
    const allowedActions = new Set(Array.isArray(merchantRow.allowed_actions) ? merchantRow.allowed_actions.map(String) : []);
    const enabledCapabilities = new Set(Array.isArray(executionRow.enabled_capabilities) ? executionRow.enabled_capabilities.map(String) : []);
    return {
      organizationId,
      maxAutoRecoveryPaise: Number.isSafeInteger(Number(executionRow.max_amount_paise)) ? Number(executionRow.max_amount_paise) : 500_000,
      maxAutoCapturePaise: 0,
      maxAutoRefundPaise: 0,
      recoveryEmailEnabled: allowedActions.has('deliver_recovery_link_email') || enabledCapabilities.has('deliver_recovery_link_email'),
      subscriptionRetryEnabled: false,
      captureEnabled: allowedActions.has('capture_authorized_payment') && enabledCapabilities.has('capture_authorized_payment'),
      refundEnabled: allowedActions.has('refund_payment') && enabledCapabilities.has('refund_payment'),
      disputeEvidenceEnabled: allowedActions.has('submit_dispute_evidence') && enabledCapabilities.has('submit_dispute_evidence'),
      maxContactsPerIncident: 2,
      maxContactsPer24h: 1,
      quietHoursStart: Number.isInteger(executionRow.quiet_hours_start) ? String(executionRow.quiet_hours_start) : null,
      quietHoursEnd: Number.isInteger(executionRow.quiet_hours_end) ? String(executionRow.quiet_hours_end) : null,
      updatedAt: new Date().toISOString(),
    };
  }

  async updateAutonomyPolicy(organizationId: string, update: Partial<AutonomyPolicy>): Promise<AutonomyPolicy> {
    void organizationId;
    void update;
    throw new Error('Autonomy policy mutation is not exposed through this repository; use the service-role policy migration workflow.');
  }

  async customerProfile(organizationId: string, customerHash: string): Promise<CustomerProfile | null> {
    if (!customerHash) return null;
    const now = new Date().toISOString();
    const [{ data: eventRows, error: eventError }, { data: actionRows, error: actionError }] = await Promise.all([
      this.client.from('payscope_events')
        .select('normalized, created_at')
        .eq('organization_id', organizationId)
        .eq('customer_hash', customerHash)
        .order('created_at', { ascending: false })
        .limit(50),
      this.client.from('payscope_execution_actions')
        .select('dispatched_at, created_at, state, command_payload')
        .eq('organization_id', organizationId)
        .eq('command_payload->>customerHash', customerHash)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    if (eventError) throw databaseError('customer profile event lookup', eventError.message);
    if (actionError) throw databaseError('customer profile execution lookup', actionError.message);
    const customerEvents = (eventRows ?? []).flatMap(row => {
      const value = row as Record<string, unknown>;
      const normalized = value.normalized && typeof value.normalized === 'object' && !Array.isArray(value.normalized) ? value.normalized as Record<string, unknown> : null;
      return normalized && typeof value.created_at === 'string' ? [{ normalized, createdAt: value.created_at }] : [];
    });
    if (!customerEvents.length && !(actionRows ?? []).length) return null;
    const capturedEvents = customerEvents.filter(event => event.normalized.eventType === 'payment.captured');
    const failedEvents = customerEvents.filter(event => event.normalized.eventType === 'payment.failed');
    const successfulMethods = Array.from(new Set(capturedEvents.map(event => typeof event.normalized.paymentMethod === 'string' ? event.normalized.paymentMethod : null).filter((value): value is string => Boolean(value))));
    const failedMethods = Array.from(new Set(failedEvents.map(event => typeof event.normalized.paymentMethod === 'string' ? event.normalized.paymentMethod : null).filter((value): value is string => Boolean(value))));
    const actions = (actionRows ?? []).map(row => row as Record<string, unknown>);
    const dispatched = actions.find(action => typeof action.dispatched_at === 'string');
    const paidLinkEvents = customerEvents.filter(event => {
      const providerData = event.normalized.providerData && typeof event.normalized.providerData === 'object' && !Array.isArray(event.normalized.providerData) ? event.normalized.providerData as Record<string, unknown> : {};
      return event.normalized.eventType === 'payment_link.paid' || (event.normalized.eventType === 'payment.captured' && typeof providerData.payment_link_reference_id === 'string');
    });
    return {
      organizationId,
      customerHash,
      successfulPaymentMethods: successfulMethods,
      failedPaymentMethods: failedMethods,
      successfulPaymentCount: capturedEvents.length,
      totalIncidentCount: failedEvents.length,
      recoveryEmailsSent: actions.length,
      recoveryEmailsPaid: paidLinkEvents.length,
      lastContactedAt: typeof dispatched?.dispatched_at === 'string' ? dispatched.dispatched_at : null,
      firstSeenAt: customerEvents.at(-1)?.createdAt ?? now,
      lastSeenAt: customerEvents.at(0)?.createdAt ?? now,
    };
  }

  async upsertCustomerProfileOnCaptured(organizationId: string, customerHash: string, paymentMethod?: string): Promise<void> {
    void organizationId;
    void customerHash;
    void paymentMethod;
  }

  async upsertCustomerProfileOnFailed(organizationId: string, customerHash: string, paymentMethod?: string): Promise<void> {
    void organizationId;
    void customerHash;
    void paymentMethod;
  }

  async incident(organizationId: string, incidentId: string): Promise<Incident | null> {
    const detail = await this.incidentDetail(organizationId, incidentId).catch(() => null);
    return detail?.incident ?? null;
  }

  async recordAdaptiveReplanDecision(input: {
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
  }): Promise<void> {
    const { error } = await this.client.rpc('payscope_append_audit_entry', {
      p_organization_id: input.organizationId,
      p_incident_id: input.incidentId,
      p_event_type: 'adaptive_replan_decision',
      p_actor_type: 'system',
      p_actor_id: 'payscope-adaptive-replanner',
      p_actor_session_hash: null,
      p_decision: input.decision,
      p_rationale: input.rationale.slice(0, 1_000),
      p_confidence: input.confidence ?? null,
      p_enrichment_snapshot: {
        source: 'durable_adaptive_replan',
        triggerReason: input.triggerReason.slice(0, 120),
        priorActionId: input.priorActionId ?? null,
        adaptedStrategy: input.adaptedStrategy ?? null,
        actionId: input.actionId ?? null,
        policyOutcome: input.policyOutcome ?? null,
      },
    });
    if (error) throw databaseError('adaptive replan audit', error.message);
  }

  // Helpers for recovery outcome learning (deterministic, no LLM)
  customerSegmentForProfile(profile: CustomerProfile | null, amountPaise: number): 'new' | 'repeat' | 'high' | 'unknown' {
    if (!profile) return 'unknown';
    if (amountPaise >= 500_000) return 'high';
    if (profile.successfulPaymentCount >= 5) return 'repeat';
    return 'new';
  }

  async recoveryOutcomeStats(organizationId: string, strategy: string, failureCategory: string, customerSegment: string): Promise<RecoveryOutcomeStats | null> {
    const { data, error } = await this.client
      .from('payscope_recovery_outcomes')
      .select('outcome, time_to_recovery_ms')
      .eq('organization_id', organizationId)
      .eq('strategy', strategy)
      .eq('failure_category', failureCategory)
      .eq('customer_segment', customerSegment)
      .neq('outcome', 'pending')
      .limit(200);
    if (error) throw databaseError('recovery outcome stats', error.message);
    const rows = (data ?? []) as Array<{ outcome: string; time_to_recovery_ms: number | null }>;
    if (!rows.length) return null;
    const attempts = rows.length;
    const paid = rows.filter(r => r.outcome === 'paid').length;
    const times = rows.map(r => r.time_to_recovery_ms).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return {
      strategy, failureCategory, customerSegment, attempts, paid,
      recoveryRate: attempts ? paid / attempts : 0,
      avgTimeToRecoveryMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    };
  }

  async recordRecoveryOutcome(organizationId: string, actionId: string, outcome: 'paid' | 'expired' | 'failed' | 'cancelled', actualRecoveryPaise: number | null): Promise<void> {
    const { error } = await this.client.rpc('payscope_record_recovery_outcome', {
      p_organization_id: organizationId,
      p_action_id: actionId,
      p_outcome: outcome,
      p_actual_recovery_paise: actualRecoveryPaise,
    });
    if (error) throw databaseError('recovery outcome close', error.message);
  }

  async createExecutionActionForSaga(organizationId: string, incidentId: string, capability: ActionType, rationale: string, amountPaise: number, ledgerContext?: { customerHash?: string; failureCategory?: string; paymentMethod?: string; customerSegment?: string; expectedRecoveryPaise?: number | null; consideredStrategies?: Array<{ strategy: ActionType; baseScore: number; historicalRate: number | null; sampleSize: number }>; exploration?: boolean; confidence?: number | null; riskScore?: number | null }): Promise<string> {
    // Replans may only enqueue the capability backed by the transactional
    // direct-execution RPC. Other ranked strategies remain no-action until
    // they have their own provider contract and atomic outbox function.
    if (capability !== 'deliver_recovery_link_email') throw new Error(`No direct execution contract exists for ${capability}`);
    const commandKey = `${organizationId}:${capability}:${incidentId}`;
    const detail = await this.incidentDetail(organizationId, incidentId).catch(() => null);
    const latestEvent = detail?.events.at(-1);
    const customerHash = ledgerContext?.customerHash ?? latestEvent?.event.customerHash ?? createHash('sha256').update(`${organizationId}:${incidentId}`).digest('hex').slice(0, 64);
    const referenceId = `ps_${randomUUID().replace(/-/g, '')}`;
    const payload = { customerHash, referenceId, copyIntent: rationale };
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    // Atomic path with ledger — when learning is enabled, ledger MUST succeed (fail-closed).
    const learningEnabled = process.env.PAYSCOPE_LEARNING_ENABLED !== 'false';
    if (ledgerContext && learningEnabled) {
      const { data: ledgerData, error: ledgerError } = await this.client.rpc('payscope_enqueue_with_ledger', {
        p_organization_id: organizationId,
        p_incident_id: incidentId,
        p_proposal_id: null,
        p_command_key: commandKey,
        p_command_payload: payload,
        p_command_payload_hash: payloadHash,
        p_payment_id: latestEvent?.event.paymentId ?? null,
        p_order_id: latestEvent?.event.orderId ?? null,
        p_amount_paise: amountPaise,
        p_currency: latestEvent?.event.currency ?? 'INR',
        p_customer_hash: ledgerContext.customerHash ?? customerHash,
        p_failure_category: ledgerContext.failureCategory ?? 'unknown',
        p_payment_method: (ledgerContext.paymentMethod ?? latestEvent?.event.paymentMethod ?? 'unknown').slice(0, 80),
        p_customer_segment: ledgerContext.customerSegment ?? 'unknown',
        p_strategy: capability,
        p_expected_recovery_paise: ledgerContext.expectedRecoveryPaise ?? null,
        p_considered_strategies: (ledgerContext.consideredStrategies ?? []).slice(0, 6) as unknown as never,
        p_exploration: ledgerContext.exploration ?? false,
        p_confidence: ledgerContext.confidence ?? null,
        p_risk_score: ledgerContext.riskScore ?? null,
      });
      if (ledgerError) throw databaseError('atomic ledger enqueue', ledgerError.message);
      if (typeof ledgerData !== 'string') throw databaseError('atomic ledger enqueue', 'invalid action id');
      return ledgerData;
    }
    if (ledgerContext && !learningEnabled) {
      // Learning explicitly disabled — fall through to legacy path without ledger
      // (no learning record will be created)
    } else if (ledgerContext) {
      // Should not reach here — learningEnabled true but ledgerContext missing handled above
    }

    const { data, error } = await this.client.rpc('payscope_enqueue_recovery_email_action', {
      p_organization_id: organizationId,
      p_incident_id: incidentId,
      p_proposal_id: null,
      p_command_key: commandKey,
      p_command_payload: payload,
      p_command_payload_hash: payloadHash,
      p_payment_id: latestEvent?.event.paymentId ?? null,
      p_order_id: latestEvent?.event.orderId ?? null,
      p_amount_paise: amountPaise,
      p_currency: latestEvent?.event.currency ?? 'INR',
    });
    if (error || typeof data !== 'string') throw databaseError('atomic replan action enqueue', error?.message ?? 'invalid action id');
    return data;
  }

  async delayOutboxForAction(organizationId: string, actionId: string, delayMs: number): Promise<void> {
    if (!Number.isSafeInteger(delayMs) || delayMs <= 0 || delayMs > 12 * 3600_000) return;
    const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
    const { error } = await this.client.from('payscope_execution_outbox').update({ next_attempt_at: nextAttemptAt, updated_at: new Date().toISOString() }).eq('organization_id', organizationId).eq('action_id', actionId).eq('status', 'pending');
    if (error) logger.warn({ organizationId, actionId, error: error.message }, 'Adaptive timing outbox delay failed');
  }

  async updateIncidentStatus(incidentId: string, organizationId: string, status: IncidentStatus, recoveredAmountPaise: number, remainingAmountPaise: number): Promise<void> {
    // Financial state — fail closed, let caller/job retry; never swallow.
    const { error, count } = await this.client.from('payscope_incidents').update({
      status,
      recovered_amount_paise: recoveredAmountPaise,
      remaining_amount_paise: remainingAmountPaise,
      resolved_at: status === 'RESOLVED' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { count: 'exact' }).eq('id', incidentId).eq('organization_id', organizationId);
    if (error) throw databaseError('incident status update', error.message);
    if (count === 0) throw databaseError('incident status update', 'incident not found or outside organization');
  }

  async appendAuditEntry(entry: { organizationId: string; incidentId: string | null; eventType: string; actorType: 'system' | 'human'; actorId: string; decision: string; rationale: string; confidence: number | null }): Promise<void> {
    // Concurrency-safe, DB-serialized append via RPC — never client-side Date.now() sequencing.
    const { error } = await this.client.rpc('payscope_append_audit_entry', {
      p_organization_id: entry.organizationId,
      p_incident_id: entry.incidentId,
      p_event_type: entry.eventType,
      p_actor_type: entry.actorType,
      p_actor_id: entry.actorId,
      p_actor_session_hash: null,
      p_decision: entry.decision,
      p_rationale: entry.rationale.slice(0, 1_000),
      p_confidence: entry.confidence,
      p_enrichment_snapshot: null,
    });
    if (error) throw databaseError('audit append', error.message);
  }

  // === Revenue Intelligence ===
  async revenueIntelligence(organizationId: string): Promise<RevenueIntelligence> {
    const incidents = await this.listIncidents(organizationId, 100);
    const atRiskPaise = incidents.filter(i => i.status === 'OPEN' || i.status === 'MONITORING' || i.status === 'ESCALATED').reduce((sum, i) => sum + i.remainingAmountPaise, 0);
    const recoveredThisWeekPaise = incidents.filter(i => i.status === 'RESOLVED' || i.status === 'HUMAN_RESOLVED').reduce((sum, i) => sum + i.recoveredAmountPaise, 0);
    const protectedPaise = incidents.filter(i => i.status === 'DISPUTE_OPENED' || i.status === 'DISMISSED').reduce((sum, i) => sum + i.totalFailedAmountPaise, 0);

    let activeActionsCount = 0;
    let completedActionsCount = 0;
    try {
      const { data } = await this.client.from('payscope_execution_actions').select('id, state').eq('organization_id', organizationId).limit(100);
      if (Array.isArray(data)) {
        activeActionsCount = data.filter(d => ['queued', 'dispatching', 'accepted', 'retry_scheduled'].includes(d.state)).length;
        completedActionsCount = data.filter(d => d.state === 'confirmed').length;
      }
    } catch (error) {
      // Revenue intelligence action counts are informational only; log but don't fail the request
      logger.warn({ organizationId, error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch execution action counts for revenue intelligence');
    }

    const resolvedIncidentsCount = incidents.filter(i => i.status === 'RESOLVED' || i.status === 'HUMAN_RESOLVED').length;
    const totalEndedIncidents = incidents.filter(i => i.status === 'RESOLVED' || i.status === 'HUMAN_RESOLVED' || i.status === 'DISMISSED').length;
    const recoveryRate = totalEndedIncidents > 0 ? resolvedIncidentsCount / totalEndedIncidents : 0;

    // Real telemetry coverage: fraction of incidents with at least one enriched correlated event
    let telemetrySignalCoverage = 0;
    try {
      const { data: coverageData } = await this.client.rpc('payscope_telemetry_coverage', { p_organization_id: organizationId });
      if (typeof coverageData === 'number' && Number.isFinite(coverageData)) telemetrySignalCoverage = Math.max(0, Math.min(1, coverageData));
      else if (coverageData !== null && typeof coverageData === 'object') {
        // fallback if RPC returns jsonb
        const v = (coverageData as Record<string, unknown>).coverage ?? coverageData;
        if (typeof v === 'number') telemetrySignalCoverage = Math.max(0, Math.min(1, v));
      }
    } catch {
      // coverage stays 0; never fabricate 0.95
    }
    // Fallback direct count if RPC unavailable (migration 016 pending)
    if (telemetrySignalCoverage === 0 && incidents.length > 0) {
      try {
        const allIds = incidents.flatMap(i => i.correlatedEventIds).slice(0, 200);
        if (allIds.length) {
          const { data: covRows } = await this.client.from('payscope_events').select('id').eq('organization_id', organizationId).in('id', allIds).not('enrichment', 'is', null).limit(200);
          const enrichedCount = new Set((covRows ?? []).map(r => (r as Record<string, unknown>).id as string)).size;
          // approximate: incidents with at least one enriched event / total incidents
          const incidentsWithEnrichment = incidents.filter(inc => inc.correlatedEventIds.some(id => (covRows ?? []).some(r => (r as Record<string, unknown>).id === id))).length;
          telemetrySignalCoverage = incidents.length ? incidentsWithEnrichment / incidents.length : 0;
        }
      } catch (error) {
        // Telemetry coverage is informational only; log but don't fail the request
        logger.warn({ organizationId, error: error instanceof Error ? error.message : String(error) }, 'Failed to compute telemetry signal coverage');
      }
    }

    // Real active rescues: derive attribution from latest enriched event per incident
    const activeIncidents = incidents.filter(i => i.status === 'OPEN' || i.status === 'MONITORING').slice(0, 10);
    let enrichmentByEventId = new Map<string, { failureAttribution?: string; source?: string }>();
    if (activeIncidents.length) {
      const activeEventIds = activeIncidents.flatMap(i => i.correlatedEventIds).slice(0, 100);
      if (activeEventIds.length) {
        try {
          const { data: activeEvents } = await this.client.from('payscope_events').select('id, enrichment, enrichment_source').eq('organization_id', organizationId).in('id', activeEventIds);
          for (const row of (activeEvents ?? []) as Array<Record<string, unknown>>) {
            const eid = row.id as string;
            const enr = row.enrichment as Record<string, unknown> | null;
            if (eid && enr && typeof enr.failureAttribution === 'string') enrichmentByEventId.set(eid, { failureAttribution: enr.failureAttribution as string, source: row.enrichment_source as string });
          }
        } catch (error) {
          // Enrichment data is informational only; log but don't fail the request
          logger.warn({ organizationId, error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch enrichment data for active rescues');
        }
      }
    }
    const activeRescues = activeIncidents.map(inc => {
      const latestEventId = inc.correlatedEventIds.at(-1);
      const enr = latestEventId ? enrichmentByEventId.get(latestEventId) : undefined;
      return {
        incidentId: inc.id,
        amountPaise: inc.remainingAmountPaise,
        strategyName: 'deliver_recovery_link_email',
        strategyDisplayName: '1-Click Razorpay Payment Link Email',
        telemetryAttribution: enr?.failureAttribution ?? 'unknown',
        telemetryDataSource: (enr?.source as 'razorpay_fields_heuristic' | undefined) ?? 'razorpay_fields_heuristic' as const,
        sagaStep: 'Execution action active', // deprecated alias, kept for frontend compat; use `step` going forward
        step: 'Execution action active',
        elapsedMs: Math.max(0, Date.now() - Date.parse(inc.openedAt)),
      };
    });

    return {
      atRiskPaise,
      recoverablePaise: atRiskPaise,
      recoveredThisWeekPaise,
      protectedPaise,
      recoveryRate,
      merchantInterventionCount: 0,
      telemetrySignalCoverage,
      activeRescues,
      autonomous: {
        investigated: incidents.length,
        sagasCreated: activeActionsCount + completedActionsCount,
        investigationsCreated: activeActionsCount + completedActionsCount,
        actionsExecuted: activeActionsCount + completedActionsCount,
        paymentsRecovered: resolvedIncidentsCount,
      },
    };
  }
}

function eventFromRow(row: Record<string, unknown>): StoredEvent {
  if (typeof row.id !== 'string' || typeof row.organization_id !== 'string') throw new Error('PayScope event row is invalid');
  const enrichment = row.enrichment === null || row.enrichment === undefined ? null : TelemetryEnrichmentSchema.parse(row.enrichment);
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
