import type { ActionProposal } from '../domain/contracts';

const ATTRIBUTABLE_ACTIONS = new Set<ActionProposal['actionType']>([
  'deliver_recovery_link_email',
]);
const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type AttributionProposal = {
  id: string;
  incidentId: string;
  actionType: ActionProposal['actionType'];
  status: 'simulated' | 'pending' | 'cancelled_by_dispute' | 'cancelled_by_recovery' | 'failed';
  simulatedAt: string | null;
};
export type AttributionIncident = { id: string; totalFailedAmountPaise: number };
export type CapturedPayment = {
  eventId: string;
  incidentId: string | null;
  capturedAt: string;
  amountPaise: number;
  paymentLinkReferenceId: string | null;
  disputeOpenedBeforeCapture: boolean;
};
export type AttributedRecovery = { eventId: string; proposalId: string; incidentId: string; recoveredPaise: number };

/**
 * Produces causal recovery evidence only when all four locked conditions
 * hold: a simulated recovery action, captured payment within 24h,
 * and either its proposal-bound Payment Link reference or incident correlation.
 */
export function attributeRecoveries(
  incidents: readonly AttributionIncident[],
  proposals: readonly AttributionProposal[],
  capturedPayments: readonly CapturedPayment[],
): AttributedRecovery[] {
  const incidentById = new Map(incidents.map(incident => {
    assertPaise(incident.totalFailedAmountPaise, 'Incident total');
    return [incident.id, incident] as const;
  }));
  const seenEventIds = new Set<string>();
  const candidates = capturedPayments
    .map(payment => {
      if (!payment.eventId || seenEventIds.has(payment.eventId)) throw new Error('Captured payment event IDs must be unique');
      seenEventIds.add(payment.eventId);
      assertPaise(payment.amountPaise, 'Captured payment amount');
      const capturedAt = timestamp(payment.capturedAt, 'Captured payment time');
      if (payment.disputeOpenedBeforeCapture) return null;
      const matches = proposals.filter(proposal => isEligibleProposal(proposal, capturedAt) &&
        (isPaymentLinkReferenceForProposal(payment.paymentLinkReferenceId, proposal.id) || payment.incidentId === proposal.incidentId));
      if (!matches.length) return null;
      // An exact Payment Link reference is stronger than shared incident
      // correlation. One capture can never be counted more than once.
      matches.sort((left, right) => Number(isPaymentLinkReferenceForProposal(payment.paymentLinkReferenceId, right.id)) - Number(isPaymentLinkReferenceForProposal(payment.paymentLinkReferenceId, left.id)) || timestamp(right.simulatedAt!, 'Proposal simulation') - timestamp(left.simulatedAt!, 'Proposal simulation'));
      const proposal = matches[0];
      const incident = incidentById.get(proposal.incidentId);
      if (!incident) throw new Error('Attribution proposal references an unknown incident');
      return { payment, proposal, incident, capturedAt };
    })
    .filter((candidate): candidate is { payment: CapturedPayment; proposal: AttributionProposal; incident: AttributionIncident; capturedAt: number } => candidate !== null)
    .sort((left, right) => left.capturedAt - right.capturedAt || left.payment.eventId.localeCompare(right.payment.eventId));

  const creditedByIncident = new Map<string, number>();
  const recoveries: AttributedRecovery[] = [];
  for (const candidate of candidates) {
    const credited = creditedByIncident.get(candidate.incident.id) ?? 0;
    const remaining = candidate.incident.totalFailedAmountPaise - credited;
    const recoveredPaise = Math.min(candidate.payment.amountPaise, Math.max(remaining, 0));
    if (!recoveredPaise) continue;
    creditedByIncident.set(candidate.incident.id, credited + recoveredPaise);
    recoveries.push({ eventId: candidate.payment.eventId, proposalId: candidate.proposal.id, incidentId: candidate.incident.id, recoveredPaise });
  }
  return recoveries;
}

/** The short reference fits typical provider limits while binding the UUID. Supports both legacy ps: and direct ps_ */
export function paymentLinkReferenceForProposal(proposalId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proposalId)) throw new Error('Proposal ID must be a UUID for payment-link attribution');
  return `ps:${proposalId.toLowerCase()}`;
}
export function paymentLinkReferenceForProposalDirect(proposalId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proposalId)) throw new Error('Proposal ID must be a UUID for payment-link attribution');
  return `ps_${proposalId.toLowerCase().replace(/-/g, '')}`;
}
export function isPaymentLinkReferenceForProposal(reference: string | null, proposalId: string): boolean {
  if (!reference) return false;
  const refLower = reference.toLowerCase();
  return refLower === paymentLinkReferenceForProposal(proposalId) || refLower === paymentLinkReferenceForProposalDirect(proposalId);
}

function isEligibleProposal(proposal: AttributionProposal, capturedAt: number): boolean {
  if (!ATTRIBUTABLE_ACTIONS.has(proposal.actionType) || proposal.status !== 'simulated' || !proposal.simulatedAt) return false;
  const simulatedAt = timestamp(proposal.simulatedAt, 'Proposal simulation');
  return capturedAt >= simulatedAt && capturedAt - simulatedAt <= ATTRIBUTION_WINDOW_MS;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp`);
  return parsed;
}
function assertPaise(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}
