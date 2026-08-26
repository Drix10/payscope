import { createHash, createHmac, randomUUID } from 'crypto';
import { AppError, Incident, IncidentStatus, NormalizedEvent, NormalizedEventSchema, RiskTier, VulcanEnrichment } from '../domain/contracts';
import { RECOVERY_WINDOW_MS } from '../config/config';
import { replanIncidentStrategy } from '../intelligence/recovery-engine';

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown, max = 160): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function currency(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[a-z]{3}$/i.test(value.trim())) return undefined;
  return value.trim().toUpperCase();
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  const seconds = number(value);
  if (seconds === undefined) return undefined;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function isPayScopeDisputeOpeningEvent(eventType: string): boolean {
  return ['payment.dispute.created', 'payment.dispute.under_review', 'payment.dispute.action_required'].includes(eventType);
}

export function canCorrelateWithTerminalIncident(eventType: string): boolean {
  return isPayScopeDisputeOpeningEvent(eventType) || ['payment.captured', 'payment_link.paid', 'order.paid'].includes(eventType);
}

export function razorpayWebhookEventType(rawBody: Buffer): string {
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody.toString('utf8')); } catch { throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook body must be valid JSON'); }
  const eventType = text(object(parsed).event, 120);
  if (!eventType) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook event type is required');
  return eventType;
}

function hashCustomer(customerReference: string | undefined, customerHashSecret: string): string | undefined {
  if (!customerReference) return undefined;
  return createHmac('sha256', customerHashSecret).update(customerReference.trim().toLowerCase()).digest('hex');
}

