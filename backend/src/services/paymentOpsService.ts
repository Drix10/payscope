import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { AppError } from '../errors';
import { PaymentOpsRepository } from './paymentOpsRepository';
import { ActionType, AutoPolicy, ConnectionStatus, EventSource, HistoryImportResult, IncidentAuditEntry, IncidentStatus, IncidentType, Investigation, PaymentOpsDashboard, PaymentOpsEvent, PaymentOpsEventSummary, PaymentOpsIncident, Severity } from './paymentOpsTypes';

type UnknownRecord = Record<string, unknown>;
type RazorpayWebhook = { event?: unknown; created_at?: unknown; payload?: unknown };
const MAX_EVENTS = 2_000;
const MAX_INCIDENTS = 500;
const MAX_AUDIT_ENTRIES = 4_000;
const MAX_RAW_PAYLOAD_BYTES = 16_384;
const MAX_EVENTS_PER_INCIDENT = 100;
const MAX_FACT_EVENTS = 30;
const HISTORY_PAGE_SIZE = 100;
const HISTORY_BATCHES = 5;
const RAZORPAY_API_TIMEOUT_MS = 10_000;

const events = new Map<string, PaymentOpsEvent>();
const incidents = new Map<string, PaymentOpsIncident>();
const audits = new Map<string, IncidentAuditEntry[]>();
const policies = new Map<string, AutoPolicy>();
const repository = new PaymentOpsRepository();
let restored = false;
let restorePromise: Promise<void> | undefined;
let activeImport: { days: number; skip: number; request: Promise<HistoryImportResult> } | undefined;
const inFlightEvents = new Map<string, Promise<{ duplicate: boolean; event: PaymentOpsEvent; incident?: PaymentOpsIncident }>>();
const inFlightInvestigations = new Map<string, Promise<Investigation>>();
const investigationRefreshNeeded = new Set<string>();
const scheduledInvestigationTimers = new Map<string, ReturnType<typeof setTimeout>>();
let mutationQueue: Promise<void> = Promise.resolve();

function record(value: unknown): UnknownRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}; }
function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value.trim().slice(0, 300) : fallback; }
function numeric(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function firstText(...values: unknown[]): string { return values.map(value => text(value)).find(Boolean) || ''; }
function toIso(value: unknown): string { const seconds = typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' ? Date.parse(value) / 1_000 : Number.NaN; const date = Number.isFinite(seconds) ? new Date(seconds * 1_000) : undefined; return date && Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(); }
function isAllowedEvent(eventType: string): boolean { return ['payment.failed', 'payment.authorized', 'payment.captured', 'order.paid', 'refund.created', 'refund.failed', 'payment.dispute.created', 'subscription.pending', 'subscription.halted', 'subscription.cancelled'].includes(eventType); }
function eventFamily(eventType: string): 'risk' | 'recovered' | 'context' { if (['payment.captured', 'order.paid'].includes(eventType)) return 'recovered'; if (['payment.failed', 'refund.failed', 'payment.dispute.created', 'subscription.pending', 'subscription.halted', 'subscription.cancelled'].includes(eventType)) return 'risk'; return 'context'; }
function incidentType(eventType: string): IncidentType | undefined { if (eventType === 'refund.failed') return 'refund_failure'; if (eventType === 'payment.dispute.created') return 'payment_dispute'; if (eventType.startsWith('subscription.')) return 'subscription_risk'; return eventType === 'payment.failed' ? 'payment_failure' : undefined; }
function severity(type: IncidentType, amountPaise: number, count = 1): Severity { if (type === 'payment_dispute' || (type === 'subscription_risk' && count >= 2)) return 'critical'; if (amountPaise >= 500_000 || count >= 5 || type === 'refund_failure') return 'high'; if (amountPaise >= 100_000 || count >= 2) return 'medium'; return 'low'; }
function titleFor(type: IncidentType): string { return type === 'payment_dispute' ? 'Payment dispute needs review' : type === 'refund_failure' ? 'Refund processing failed' : type === 'subscription_risk' ? 'Subscription payment risk' : 'Payment failure needs review'; }
function titleCase(value: string): string { return value.split('.').map(part => part.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase())).join(' · '); }
function identifierFromWebhook(raw: UnknownRecord): { payment: UnknownRecord; order: UnknownRecord; subscription: UnknownRecord; refund: UnknownRecord; dispute: UnknownRecord } { const payload = record(raw.payload); return { payment: record(record(payload.payment).entity), order: record(record(payload.order).entity), subscription: record(record(payload.subscription).entity), refund: record(record(payload.refund).entity), dispute: record(record(payload.dispute).entity) }; }
function boundedRawPayload(raw: UnknownRecord): UnknownRecord { try { const serialized = JSON.stringify(raw); if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_RAW_PAYLOAD_BYTES) return { event: raw.event, created_at: raw.created_at, truncated: true }; return raw; } catch { return { event: raw.event, created_at: raw.created_at, truncated: true }; } }
function currency(...values: unknown[]): string | undefined { for (const value of values) { const candidate = text(value).toUpperCase(); if (/^[A-Z]{3}$/.test(candidate)) return candidate; } return undefined; }
function publicEvent(event: PaymentOpsEvent): PaymentOpsEventSummary { const { rawPayload: _rawPayload, ...summary } = event; return summary; }
function attachEvent(incident: PaymentOpsIncident, eventId: string): boolean { if (incident.eventIds.includes(eventId)) return false; incident.eventIds = [eventId, ...incident.eventIds].slice(0, MAX_EVENTS_PER_INCIDENT); incident.eventCount = Math.max(incident.eventCount, incident.eventIds.length - 1) + 1; return true; }
function cloneIncident(incident: PaymentOpsIncident): PaymentOpsIncident { return { ...incident, eventIds: [...incident.eventIds], agentRun: incident.agentRun ? { ...incident.agentRun, evidenceEventIds: [...incident.agentRun.evidenceEventIds], impact: { ...incident.agentRun.impact }, recommendedAction: { ...incident.agentRun.recommendedAction }, missingContext: [...incident.agentRun.missingContext] } : undefined, actionProposal: incident.actionProposal ? { ...incident.actionProposal } : undefined, operatorAction: incident.operatorAction ? { ...incident.operatorAction } : undefined }; }
function latestTimestamp(...values: string[]): string { return values.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest); }
function publicWebhookUrl(): string { const candidate = process.env.PAYMENT_OPS_PUBLIC_URL?.trim() || process.env.PUBLIC_BASE_URL?.trim() || ''; try { const base = new URL(candidate); const localHttp = process.env.NODE_ENV === 'development' && base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname); if (base.protocol === 'https:' || localHttp) return new URL('/webhooks/razorpay', base).toString(); } catch { /* Missing setup is surfaced in the UI. */ } return ''; }
function isCorrelatableCustomer(reference: string): boolean { return Boolean(reference && reference !== 'Unlinked Razorpay payment' && reference !== 'Unsupported Razorpay event'); }
function eventsRelated(left: PaymentOpsEvent, right: PaymentOpsEvent): boolean {
  if (left.currency && right.currency && left.currency !== right.currency) return false;
  if (left.paymentId && right.paymentId && left.paymentId === right.paymentId) return true;
  if (left.orderId && right.orderId && left.orderId === right.orderId) return true;
  if (left.subscriptionId && right.subscriptionId && left.subscriptionId === right.subscriptionId) return true;
  return isCorrelatableCustomer(left.customerReference)
    && left.customerReference === right.customerReference
    && Boolean(left.paymentMethod)
    && left.paymentMethod === right.paymentMethod
    && Math.abs(Date.parse(left.occurredAt) - Date.parse(right.occurredAt)) < 15 * 60 * 1_000;
}
function recoveryResolvesRisk(recovery: PaymentOpsEvent, risk: PaymentOpsEvent): boolean { return eventsRelated(recovery, risk) && Date.parse(recovery.occurredAt) >= Date.parse(risk.occurredAt); }
function recoveredStatus(incident: Pick<PaymentOpsIncident, 'amountAtRiskPaise' | 'status'>, recoveredAmountPaise: number): { status: IncidentStatus; fullyRecovered: boolean } { const fullyRecovered = incident.amountAtRiskPaise > 0 && recoveredAmountPaise >= incident.amountAtRiskPaise; return { status: fullyRecovered ? 'recovered' : incident.status === 'escalated' ? 'escalated' : 'monitoring', fullyRecovered }; }

