import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../errors';
import { AutoPolicy, EventSource, IncidentAuditEntry, Investigation, PaymentOpsEvent, PaymentOpsIncident } from './paymentOpsTypes';

// Node 21 lacks native WebSocket (added in Node 22) — provide `ws` polyfill for Supabase Realtime
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WS = require('ws');
  if (typeof (globalThis as unknown as { WebSocket?: unknown }).WebSocket === 'undefined') {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = WS;
  }
} catch {}

type StoredSnapshot = { events: PaymentOpsEvent[]; incidents: PaymentOpsIncident[]; audits: IncidentAuditEntry[]; policies: AutoPolicy[] };

function configuredClient(): SupabaseClient | undefined {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url && !key) return undefined;
  if (!url || !key) throw new AppError('INVALID_SUPABASE_CONFIG', 503, 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured together');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('unsafe URL');
  } catch { throw new AppError('INVALID_SUPABASE_CONFIG', 503, 'SUPABASE_URL must be an absolute HTTPS URL'); }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function fail(operation: string, message?: string): never { throw new AppError('PERSISTENCE_FAILED', 503, `Supabase ${operation} failed${message ? `: ${message}` : ''}`); }

export class PaymentOpsRepository {
  private readonly client = configuredClient();

  get configured(): boolean { return Boolean(this.client); }

  async restore(): Promise<StoredSnapshot> {
    if (!this.client) return { events: [], incidents: [], audits: [], policies: [] };
    const [eventsResult, incidentsResult, auditsResult] = await Promise.all([
      this.client.from('webhook_events').select('event_id, source, event_type, occurred_at, received_at, payment_id, order_id, subscription_id, customer_reference, currency, amount_paise, payment_status, payment_method, summary, raw_payload').order('occurred_at', { ascending: false }).limit(500),
      this.client.from('incidents').select('*').order('updated_at', { ascending: false }).limit(200),
      this.client.from('audit_logs').select('*').order('occurred_at', { ascending: false }).limit(1000),
    ]);
    if (eventsResult.error) fail('event restore', eventsResult.error.message);
    if (incidentsResult.error) fail('incident restore', incidentsResult.error.message);
    if (auditsResult.error) fail('audit restore', auditsResult.error.message);
    // Database reads are newest-first for an efficient recent-window query. Reverse
    // before putting them in Maps so bounded in-memory eviction removes the oldest.
    const events: PaymentOpsEvent[] = [...(eventsResult.data ?? [])].reverse().map((row: Record<string, unknown>) => eventFromRow(row));
    const investigations = new Map<string, Investigation>();
    const investigationResult = await this.client.from('agent_runs').select('*').order('completed_at', { ascending: false }).limit(200);
    if (investigationResult.error) fail('agent-run restore', investigationResult.error.message);
    for (const row of investigationResult.data ?? []) {
      const incidentId = String(row.incident_id);
      if (!investigations.has(incidentId)) investigations.set(incidentId, investigationFromRow(row as Record<string, unknown>));
    }
    const incidents: PaymentOpsIncident[] = [...(incidentsResult.data ?? [])].reverse().map((row: Record<string, unknown>) => {
      const incident = incidentFromRow(row, investigations.get(String(row.incident_id)));
      const run = incident.agentRun;
      if (run) {
        const validEvidence = run.incidentId === incident.incidentId ? run.evidenceEventIds.filter(eventId => incident.eventIds.includes(eventId)) : [];
        if (validEvidence.length === 0) {
          incident.agentRun = undefined;
          incident.actionProposal = undefined;
        } else {
          incident.agentRun = { ...run, evidenceEventIds: validEvidence };
          incident.actionProposal = run.recommendedAction;
        }
      }
      return incident;
    });
    const audits: IncidentAuditEntry[] = (auditsResult.data ?? []).map((row: Record<string, unknown>) => ({ auditId: String(row.audit_id), incidentId: String(row.incident_id), at: String(row.occurred_at), actor: row.actor as IncidentAuditEntry['actor'], action: String(row.action), detail: String(row.detail) }));
    let policies: AutoPolicy[] = [];
    const policyResult = await this.client.from('auto_policies').select('*').order('created_at', { ascending: true }).limit(100);
    if (policyResult.error && (policyResult.error as { code?: string }).code !== '42P01') fail('policy restore', policyResult.error.message);
    if (!policyResult.error) policies = (policyResult.data ?? []).map((row: Record<string, unknown>) => policyFromRow(row)).filter((p): p is AutoPolicy => Boolean(p));
    return { events, incidents, audits, policies };
  }

