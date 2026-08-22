import { randomUUID } from 'crypto';
import { RECOVERY_WINDOW_MS } from '../config/stopping-rules';
import { Incident, IncidentStatus, NormalizedEvent, RiskTier, VulcanEnrichment } from '../domain/contracts';
import { isPayScopeDisputeOpeningEvent } from './webhook-event-policy';

export type CorrelationEvent = {
  id: string;
  event: NormalizedEvent;
  enrichment: VulcanEnrichment | null;
};

export type IncidentCandidate = { incident: Incident; events: CorrelationEvent[] };
export type CorrelationResult = { incident: Incident; created: boolean; stateChanged: boolean; reason: string } | undefined;

const TERMINAL = new Set<IncidentStatus>(['RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED', 'DISPUTE_OPENED']);

/** Deterministic only: no model output can create, resolve, or correlate an incident. */
export function correlateEvent(
  incoming: CorrelationEvent,
  candidates: IncidentCandidate[],
  organizationId: string,
  createId: () => string = randomUUID,
): CorrelationResult {
  // A late capture must still be attached to a terminal incident for a complete
  // timeline, and a dispute may transition any state. Other risk events never
  // reopen terminal incidents.
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
      status: resolved ? 'RESOLVED' : incident.status === 'ESCALATED' ? 'ESCALATED' : 'MONITORING',
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