export class PaymentOpsService {
  static async initialize(): Promise<void> {
    if (restored) return;
    if (!restorePromise) {
      restorePromise = (async () => {
        const snapshot = await repository.restore();
        for (const event of snapshot.events) events.set(event.eventId, event);
        for (const incident of snapshot.incidents) incidents.set(incident.incidentId, incident);
        for (const audit of snapshot.audits) this.rememberAudit(audit, false);
        for (const policy of snapshot.policies) policies.set(policy.policyId, policy);
        if (policies.size === 0) for (const p of this.defaultPolicies()) policies.set(p.policyId, p);
        restored = true;
      })().finally(() => { restorePromise = undefined; });
    }
    await restorePromise;
  }

  private static defaultPolicies(): AutoPolicy[] {
    const now = new Date().toISOString();
    return [
      { policyId: 'pol_auto_monitor_low', name: 'Auto-monitor low-risk failures', enabled: true, incidentTypes: ['payment_failure'], severities: ['low', 'medium'], minConfidence: 0.8, maxAmountPaise: 100_000, action: 'monitor', requireHumanForEscalate: true, createdAt: now, updatedAt: now },
      { policyId: 'pol_auto_followup_sub', name: 'Auto-prepare subscription follow-up', enabled: true, incidentTypes: ['subscription_risk'], severities: ['low', 'medium'], minConfidence: 0.75, maxAmountPaise: 500_000, action: 'prepare_follow_up', requireHumanForEscalate: true, createdAt: now, updatedAt: now },
      { policyId: 'pol_auto_review_small', name: 'Auto-review small payment failures', enabled: false, incidentTypes: ['payment_failure', 'refund_failure'], severities: ['low'], minConfidence: 0.85, maxAmountPaise: 50_000, action: 'review_payment_method', requireHumanForEscalate: true, createdAt: now, updatedAt: now },
    ];
  }

  static shutdown(): void {
    for (const timer of scheduledInvestigationTimers.values()) clearTimeout(timer);
    scheduledInvestigationTimers.clear();
    investigationRefreshNeeded.clear();
  }

