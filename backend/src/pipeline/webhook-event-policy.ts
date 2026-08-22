/**
 * Razorpay may deliver many account, engagement, refund, and notification
 * events to the same endpoint. PayScope only persists events that can safely
 * change its payment-incident state machine. Every other correctly signed
 * event is acknowledged without storing raw data or scheduling a job.
 */
const INCIDENT_EVENT_TYPES = new Set([
  'payment.failed',
  'payment.captured',
  'payment_link.paid',
  'order.paid',
  'payment.dispute.created',
  'payment.dispute.under_review',
  'payment.dispute.action_required',
]);

export function isPayScopeIncidentEvent(eventType: string): boolean {
  return INCIDENT_EVENT_TYPES.has(eventType);
}

export function isPayScopeDisputeOpeningEvent(eventType: string): boolean {
  return eventType === 'payment.dispute.created' || eventType === 'payment.dispute.under_review' || eventType === 'payment.dispute.action_required';
}

/** Events allowed to attach to an already terminal incident for a complete timeline. */
export function canCorrelateWithTerminalIncident(eventType: string): boolean {
  return isPayScopeDisputeOpeningEvent(eventType) || eventType === 'payment.captured' || eventType === 'payment_link.paid' || eventType === 'order.paid';
}