  async persistEvent(event: PaymentOpsEvent): Promise<boolean> {
    if (!this.client) return true;
    const { error } = await this.client.from('webhook_events').insert(eventRow(event));
    if (!error) return true;
    if ((error as { code?: string }).code === '23505') return false;
    fail('event persistence', error.message);
  }

  async eventById(eventId: string): Promise<PaymentOpsEvent | undefined> {
    if (!this.client) return undefined;
    const { data, error } = await this.client.from('webhook_events').select('event_id, source, event_type, occurred_at, received_at, payment_id, order_id, subscription_id, customer_reference, currency, amount_paise, payment_status, payment_method, summary, raw_payload').eq('event_id', eventId).maybeSingle();
    if (error) fail('event lookup', error.message);
    return data ? eventFromRow(data as Record<string, unknown>) : undefined;
  }

  async persistIncidentWithAudit(incident: PaymentOpsIncident, audit: IncidentAuditEntry): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client.rpc('paymentops_persist_incident_with_audit', { incident_payload: incidentRow(incident), audit_payload: auditRow(audit) });
    if (error) fail('incident and audit persistence', error.message);
  }

  async persistInvestigationWithIncidentAndAudit(incident: PaymentOpsIncident, investigation: Investigation, audit: IncidentAuditEntry): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client.rpc('paymentops_persist_investigation_with_incident_audit', { incident_payload: incidentRow(incident), investigation_payload: investigationRow(investigation), audit_payload: auditRow(audit) });
    if (error) fail('investigation, incident, and audit persistence', error.message);
  }

  async persistPolicy(policy: AutoPolicy): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client.from('auto_policies').upsert(policyRow(policy), { onConflict: 'policy_id' });
    if (error) fail('policy persistence', error.message);
  }

  async deletePolicy(policyId: string): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client.from('auto_policies').delete().eq('policy_id', policyId);
    if (error) fail('policy deletion', error.message);
  }

}