  static listPolicies(): AutoPolicy[] { return [...policies.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }

  static async upsertPolicy(input: Partial<AutoPolicy> & { policyId?: string; name: string; action: ActionType }): Promise<AutoPolicy> {
    await this.initialize();
    if (!input.policyId && policies.size >= 50) throw new AppError('POLICY_LIMIT', 409, 'Policy limit reached (50). Remove a policy before creating another.');
    const now = new Date().toISOString();
    const existing = input.policyId ? policies.get(input.policyId) : undefined;
    const policyId = existing?.policyId ?? input.policyId?.trim() ?? `pol_${randomUUID()}`;
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(policyId)) throw new AppError('INVALID_POLICY', 422, 'Policy ID is invalid');
    const name = text(input.name, '').slice(0, 120); if (!name) throw new AppError('INVALID_POLICY', 422, 'Policy name is required');
    const action = text(input.action) as ActionType; if (!['review_payment_method', 'prepare_follow_up', 'escalate', 'monitor', 'dismiss'].includes(action)) throw new AppError('INVALID_POLICY', 422, 'Policy action is invalid');
    const severities = Array.isArray(input.severities) ? (input.severities as string[]).filter((s): s is Severity => ['critical','high','medium','low'].includes(s)) as Severity[] : existing?.severities ?? [];
    const incidentTypes = Array.isArray(input.incidentTypes) ? (input.incidentTypes as string[]).filter((t): t is IncidentType => ['payment_failure','refund_failure','payment_dispute','subscription_risk'].includes(t)) as IncidentType[] : existing?.incidentTypes ?? [];
    const minConfidence = typeof input.minConfidence === 'number' && Number.isFinite(input.minConfidence) ? Math.min(1, Math.max(0, input.minConfidence)) : existing?.minConfidence ?? 0.8;
    const maxAmountPaise = input.maxAmountPaise === null ? null : typeof input.maxAmountPaise === 'number' && Number.isSafeInteger(input.maxAmountPaise) && input.maxAmountPaise >= 0 ? input.maxAmountPaise : existing?.maxAmountPaise ?? null;
    const enabled = typeof input.enabled === 'boolean' ? input.enabled : existing?.enabled ?? true;
    const requireHumanForEscalate = typeof input.requireHumanForEscalate === 'boolean' ? input.requireHumanForEscalate : existing?.requireHumanForEscalate ?? true;
    if (action === 'dismiss' && (maxAmountPaise === null || maxAmountPaise > 100_000 || severities.includes('critical') || severities.includes('high') || severities.length === 0)) throw new AppError('INVALID_POLICY', 422, 'Auto-dismiss is only allowed for low/medium severities with a capped amount (≤ ₹1000)');
    const policy: AutoPolicy = { policyId, name, enabled, incidentTypes, severities, minConfidence, maxAmountPaise, action, requireHumanForEscalate, createdAt: existing?.createdAt ?? now, updatedAt: now };
    policies.set(policyId, policy);
    await repository.persistPolicy(policy).catch(() => {});
    return policy;
  }

  static async deletePolicy(policyId: string): Promise<void> {
    await this.initialize();
    if (!policies.has(policyId)) throw new AppError('POLICY_NOT_FOUND', 404, 'Policy not found');
    policies.delete(policyId);
    await repository.deletePolicy(policyId).catch(() => {});
  }

  private static findMatchingPolicy(incident: PaymentOpsIncident, investigation: Investigation): AutoPolicy | undefined {
    for (const policy of policies.values()) {
      if (!policy.enabled) continue;
      if (policy.incidentTypes.length && !policy.incidentTypes.includes(incident.incidentType)) continue;
      if (policy.severities.length && !policy.severities.includes(investigation.severity)) continue;
      if (investigation.confidence < policy.minConfidence) continue;
      if (policy.maxAmountPaise !== null && incident.amountAtRiskPaise > policy.maxAmountPaise) continue;
      if (policy.action === 'escalate' && policy.requireHumanForEscalate) continue;
      if (incident.status === 'recovered' || incident.status === 'dismissed') continue;
      if (incident.operatorAction) continue;
      return policy;
    }
    return undefined;
  }

  private static async tryAutoExecute(incident: PaymentOpsIncident, investigation: Investigation): Promise<void> {
    const policy = this.findMatchingPolicy(incident, investigation);
    if (!policy) return;
    const latest = incidents.get(incident.incidentId);
    if (!latest || latest.operatorAction || ['recovered','dismissed'].includes(latest.status)) return;
    await this.enqueueMutation(async () => {
      const current = incidents.get(incident.incidentId);
      if (!current || current.operatorAction || ['recovered','dismissed'].includes(current.status)) return;
      const updated = cloneIncident(current);
      const now = new Date().toISOString();
      updated.operatorAction = { actionId: `act_${randomUUID()}`, type: policy.action, operator: `agent:policy/${policy.policyId}`, approvedAt: now };
      updated.status = policy.action === 'dismiss' ? 'dismissed' : policy.action === 'escalate' ? 'escalated' : 'monitoring';
      updated.updatedAt = now;
      await this.persistIncident(updated, { actor: 'agent', action: `auto_${policy.action}_by_policy`, detail: `Policy "${policy.name}" auto-executed ${policy.action} (confidence ${Math.round(investigation.confidence*100)}%, severity ${investigation.severity}).` });
      incidents.set(updated.incidentId, updated);
    });
  }

  static connectionStatus(): ConnectionStatus {
    const latest = [...events.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
    return { provider: 'razorpay', environment: process.env.RAZORPAY_ENVIRONMENT === 'live' ? 'live' : 'test', webhookUrl: publicWebhookUrl(), webhookSecretConfigured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET?.trim()), apiKeyConfigured: Boolean(process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim()), historyImportAvailable: Boolean(process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim()), databaseConfigured: repository.configured, lastEventReceivedAt: latest?.receivedAt };
  }

  static verifyWebhook(rawBody: Buffer, signature: string | undefined): void {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!secret) throw new AppError('RAZORPAY_WEBHOOK_NOT_CONFIGURED', 503, 'RAZORPAY_WEBHOOK_SECRET is not configured');
    if (!signature || !/^[a-fA-F0-9]{64}$/.test(signature)) throw new AppError('INVALID_RAZORPAY_SIGNATURE', 401, 'Razorpay webhook signature is missing or invalid');
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const provided = Buffer.from(signature, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new AppError('INVALID_RAZORPAY_SIGNATURE', 401, 'Razorpay webhook signature verification failed');
  }