export function rawPayloadHash(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

export function normalizeRazorpayWebhook(rawBody: Buffer, razorpayEventId: string, customerHashSecret: string, receivedAt = new Date().toISOString()): NormalizedEvent {
  if (!razorpayEventId.trim() || razorpayEventId.length > 160) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook event ID is required');
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody.toString('utf8')); } catch { throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook body must be valid JSON'); }
  const envelope = object(parsed);
  const payload = object(envelope.payload);
  const payment = object(object(payload.payment).entity);
  const order = object(object(payload.order).entity);
  const subscription = object(object(payload.subscription).entity);
  const paymentLink = object(object(payload.payment_link).entity);
  const eventType = razorpayWebhookEventType(rawBody);
  const occurredAt = timestamp(payment.created_at) ?? timestamp(order.created_at) ?? timestamp(subscription.created_at) ?? timestamp(paymentLink.created_at) ?? timestamp(envelope.created_at);
  if (!occurredAt) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook event timestamp is required');
  const customerReference = text(payment.customer_id) ?? text(order.customer_id) ?? text(subscription.customer_id) ?? text(paymentLink.customer_id);
  const providerData: UnknownRecord = {};
  for (const key of ['error_source', 'error_step', 'error_reason', 'error_code', 'attempts', 'international']) {
    const value = payment[key] ?? payload[key] ?? envelope[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') providerData[key] = value;
  }
  const orderAmountPaise = number(order.amount);
  if (orderAmountPaise !== undefined) providerData.order_amount_paise = orderAmountPaise;
  const paymentLinkReferenceId = text(paymentLink.reference_id);
  if (paymentLinkReferenceId && /^ps[_:]/i.test(paymentLinkReferenceId)) providerData.payment_link_reference_id = paymentLinkReferenceId;
  const acquirerData = allowlistedAcquirerData(object(payment.acquirer_data));
  if (Object.keys(acquirerData).length) providerData.acquirer_data = acquirerData;
  return NormalizedEventSchema.parse({
    eventId: razorpayEventId.trim(),
    eventType,
    occurredAt,
    receivedAt,
    paymentId: text(payment.id),
    orderId: text(payment.order_id) ?? text(order.id) ?? text(paymentLink.order_id),
    subscriptionId: text(payment.subscription_id) ?? text(subscription.id),
    customerHash: hashCustomer(customerReference, customerHashSecret),
    currency: currency(payment.currency) ?? currency(order.currency) ?? currency(paymentLink.currency),
    amountPaise: number(payment.amount) ?? number(order.amount) ?? number(paymentLink.amount),
    paymentStatus: text(payment.status, 80) ?? text(order.status, 80) ?? text(paymentLink.status, 80),
    paymentMethod: text(payment.method, 80),
    providerData,
  });
}

function allowlistedAcquirerData(input: UnknownRecord): UnknownRecord {
  const allowed = ['rrn', 'auth_code', 'reference_number', 'transaction_id'];
  const result: UnknownRecord = {};
  for (const key of allowed) {
    const value = input[key];
    if (typeof value === 'string' && value.length <= 160) result[key] = value;
  }
  return result;
}

export type CorrelationEvent = {
  id: string;
  event: NormalizedEvent;
  enrichment: VulcanEnrichment | null;
};

export type IncidentCandidate = { incident: Incident; events: CorrelationEvent[] };
export type CorrelationResult = { incident: Incident; created: boolean; stateChanged: boolean; reason: string } | undefined;

const TERMINAL = new Set<IncidentStatus>(['RESOLVED', 'DISMISSED', 'DISPUTE_OPENED']);

export function correlateEvent(
  incoming: CorrelationEvent,
  candidates: IncidentCandidate[],
  organizationId: string,
  createId: () => string = randomUUID,
): CorrelationResult {
  const canMatchTerminal = isPayScopeDisputeOpeningEvent(incoming.event.eventType) || recoveryEvent(incoming.event.eventType);
  const matched = candidates.find(candidate => (canMatchTerminal || !TERMINAL.has(candidate.incident.status)) && related(incoming.event, candidate.events.map(row => row.event)));
  const shouldOpen = riskEvent(incoming.event.eventType);
  if (!matched && !shouldOpen) return undefined;
  if (!matched) return { incident: openIncident(incoming, organizationId, createId()), created: true, stateChanged: true, reason: 'risk_event_opened_incident' };

  const previous = matched.incident;
  const ids = previous.correlatedEventIds.includes(incoming.id) ? previous.correlatedEventIds : [...previous.correlatedEventIds, incoming.id].slice(-100);
  const base: Incident = { ...previous, correlatedEventIds: ids, updatedAt: incoming.event.receivedAt };
  if (isPayScopeDisputeOpeningEvent(incoming.event.eventType)) {
    return { incident: { ...base, riskTier: 'CRITICAL', status: 'DISPUTE_OPENED' }, created: false, stateChanged: previous.status !== 'DISPUTE_OPENED', reason: 'dispute_opened' };
  }
  if (recoveryEvent(incoming.event.eventType)) return applyRecovery(base, incoming);
  if (riskEvent(incoming.event.eventType)) {
    const amount = incoming.event.amountPaise ?? 0;
    const totalFailedAmountPaise = safeAdd(base.totalFailedAmountPaise, amount);
    const recoveredAmountPaise = Math.min(base.recoveredAmountPaise, totalFailedAmountPaise);
    return {
      incident: {
        ...base,
        riskTier: maximumRiskTier(base.riskTier, riskTierFor(incoming)),
        status: base.status === 'MONITORING' ? 'OPEN' : base.status,
        totalFailedAmountPaise,
        recoveredAmountPaise,
        remainingAmountPaise: totalFailedAmountPaise - recoveredAmountPaise,
      },
      created: false,
      stateChanged: true,
      reason: 'linked_risk_event',
    };
  }
  return { incident: base, created: false, stateChanged: false, reason: 'linked_context_event' };
}

function openIncident(incoming: CorrelationEvent, organizationId: string, id: string): Incident {
  const amount = incoming.event.amountPaise ?? 0;
  return {
    id,
    organizationId,
    riskTier: riskTierFor(incoming),
    status: isPayScopeDisputeOpeningEvent(incoming.event.eventType) ? 'DISPUTE_OPENED' : 'OPEN',
    totalFailedAmountPaise: amount,
    recoveredAmountPaise: 0,
    remainingAmountPaise: amount,
    correlatedEventIds: [incoming.id],
    openedAt: incoming.event.occurredAt,
    resolvedAt: null,
    updatedAt: incoming.event.receivedAt,
  };
}

function applyRecovery(incident: Incident, incoming: CorrelationEvent): CorrelationResult {
  const occurredAt = Date.parse(incoming.event.occurredAt);
  const openedAt = Date.parse(incident.openedAt);
  const withinRecoveryWindow = Number.isFinite(occurredAt) && Number.isFinite(openedAt) && occurredAt >= openedAt && occurredAt - openedAt <= RECOVERY_WINDOW_MS;
  if (!withinRecoveryWindow) return { incident, created: false, stateChanged: false, reason: 'recovery_outside_window_or_precedes_risk' };
  const recoverable = Math.min(incoming.event.amountPaise ?? 0, incident.remainingAmountPaise);
  if (recoverable <= 0) return { incident, created: false, stateChanged: false, reason: 'recovery_has_no_amount' };
  const recoveredAmountPaise = incident.recoveredAmountPaise + recoverable;
  const remainingAmountPaise = incident.totalFailedAmountPaise - recoveredAmountPaise;
  const resolved = remainingAmountPaise === 0;
  return {
    incident: {
      ...incident,
      recoveredAmountPaise,
      remainingAmountPaise,
      status: resolved ? 'RESOLVED' : 'MONITORING',
      resolvedAt: resolved ? incoming.event.occurredAt : null,
    },
    created: false,
    stateChanged: true,
    reason: resolved ? 'full_recovery' : 'partial_recovery',
  };
}

function related(event: NormalizedEvent, priorEvents: NormalizedEvent[]): boolean {
  return priorEvents.some(prior => {
    if (event.paymentId && event.paymentId === prior.paymentId) return true;
    if (event.orderId && event.orderId === prior.orderId) return true;
    if (event.subscriptionId && event.subscriptionId === prior.subscriptionId) return true;
    if (!event.customerHash || event.customerHash !== prior.customerHash) return false;
    const distance = Math.abs(Date.parse(event.occurredAt) - Date.parse(prior.occurredAt));
    return Number.isFinite(distance) && distance <= 15 * 60 * 1_000;
  });
}

function riskEvent(eventType: string): boolean {
  return eventType === 'payment.failed' || isPayScopeDisputeOpeningEvent(eventType);
}

function recoveryEvent(eventType: string): boolean {
  return eventType === 'payment.captured' || eventType === 'payment_link.paid' || eventType === 'order.paid';
}

function riskTierFor(incoming: CorrelationEvent): RiskTier {
  if (isPayScopeDisputeOpeningEvent(incoming.event.eventType)) return 'CRITICAL';
  if (incoming.enrichment?.failureAttribution === 'fraud_block' || incoming.enrichment?.crossBorderFlag) return 'HIGH';
  if (incoming.enrichment?.gatewayHealthScore !== undefined && incoming.enrichment.gatewayHealthScore < 0.3) return 'MONITOR';
  return 'MEDIUM';
}

function maximumRiskTier(left: RiskTier, right: RiskTier): RiskTier {
  const score: Record<RiskTier, number> = { MONITOR: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  return score[left] >= score[right] ? left : right;
}

function safeAdd(left: number, right: number): number {
  if (right > Number.MAX_SAFE_INTEGER - left) throw new Error('Incident amount exceeds the safe integer limit');
  return left + right;
}

export async function receiveWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  eventIdHeader: string | undefined,
  repository: any,
  config: { webhookSecret?: string; previousWebhookSecret?: string; organizationId?: string }
): Promise<{ duplicate: boolean; ignored: boolean; eventId: string }> {
  if (!config.webhookSecret || !config.organizationId) throw new AppError('PIPELINE_NOT_CONFIGURED', 503, 'Webhook secret or organization ID not configured');
  if (!signatureHeader) throw new AppError('INVALID_RAZORPAY_SIGNATURE', 400, 'x-razorpay-signature header is required');
  if (!eventIdHeader) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'x-razorpay-event-id header is required');

  const secret = config.webhookSecret;
  const computed = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (computed !== signatureHeader.trim()) throw new AppError('INVALID_RAZORPAY_SIGNATURE', 400, 'x-razorpay-signature header is invalid');

  const normalized = normalizeRazorpayWebhook(rawBody, eventIdHeader, secret);
  const result = await repository.recordWebhookIntake(config.organizationId, rawBody, normalized);
  
  if (result.incidentId && (normalized.eventType === 'payment.failed' || normalized.eventType === 'payment_link.expired')) {
    await handleIncidentAdaptiveLifecycle(repository, config.organizationId, result.incidentId, 'linked_risk_event').catch(() => null);
  }

  return { duplicate: result.duplicate, ignored: false, eventId: result.eventId };
}

export async function handleIncidentAdaptiveLifecycle(
  repository: any,
  organizationId: string,
  incidentId: string,
  eventReason: string
): Promise<{ adapted: boolean; actionId: string | null }> {
  if (['linked_risk_event', 'recovery_failed', 'payment_link_expired'].includes(eventReason)) {
    const res = await replanIncidentStrategy(repository, organizationId, incidentId, eventReason);
    return { adapted: res.adaptedStrategy !== null, actionId: res.actionId };
  }
  return { adapted: false, actionId: null };
}