const MAX_RAW_PAYLOAD_BYTES = 16_384;
function stringValue(value: unknown, max = 300): string | undefined { return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function boundedObject(value: unknown): Record<string, unknown> { const candidate = objectValue(value); try { return Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= MAX_RAW_PAYLOAD_BYTES ? candidate : { truncated: true }; } catch { return { truncated: true }; } }
function sourceValue(value: unknown): EventSource { return value === 'history_import' ? 'history_import' : 'webhook'; }
function currencyValue(value: unknown): string | undefined { const candidate = stringValue(value, 3)?.toUpperCase(); return candidate && /^[A-Z]{3}$/.test(candidate) ? candidate : undefined; }
function eventRow(event: PaymentOpsEvent): Record<string, unknown> { return { event_id: event.eventId, source: event.source, event_type: event.eventType, occurred_at: event.occurredAt, received_at: event.receivedAt, payment_id: event.paymentId ?? null, order_id: event.orderId ?? null, subscription_id: event.subscriptionId ?? null, customer_reference: event.customerReference, currency: currencyValue(event.currency) ?? null, amount_paise: event.amountPaise ?? null, payment_status: event.paymentStatus ?? null, payment_method: event.paymentMethod ?? null, summary: event.summary, raw_payload: boundedObject(event.rawPayload) }; }
function incidentRow(incident: PaymentOpsIncident): Record<string, unknown> { return { incident_id: incident.incidentId, incident_type: incident.incidentType, status: incident.status, severity: incident.severity, title: incident.title, customer_reference: incident.customerReference, payment_method: incident.paymentMethod ?? null, currency: currencyValue(incident.currency) ?? null, amount_at_risk_paise: incident.amountAtRiskPaise, recovered_amount_paise: incident.recoveredAmountPaise, event_ids: incident.eventIds, event_count: incident.eventCount, summary: incident.summary, created_at: incident.createdAt, updated_at: incident.updatedAt, latest_event_at: incident.latestEventAt, action_proposal: incident.actionProposal ?? null, operator_action: incident.operatorAction ?? null }; }
function auditRow(entry: IncidentAuditEntry): Record<string, unknown> { return { audit_id: entry.auditId, incident_id: entry.incidentId, occurred_at: entry.at, actor: entry.actor, action: entry.action, detail: entry.detail }; }
function investigationRow(run: Investigation): Record<string, unknown> { return { run_id: run.runId, incident_id: run.incidentId, status: run.status, provider: run.provider, started_at: run.startedAt, completed_at: run.completedAt, incident_summary: run.incidentSummary, severity: run.severity, confidence: run.confidence, evidence_event_ids: run.evidenceEventIds, observed_pattern: run.observedPattern, impact: run.impact, recommended_action: run.recommendedAction, missing_context: run.missingContext, error_message: run.errorMessage ?? null }; }
function eventFromRow(row: Record<string, unknown>): PaymentOpsEvent { return { eventId: String(row.event_id).slice(0, 300), source: sourceValue(row.source), eventType: String(row.event_type || 'unknown.event').slice(0, 300), occurredAt: String(row.occurred_at), receivedAt: String(row.received_at), paymentId: stringValue(row.payment_id), orderId: stringValue(row.order_id), subscriptionId: stringValue(row.subscription_id), customerReference: stringValue(row.customer_reference) ?? 'Unlinked payment', currency: currencyValue(row.currency), amountPaise: numberValue(row.amount_paise), paymentStatus: stringValue(row.payment_status), paymentMethod: stringValue(row.payment_method), summary: stringValue(row.summary, 1_000) ?? '', rawPayload: boundedObject(row.raw_payload) }; }
function stringArray(value: unknown, max = 100): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, max) : []; }
function actionProposal(value: unknown): PaymentOpsIncident['actionProposal'] { const proposal = objectValue(value); return ['review_payment_method', 'prepare_follow_up', 'escalate', 'monitor'].includes(String(proposal.type)) && typeof proposal.rationale === 'string' && proposal.requiresHumanApproval === true ? { type: proposal.type as NonNullable<PaymentOpsIncident['actionProposal']>['type'], rationale: proposal.rationale.slice(0, 700), requiresHumanApproval: true } : undefined; }
function operatorAction(value: unknown): PaymentOpsIncident['operatorAction'] { const action = objectValue(value); return ['review_payment_method', 'prepare_follow_up', 'escalate', 'monitor', 'dismiss'].includes(String(action.type)) && typeof action.actionId === 'string' && typeof action.operator === 'string' && typeof action.approvedAt === 'string' ? { actionId: action.actionId, type: action.type as NonNullable<PaymentOpsIncident['operatorAction']>['type'], operator: action.operator, approvedAt: action.approvedAt } : undefined; }
function incidentFromRow(row: Record<string, unknown>, agentRun?: Investigation): PaymentOpsIncident { const eventIds = stringArray(row.event_ids); const amountAtRiskPaise = numberValue(Number(row.amount_at_risk_paise)) ?? 0; const recoveredAmountPaise = Math.min(amountAtRiskPaise, numberValue(Number(row.recovered_amount_paise)) ?? 0); return { incidentId: String(row.incident_id).slice(0, 300), incidentType: row.incident_type as PaymentOpsIncident['incidentType'], status: row.status as PaymentOpsIncident['status'], severity: row.severity as PaymentOpsIncident['severity'], title: stringValue(row.title) ?? 'Payment incident', customerReference: stringValue(row.customer_reference) ?? 'Unlinked payment', paymentMethod: stringValue(row.payment_method), currency: currencyValue(row.currency), amountAtRiskPaise, recoveredAmountPaise, eventIds, eventCount: Math.max(eventIds.length, numberValue(Number(row.event_count)) ?? 0), summary: stringValue(row.summary, 1_000) ?? '', createdAt: String(row.created_at), updatedAt: String(row.updated_at), latestEventAt: String(row.latest_event_at), actionProposal: actionProposal(row.action_proposal), operatorAction: operatorAction(row.operator_action), agentRun }; }
function investigationFromRow(row: Record<string, unknown>): Investigation { const impact = objectValue(row.impact); const recommendation = actionProposal(row.recommended_action); if (!recommendation) throw new AppError('PERSISTENCE_FAILED', 503, 'Supabase agent-run restore returned an invalid action proposal'); const confidence = Number(row.confidence); return { runId: String(row.run_id), incidentId: String(row.incident_id), status: row.status as Investigation['status'], provider: row.provider as Investigation['provider'], startedAt: String(row.started_at), completedAt: String(row.completed_at), incidentSummary: String(row.incident_summary || ''), severity: row.severity as Investigation['severity'], confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0, evidenceEventIds: stringArray(row.evidence_event_ids, 30), observedPattern: String(row.observed_pattern || ''), impact: { failedPayments: numberValue(Number(impact.failedPayments)) ?? 0, unresolvedAmountPaise: numberValue(Number(impact.unresolvedAmountPaise)) ?? 0, recoveredAmountPaise: numberValue(Number(impact.recoveredAmountPaise)) ?? 0 }, recommendedAction: recommendation, missingContext: stringArray(row.missing_context, 10), errorMessage: stringValue(row.error_message) }; }