  static parseWebhook(rawBody: Buffer): UnknownRecord {
    try { const parsed = JSON.parse(rawBody.toString('utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object'); return parsed as UnknownRecord; }
    catch { throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook body must be a JSON object'); }
  }

  static async ingestWebhook(raw: UnknownRecord, eventId: string, source: EventSource = 'webhook'): Promise<{ duplicate: boolean; event: PaymentOpsEvent; incident?: PaymentOpsIncident }> {
    await this.initialize();
    if (!/^[A-Za-z0-9_.:-]{1,300}$/.test(eventId)) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'A valid Razorpay event ID is required');
    const existing = events.get(eventId);
    if (existing) return { duplicate: true, event: existing, incident: await this.ensureEventCorrelation(existing) };
    const inFlight = inFlightEvents.get(eventId);
    if (inFlight) {
      const result = await inFlight;
      return { ...result, duplicate: true };
    }
    const request = this.ingestNewWebhook(raw, eventId, source);
    inFlightEvents.set(eventId, request);
    const expiry = setTimeout(() => { if (inFlightEvents.get(eventId) === request) inFlightEvents.delete(eventId); }, 30_000);
    expiry.unref();
    try { return await request; } finally { clearTimeout(expiry); if (inFlightEvents.get(eventId) === request) inFlightEvents.delete(eventId); }
  }

  private static async ingestNewWebhook(raw: UnknownRecord, eventId: string, source: EventSource): Promise<{ duplicate: boolean; event: PaymentOpsEvent; incident?: PaymentOpsIncident }> {
    const event = this.normalizeEvent(raw, eventId, source);
    const inserted = await repository.persistEvent(event);
    if (!inserted) {
      const stored = await repository.eventById(eventId);
      const duplicate = stored ?? event;
      this.rememberEvent(duplicate);
      return { duplicate: true, event: duplicate, incident: await this.ensureEventCorrelation(duplicate) };
    }
    this.rememberEvent(event);
    const incident = await this.ensureEventCorrelation(event);
    return { duplicate: false, event, incident };
  }

  private static async ensureEventCorrelation(event: PaymentOpsEvent): Promise<PaymentOpsIncident | undefined> {
    const existing = this.incidentForEvent(event.eventId);
    if (existing || eventFamily(event.eventType) === 'context') return existing;
    return this.enqueueMutation(async () => this.incidentForEvent(event.eventId) ?? await this.correlate(event));
  }

  private static async enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = mutationQueue.then(operation, operation);
    mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private static normalizeEvent(raw: UnknownRecord, eventId: string, source: EventSource): PaymentOpsEvent {
    const webhook = raw as RazorpayWebhook;
    const eventType = text(webhook.event).toLowerCase();
    if (!isAllowedEvent(eventType)) {
      return { eventId, source, eventType: eventType || 'unknown.event', occurredAt: toIso(webhook.created_at), receivedAt: new Date().toISOString(), customerReference: 'Unsupported Razorpay event', summary: `Verified ${eventType || 'unknown'} event retained for audit.`, rawPayload: boundedRawPayload(raw) };
    }
    const entities = identifierFromWebhook(raw);
    const primary = Object.keys(entities.payment).length ? entities.payment : Object.keys(entities.subscription).length ? entities.subscription : Object.keys(entities.refund).length ? entities.refund : entities.dispute;
    const paymentId = firstText(entities.payment.id, entities.refund.payment_id, entities.dispute.payment_id);
    const orderId = firstText(entities.order.id, entities.payment.order_id);
    const subscriptionId = firstText(entities.subscription.id, entities.payment.subscription_id);
    const customerReference = firstText(entities.payment.customer_id, entities.subscription.customer_id, entities.order.receipt, orderId, paymentId, subscriptionId, 'Unlinked Razorpay payment');
    const amountPaise = numeric(entities.payment.amount) ?? numeric(entities.refund.amount) ?? numeric(entities.dispute.amount) ?? numeric(primary.amount);
    const status = firstText(entities.payment.status, entities.subscription.status, entities.refund.status, entities.dispute.status).toLowerCase();
    const method = firstText(entities.payment.method, entities.payment.wallet, entities.payment.bank, entities.payment.vpa ? 'upi' : '');
    const summary = eventType === 'payment.failed' ? `Payment failed${method ? ` via ${method}` : ''}.` : eventType === 'payment.captured' ? 'Payment was captured.' : eventType === 'order.paid' ? 'Order was paid.' : eventType === 'refund.failed' ? 'Refund processing failed.' : eventType === 'payment.dispute.created' ? 'A payment dispute was created.' : eventType.startsWith('subscription.') ? `Subscription entered ${eventType.slice('subscription.'.length)} state.` : `${titleCase(eventType)} received.`;
    return { eventId, source, eventType, occurredAt: toIso(webhook.created_at), receivedAt: new Date().toISOString(), paymentId: paymentId || undefined, orderId: orderId || undefined, subscriptionId: subscriptionId || undefined, customerReference, currency: currency(entities.payment.currency, entities.refund.currency, entities.dispute.currency, primary.currency), amountPaise, paymentStatus: status || undefined, paymentMethod: method || undefined, summary, rawPayload: boundedRawPayload(raw) };
  }

  private static async correlate(event: PaymentOpsEvent): Promise<PaymentOpsIncident | undefined> {
    const family = eventFamily(event.eventType);
    if (family === 'context') return undefined;
    const related = [...incidents.values()]
      .filter(item => item.status !== 'dismissed' && item.status !== 'recovered')
      .find(item => item.eventIds.some(eventId => {
        const storedEvent = events.get(eventId);
        return storedEvent ? family === 'recovered' ? recoveryResolvesRisk(event, storedEvent) : eventsRelated(storedEvent, event) : false;
      }) || (family !== 'recovered' && isCorrelatableCustomer(item.customerReference)
        && item.customerReference === event.customerReference
        && Boolean(item.paymentMethod)
        && item.paymentMethod === event.paymentMethod
        && Math.abs(Date.parse(item.latestEventAt) - Date.parse(event.occurredAt)) < 15 * 60 * 1_000));
    if (family === 'recovered') {
      if (!related) return undefined;
      const updated = cloneIncident(related);
      attachEvent(updated, event.eventId);
      updated.recoveredAmountPaise = Math.min(updated.amountAtRiskPaise, updated.recoveredAmountPaise + (event.amountPaise ?? 0));
      const recovery = recoveredStatus(updated, updated.recoveredAmountPaise);
      updated.status = recovery.status;
      updated.updatedAt = new Date().toISOString();
      updated.latestEventAt = latestTimestamp(updated.latestEventAt, event.occurredAt);
      updated.summary = recovery.fullyRecovered ? 'A linked verified Razorpay payment success resolved this incident.' : 'A linked verified payment success was observed, but the remaining amount still needs review.';
      await this.persistIncident(updated, { actor: 'system', action: recovery.fullyRecovered ? 'incident_recovered' : 'incident_recovery_observed', detail: recovery.fullyRecovered ? `Recovered by ${event.eventType} (${event.eventId}).` : `${event.eventType} (${event.eventId}) reduced or could not verify the full amount at risk.` });
      incidents.set(updated.incidentId, updated);
      return updated;
    }
    const type = incidentType(event.eventType);
    if (!type) return undefined;
    if (related) {
      const updated = cloneIncident(related);
      attachEvent(updated, event.eventId);
      updated.amountAtRiskPaise += event.amountPaise ?? 0;
      updated.severity = severity(updated.incidentType, updated.amountAtRiskPaise, updated.eventCount);
      updated.updatedAt = new Date().toISOString();
      updated.latestEventAt = latestTimestamp(updated.latestEventAt, event.occurredAt);
      updated.summary = `${updated.eventCount} verified risk events are grouped for review.`;
      await this.persistIncident(updated, { actor: 'system', action: 'incident_updated', detail: `${event.eventType} (${event.eventId}) joined the incident.` });
      incidents.set(updated.incidentId, updated);
      this.scheduleInvestigation(updated.incidentId);
      return updated;
    }
    if (incidents.size >= MAX_INCIDENTS) incidents.delete(incidents.keys().next().value!);
    const now = new Date().toISOString();
    const earlierRecovery = [...events.values()].find(candidate => candidate.eventId !== event.eventId && eventFamily(candidate.eventType) === 'recovered' && recoveryResolvesRisk(candidate, event));
    const amountAtRiskPaise = event.amountPaise ?? 0;
    const recoveredAmountPaise = Math.min(amountAtRiskPaise, earlierRecovery?.amountPaise ?? 0);
    const recovery = earlierRecovery ? recoveredStatus({ amountAtRiskPaise, status: 'needs_review' }, recoveredAmountPaise) : undefined;
    const created: PaymentOpsIncident = { incidentId: `inc_${randomUUID()}`, incidentType: type, status: recovery?.status ?? 'needs_review', severity: severity(type, amountAtRiskPaise), title: titleFor(type), customerReference: event.customerReference, paymentMethod: event.paymentMethod, currency: event.currency, amountAtRiskPaise, recoveredAmountPaise, eventIds: earlierRecovery ? [event.eventId, earlierRecovery.eventId] : [event.eventId], eventCount: earlierRecovery ? 2 : 1, summary: recovery?.fullyRecovered ? 'A linked verified payment success had already resolved this incident.' : earlierRecovery ? 'A linked verified payment success was already observed, but the remaining amount still needs review.' : `A verified Razorpay ${event.eventType} event needs operator review.`, createdAt: now, updatedAt: now, latestEventAt: earlierRecovery ? latestTimestamp(event.occurredAt, earlierRecovery.occurredAt) : event.occurredAt };
    await this.persistIncident(created, { actor: 'system', action: recovery?.fullyRecovered ? 'incident_created_recovered' : earlierRecovery ? 'incident_created_recovery_observed' : 'incident_created', detail: recovery?.fullyRecovered ? `Opened from ${event.eventType} (${event.eventId}) and resolved by ${earlierRecovery?.eventType} (${earlierRecovery?.eventId}).` : earlierRecovery ? `Opened from ${event.eventType} (${event.eventId}) with an observed ${earlierRecovery.eventType} (${earlierRecovery.eventId}).` : `Opened from ${event.eventType} (${event.eventId}).` });
    incidents.set(created.incidentId, created);
    if (!recovery?.fullyRecovered) this.scheduleInvestigation(created.incidentId);
    return created;
  }

  static async investigate(incidentId: string): Promise<Investigation> {
    const scheduled = scheduledInvestigationTimers.get(incidentId);
    if (scheduled) { clearTimeout(scheduled); scheduledInvestigationTimers.delete(incidentId); }
    const previous = inFlightInvestigations.get(incidentId);
    if (previous) return previous;
    const run = this.performInvestigation(incidentId);
    inFlightInvestigations.set(incidentId, run);
    const expiry = setTimeout(() => { if (inFlightInvestigations.get(incidentId) === run) inFlightInvestigations.delete(incidentId); }, 30_000);
    expiry.unref();
    try { return await run; } finally {
      clearTimeout(expiry);
      if (inFlightInvestigations.get(incidentId) === run) inFlightInvestigations.delete(incidentId);
      if (investigationRefreshNeeded.delete(incidentId)) this.scheduleInvestigation(incidentId);
    }
  }

  private static async performInvestigation(incidentId: string): Promise<Investigation> {
    await this.initialize();
    const incident = incidents.get(incidentId);
    if (!incident) throw new AppError('INCIDENT_NOT_FOUND', 404, 'The incident was not found');
    const startedAt = new Date().toISOString();
    const facts = this.investigationFacts(incident);
    let run: Investigation;
    try { run = await this.modelInvestigation(incident, facts, startedAt) ?? this.ruleInvestigation(incident, facts, startedAt); }
    catch (error) { run = this.ruleInvestigation(incident, facts, startedAt, error instanceof Error ? error.message : 'Model investigation unavailable'); }
    const result = await this.enqueueMutation(async () => {
      const latest = incidents.get(incidentId);
      if (!latest) throw new AppError('INCIDENT_NOT_FOUND', 404, 'The incident was not found');
      const updated = cloneIncident(latest);
      updated.agentRun = run;
      updated.actionProposal = run.recommendedAction;
      updated.severity = run.severity;
      updated.updatedAt = new Date().toISOString();
      await this.persistIncidentWithInvestigation(updated, run, { actor: 'agent', action: 'investigation_completed', detail: `${run.provider} investigation completed with ${Math.round(run.confidence * 100)}% confidence.` });
      incidents.set(updated.incidentId, updated);
      return run;
    });
    const postIncident = incidents.get(incidentId);
    if (postIncident) void this.tryAutoExecute(postIncident, result).catch(err => console.error('[PaymentOps] auto-policy failed', err instanceof Error ? err.message : String(err)));
    return result;
  }

  private static investigationFacts(incident: PaymentOpsIncident): { events: PaymentOpsEvent[]; failedPayments: number; unresolvedAmountPaise: number; recoveredAmountPaise: number } {
    const relatedEvents = incident.eventIds.slice(0, MAX_FACT_EVENTS).map(eventId => events.get(eventId)).filter((event): event is PaymentOpsEvent => Boolean(event));
    return { events: relatedEvents, failedPayments: relatedEvents.filter(event => event.eventType === 'payment.failed').length, unresolvedAmountPaise: Math.max(0, incident.amountAtRiskPaise - incident.recoveredAmountPaise), recoveredAmountPaise: incident.recoveredAmountPaise };
  }

  private static scheduleInvestigation(incidentId: string): void {
    if (inFlightInvestigations.has(incidentId)) { investigationRefreshNeeded.add(incidentId); return; }
    const existing = scheduledInvestigationTimers.get(incidentId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      scheduledInvestigationTimers.delete(incidentId);
      const incident = incidents.get(incidentId);
      if (!incident || ['recovered', 'dismissed'].includes(incident.status)) return;
      void this.investigate(incidentId).catch(error => {
        console.error(`[PaymentOps] investigation failed for ${incidentId}`, error instanceof Error ? error.message : 'unknown error');
      });
    }, 300);
    timer.unref();
    scheduledInvestigationTimers.set(incidentId, timer);
  }

