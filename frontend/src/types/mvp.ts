export type IncidentStatus = 'OPEN' | 'MONITORING' | 'ESCALATED' | 'DISPUTE_OPENED' | 'RESOLVED' | 'HUMAN_RESOLVED' | 'DISMISSED'
export type RiskTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'MONITOR'

export type Incident = {
  id: string; organizationId: string; riskTier: RiskTier; status: IncidentStatus
  totalFailedAmountPaise: number; recoveredAmountPaise: number; remainingAmountPaise: number
  correlatedEventIds: string[]; openedAt: string; resolvedAt: string | null; updatedAt: string
}

export type Event = { id: string; organizationId: string; event: { eventType: string; occurredAt: string; amountPaise?: number; paymentMethod?: string }; enrichment: { source: string; failureAttribution: string; gatewayHealthScore: number; gatewayInDowntime: boolean } | null }
export type ProposalStatus = 'pending' | 'approved' | 'simulated' | 'cancelled_by_dispute' | 'cancelled_by_recovery' | 'failed'
export type Proposal = { id: string; organizationId: string; incidentId: string; actionType: string; status: ProposalStatus; proposedAt: string; approvedAt: string | null; approvedBy: string | null; content: Record<string, unknown>; deliveryResult: Record<string, unknown> | null }
export type IncidentDetail = { incident: Incident; events: Event[]; proposals: Proposal[] }
export type AuditEntry = { id: string; sequenceNumber: number; eventType: string; actorType: string; decision: string; rationale: string; createdAt: string }
export type MvpHealth = { organizationId: string; pipeline: 'agentic_mvp'; testMode: true; communications: 'proposal_only' }