function policyRow(p: AutoPolicy): Record<string, unknown> { return { policy_id: p.policyId, name: p.name, enabled: p.enabled, incident_types: p.incidentTypes, severities: p.severities, min_confidence: p.minConfidence, max_amount_paise: p.maxAmountPaise, action: p.action, require_human_for_escalate: p.requireHumanForEscalate, created_at: p.createdAt, updated_at: p.updatedAt }; }
function policyFromRow(row: Record<string, unknown>): AutoPolicy | undefined {
  const pid = String(row.policy_id || '').slice(0, 120); if (!pid) return undefined;
  const severities = Array.isArray(row.severities) ? (row.severities as unknown[]).filter((s): s is AutoPolicy['severities'][number] => ['critical','high','medium','low'].includes(String(s))) as AutoPolicy['severities'] : [];
  const incidentTypes = Array.isArray(row.incident_types) ? (row.incident_types as unknown[]).filter((t): t is AutoPolicy['incidentTypes'][number] => ['payment_failure','refund_failure','payment_dispute','subscription_risk'].includes(String(t))) as AutoPolicy['incidentTypes'] : [];
  const action = String(row.action || ''); if (!['review_payment_method','prepare_follow_up','escalate','monitor','dismiss'].includes(action)) return undefined;
  return { policyId: pid, name: String(row.name || '').slice(0,120) || pid, enabled: Boolean(row.enabled), incidentTypes, severities, minConfidence: Number.isFinite(Number(row.min_confidence)) ? Math.min(1, Math.max(0, Number(row.min_confidence))) : 0.8, maxAmountPaise: row.max_amount_paise === null || row.max_amount_paise === undefined ? null : (Number.isSafeInteger(Number(row.max_amount_paise)) && Number(row.max_amount_paise) >=0 ? Number(row.max_amount_paise) : null), action: action as AutoPolicy['action'], requireHumanForEscalate: row.require_human_for_escalate !== false, createdAt: String(row.created_at || new Date().toISOString()), updatedAt: String(row.updated_at || new Date().toISOString()) };
}