  private static ruleInvestigation(incident: PaymentOpsIncident, facts: ReturnType<typeof this.investigationFacts>, startedAt: string, modelError?: string): Investigation {
    const action = incident.incidentType === 'payment_dispute' ? 'escalate' : incident.incidentType === 'subscription_risk' ? 'prepare_follow_up' : facts.recoveredAmountPaise ? 'monitor' : 'review_payment_method';
    const actionRationale = action === 'escalate' ? 'A dispute requires a finance owner to review the documented evidence and response deadline.' : action === 'prepare_follow_up' ? 'The subscription state indicates that the customer may need a payment-method or renewal follow-up.' : action === 'monitor' ? 'At least one later success was observed; monitor remaining unresolved attempts before outreach.' : 'Review payment method and failure context before preparing an operator-approved customer follow-up.';
    const completedAt = new Date().toISOString();
    return { runId: `run_${randomUUID()}`, incidentId: incident.incidentId, status: 'completed', provider: 'rules-v1', startedAt, completedAt, incidentSummary: `${incident.eventCount} verified event${incident.eventCount === 1 ? '' : 's'} created a ${incident.severity} ${incident.incidentType.replace(/_/g, ' ')} incident.`, severity: severity(incident.incidentType, facts.unresolvedAmountPaise, incident.eventCount), confidence: modelError ? 0.72 : 0.86, evidenceEventIds: facts.events.map(event => event.eventId), observedPattern: `Events are correlated by Razorpay payment, order, subscription, or a 15-minute payment-method window. ${facts.recoveredAmountPaise ? 'A later verified payment success was observed.' : 'No linked recovery event has been observed.'}`, impact: { failedPayments: facts.failedPayments, unresolvedAmountPaise: facts.unresolvedAmountPaise, recoveredAmountPaise: facts.recoveredAmountPaise }, recommendedAction: { type: action, rationale: actionRationale, requiresHumanApproval: true }, missingContext: ['Customer support history is not connected.', 'No external outreach was sent by this system.'], errorMessage: modelError };
  }

  private static async modelInvestigation(incident: PaymentOpsIncident, facts: ReturnType<typeof this.investigationFacts>, startedAt: string): Promise<Investigation | undefined> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return undefined;
    const schema = { type: 'object', additionalProperties: false, required: ['incidentSummary', 'severity', 'confidence', 'evidenceEventIds', 'observedPattern', 'recommendedAction', 'missingContext'], properties: { incidentSummary: { type: 'string', maxLength: 700 }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidenceEventIds: { type: 'array', maxItems: 30, items: { type: 'string' } }, observedPattern: { type: 'string', maxLength: 900 }, recommendedAction: { type: 'object', additionalProperties: false, required: ['type', 'rationale', 'requiresHumanApproval'], properties: { type: { type: 'string', enum: ['review_payment_method', 'prepare_follow_up', 'escalate', 'monitor'] }, rationale: { type: 'string', maxLength: 700 }, requiresHumanApproval: { type: 'boolean', const: true } } }, missingContext: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 300 } } } };
    const input = { incident: { id: incident.incidentId, type: incident.incidentType, status: incident.status, amountAtRiskPaise: incident.amountAtRiskPaise, recoveredAmountPaise: incident.recoveredAmountPaise, eventCount: incident.eventCount }, facts: { failedPayments: facts.failedPayments, unresolvedAmountPaise: facts.unresolvedAmountPaise, recoveredAmountPaise: facts.recoveredAmountPaise, events: facts.events.map(event => ({ eventId: event.eventId, type: event.eventType, occurredAt: event.occurredAt, amountPaise: event.amountPaise, status: event.paymentStatus, method: event.paymentMethod })) } };
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini', instructions: 'You are a payment-operations investigator. Use only the provided facts. Never invent an event, monetary value, customer fact, or performed action. Recommend only a human-approved next step. Return JSON matching the schema.', input: JSON.stringify(input), text: { format: { type: 'json_schema', name: 'payment_ops_investigation', strict: true, schema } } }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new AppError('AI_INVESTIGATION_FAILED', 502, 'The AI investigation provider could not complete the run');
    const payload = record(await response.json());
    const output = text(payload.output_text);
    let parsed: UnknownRecord;
    try { parsed = record(JSON.parse(output)); } catch { throw new AppError('AI_INVESTIGATION_FAILED', 502, 'The AI investigation provider returned invalid structured output'); }
    const evidenceEventIds = Array.isArray(parsed.evidenceEventIds) ? parsed.evidenceEventIds.filter((value): value is string => typeof value === 'string' && facts.events.some(event => event.eventId === value)).slice(0, 30) : [];
    const recommendation = record(parsed.recommendedAction);
    const actionType = text(recommendation.type) as Investigation['recommendedAction']['type'];
    if (evidenceEventIds.length === 0 || !['critical', 'high', 'medium', 'low'].includes(text(parsed.severity)) || !['review_payment_method', 'prepare_follow_up', 'escalate', 'monitor'].includes(actionType) || recommendation.requiresHumanApproval !== true) throw new AppError('AI_INVESTIGATION_FAILED', 502, 'The AI investigation output failed evidence validation');
    const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;
    const completedAt = new Date().toISOString();
    return { runId: `run_${randomUUID()}`, incidentId: incident.incidentId, status: 'completed', provider: 'model', startedAt, completedAt, incidentSummary: text(parsed.incidentSummary).slice(0, 700), severity: text(parsed.severity) as Severity, confidence, evidenceEventIds, observedPattern: text(parsed.observedPattern).slice(0, 900), impact: { failedPayments: facts.failedPayments, unresolvedAmountPaise: facts.unresolvedAmountPaise, recoveredAmountPaise: facts.recoveredAmountPaise }, recommendedAction: { type: actionType, rationale: text(recommendation.rationale).slice(0, 700), requiresHumanApproval: true }, missingContext: Array.isArray(parsed.missingContext) ? parsed.missingContext.filter((value): value is string => typeof value === 'string').map(value => value.slice(0, 300)).slice(0, 10) : [] };
  }

  static dashboard(): PaymentOpsDashboard {
    const allEvents = [...events.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const allIncidents = [...incidents.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const successfulReferences = new Set<string>();
    const capturedVolumePaise = allEvents
      .filter(event => ['payment.captured', 'order.paid'].includes(event.eventType))
      .reduce((sum, event) => {
        const reference = event.paymentId ? `payment:${event.paymentId}` : event.orderId ? `order:${event.orderId}` : `event:${event.eventId}`;
        if (successfulReferences.has(reference)) return sum;
        successfulReferences.add(reference);
        return sum + (event.amountPaise ?? 0);
      }, 0);
    const open = allIncidents.filter(incident => ['needs_review', 'monitoring', 'escalated'].includes(incident.status));
    return { generatedAt: new Date().toISOString(), environment: this.connectionStatus().environment, capturedVolumePaise, failedAmountAtRiskPaise: open.reduce((sum, incident) => sum + Math.max(0, incident.amountAtRiskPaise - incident.recoveredAmountPaise), 0), recoveredAmountPaise: allIncidents.reduce((sum, incident) => sum + incident.recoveredAmountPaise, 0), openIncidentCount: open.length, completedInvestigations: allIncidents.filter(incident => incident.agentRun?.status === 'completed').length, eventWindow: { loadedEventCount: allEvents.length, earliestOccurredAt: allEvents.at(-1)?.occurredAt, latestOccurredAt: allEvents[0]?.occurredAt }, recentEvents: allEvents.slice(0, 12).map(publicEvent), attentionIncidents: open.slice(0, 6) };
  }

  static listIncidents(status?: IncidentStatus): PaymentOpsIncident[] { return [...incidents.values()].filter(incident => !status || incident.status === status).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  static listEvents(): PaymentOpsEventSummary[] { return [...events.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 200).map(publicEvent); }
  static incidentDetail(incidentId: string): { incident: PaymentOpsIncident; events: PaymentOpsEventSummary[]; audit: IncidentAuditEntry[] } { const incident = incidents.get(incidentId); if (!incident) throw new AppError('INCIDENT_NOT_FOUND', 404, 'The incident was not found'); return { incident, events: incident.eventIds.map(eventId => events.get(eventId)).filter((event): event is PaymentOpsEvent => Boolean(event)).map(publicEvent), audit: audits.get(incidentId) ?? [] }; }

  static async recordAction(incidentId: string, type: ActionType, operator: string): Promise<PaymentOpsIncident> {
    return this.enqueueMutation(async () => {
      const incident = incidents.get(incidentId);
      if (!incident) throw new AppError('INCIDENT_NOT_FOUND', 404, 'The incident was not found');
      if (['recovered', 'dismissed'].includes(incident.status)) throw new AppError('INCIDENT_ACTION_NOT_ALLOWED', 409, 'This incident is no longer actionable');
      const now = new Date().toISOString();
      const safeOperator = text(operator, 'Payment operations admin') || 'Payment operations admin';
      const updated = cloneIncident(incident);
      updated.operatorAction = { actionId: `act_${randomUUID()}`, type, operator: safeOperator, approvedAt: now };
      updated.status = type === 'dismiss' ? 'dismissed' : type === 'escalate' ? 'escalated' : 'monitoring';
      updated.updatedAt = now;
      await this.persistIncident(updated, { actor: 'operator', action: `operator_${type}`, detail: type === 'dismiss' ? 'Operator dismissed the incident. No financial action was taken.' : `Operator approved ${type.replace(/_/g, ' ')}. No financial action was taken.` });
      incidents.set(updated.incidentId, updated);
      return updated;
    });
  }

  static async importPaymentHistory(days: number, skip = 0): Promise<HistoryImportResult> {
    await this.initialize();
    if (!Number.isInteger(days) || days < 1 || days > 365 || !Number.isInteger(skip) || skip < 0 || skip > 100_000) throw new AppError('INVALID_HISTORY_REQUEST', 422, 'Choose a history range between 1 and 365 days and a valid continuation');
    if (activeImport) { if (activeImport.days === days && activeImport.skip === skip) return activeImport.request; throw new AppError('HISTORY_IMPORT_IN_PROGRESS', 409, 'Another Razorpay history import is already running'); }
    const request = this.importHistoryOnce(days, skip);
    activeImport = { days, skip, request };
    try { return await request; } finally { if (activeImport?.request === request) activeImport = undefined; }
  }

  private static async importHistoryOnce(days: number, skip: number): Promise<HistoryImportResult> {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim(); const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) throw new AppError('RAZORPAY_HISTORY_NOT_CONFIGURED', 503, 'Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server before importing history');
    let paymentsScanned = 0; let eventsImported = 0; let incidentsCreated = 0; let hasMore = false;
    const from = Math.floor((Date.now() - days * 86_400_000) / 1_000); const to = Math.floor(Date.now() / 1_000);
    for (let batch = 0; batch < HISTORY_BATCHES; batch += 1) {
      const offset = skip + batch * HISTORY_PAGE_SIZE;
      const url = new URL('https://api.razorpay.com/v1/payments'); url.searchParams.set('from', String(from)); url.searchParams.set('to', String(to)); url.searchParams.set('count', String(HISTORY_PAGE_SIZE)); url.searchParams.set('skip', String(offset));
      let response: Response;
      try { response = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}` }, signal: AbortSignal.timeout(RAZORPAY_API_TIMEOUT_MS) }); } catch { throw new AppError('RAZORPAY_HISTORY_IMPORT_FAILED', 502, 'Razorpay payment history could not be retrieved'); }
      const bodyText = await response.text().catch(() => '');
      if (!response.ok || Buffer.byteLength(bodyText, 'utf8') > 1_000_000) throw new AppError('RAZORPAY_HISTORY_IMPORT_FAILED', 502, 'Razorpay payment history could not be retrieved safely');
      let items: unknown[];
      try { const responseBody = record(JSON.parse(bodyText)); items = Array.isArray(responseBody.items) ? responseBody.items : []; } catch { throw new AppError('RAZORPAY_HISTORY_IMPORT_FAILED', 502, 'Razorpay returned invalid payment history'); }
      for (const item of items.slice(0, HISTORY_PAGE_SIZE)) {
        const payment = record(item); const paymentId = text(payment.id); const status = text(payment.status).toLowerCase(); if (!paymentId) continue;
        paymentsScanned += 1;
        const type = status === 'failed' ? 'payment.failed' : status === 'captured' ? 'payment.captured' : status === 'authorized' ? 'payment.authorized' : '';
        if (!type) continue;
        const eventId = `history:${paymentId}:${type}`;
        const result = await this.ingestWebhook({ event: type, created_at: payment.created_at, payload: { payment: { entity: payment } }, history_import: true }, eventId, 'history_import');
        if (!result.duplicate) { eventsImported += 1; if (result.incident?.eventCount === 1) incidentsCreated += 1; }
      }
      if (items.length < HISTORY_PAGE_SIZE) return { paymentsScanned, eventsImported, incidentsCreated, hasMore: false };
      hasMore = true;
    }
    return { paymentsScanned, eventsImported, incidentsCreated, hasMore, nextSkip: skip + HISTORY_BATCHES * HISTORY_PAGE_SIZE };
  }

  private static incidentForEvent(eventId: string): PaymentOpsIncident | undefined { return [...incidents.values()].find(incident => incident.eventIds.includes(eventId)); }
  private static rememberEvent(event: PaymentOpsEvent): void {
    if (events.size >= MAX_EVENTS) {
      const protectedEventIds = new Set([...incidents.values()].filter(incident => !['dismissed', 'recovered'].includes(incident.status)).flatMap(incident => incident.eventIds));
      const evictionCandidate = [...events.keys()].find(eventId => !protectedEventIds.has(eventId)) ?? events.keys().next().value;
      if (evictionCandidate) events.delete(evictionCandidate);
    }
    events.set(event.eventId, event);
  }
  private static rememberAudit(entry: IncidentAuditEntry, prepend = true): void { const current = audits.get(entry.incidentId) ?? []; const next = prepend ? [entry, ...current] : [...current, entry]; audits.set(entry.incidentId, next.slice(0, 50)); if (audits.size > MAX_AUDIT_ENTRIES) audits.delete(audits.keys().next().value!); }
  private static auditEntry(incident: PaymentOpsIncident, audit: Omit<IncidentAuditEntry, 'auditId' | 'incidentId' | 'at'>): IncidentAuditEntry { return { auditId: `aud_${randomUUID()}`, incidentId: incident.incidentId, at: new Date().toISOString(), ...audit }; }
  private static async persistIncident(incident: PaymentOpsIncident, audit: Omit<IncidentAuditEntry, 'auditId' | 'incidentId' | 'at'>): Promise<void> { const entry = this.auditEntry(incident, audit); await repository.persistIncidentWithAudit(incident, entry); this.rememberAudit(entry); }
  private static async persistIncidentWithInvestigation(incident: PaymentOpsIncident, investigation: Investigation, audit: Omit<IncidentAuditEntry, 'auditId' | 'incidentId' | 'at'>): Promise<void> { const entry = this.auditEntry(incident, audit); await repository.persistInvestigationWithIncidentAndAudit(incident, investigation, entry); this.rememberAudit(entry); }
}
