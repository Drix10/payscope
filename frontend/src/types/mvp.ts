export type IncidentStatus = 'OPEN' | 'MONITORING' | 'ESCALATED' | 'DISPUTE_OPENED' | 'RESOLVED' | 'HUMAN_RESOLVED' | 'DISMISSED'
export type RiskTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'MONITOR'

export type Incident = {
  id: string; organizationId: string; riskTier: RiskTier; status: IncidentStatus
  totalFailedAmountPaise: number; recoveredAmountPaise: number; remainingAmountPaise: number
  correlatedEventIds: string[]; openedAt: string; resolvedAt: string | null; updatedAt: string
}

export type Event = { id: string; organizationId: string; event: { eventType: string; occurredAt: string; receivedAt: string; amountPaise?: number; paymentMethod?: string }; enrichment: { source: string; failureAttribution: string; gatewayHealthScore: number; gatewayInDowntime: boolean; downtimeScheduled: boolean; crossBorderFlag: boolean; priorAttemptCount: number; partialRecoveryPossible: boolean; recommendedRetryMethod: string | null; signalsUsed: string[] } | null; enrichmentSource: 'razorpay_fields_heuristic' | 'fixture_signed' | 'vulcan_direct' | 'unavailable' | null }
export type ProposalStatus = 'pending' | 'approved' | 'simulated' | 'cancelled_by_dispute' | 'cancelled_by_recovery' | 'failed'
export type Proposal = { id: string; organizationId: string; incidentId: string; actionType: string; status: ProposalStatus; proposedAt: string; approvedAt: string | null; approvedBy: string | null; content: Record<string, unknown>; deliveryResult: Record<string, unknown> | null }
export type IncidentDetail = { incident: Incident; events: Event[]; proposals: Proposal[]; investigation: Investigation | null }
export type AuditEntry = { id: string; sequenceNumber: number; eventType: string; actorType: string; decision: string; rationale: string; createdAt: string }
export type MvpHealth = { organizationId: string; pipeline: 'agentic_mvp'; testMode: true; communications: 'proposal_only'; database: 'ready'; queueWorker: 'configured'; webhook: 'signed_test_mode_only'; enrichmentAdapter: 'razorpay_fields_heuristic' }

// Canonical Phase 2+ contracts. A new endpoint must still add its own runtime
// guard in api.ts; these types alone are never trusted browser input.
export type InvestigationStatus = 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED'
export type InvestigationPlan = { hypothesis: string; primaryFailureCategory: 'infrastructure' | 'fraud_suspected' | 'fraud_confirmed' | 'customer_error' | 'subscription_issue' | 'unknown'; subAgents: Array<{ agent: 'risk_analyst' | 'recovery_planner'; question: string; priority: 1 | 2; allowedContextFields: string[] }>; estimatedAutoResolvable: boolean; requiresHumanReview: boolean; confidence: number; reasoning: string }
export type RiskAnalysis = { failureRootCause: string; evidenceStrength: 'strong' | 'moderate' | 'weak'; confidence: number; falsePositiveCostEstimatePaise: number; missingEvidence: string[]; chargebackEvidenceReady: boolean; evidenceItems: string[]; recommendedActionCategory: string }
export type RecoveryPlan = { proposedActions: Array<{ actionType: Proposal['actionType']; rationale: string; estimatedRecoveryPaise: number | null; scriptContent?: string; requiresOperatorApproval: true }>; noActionReason?: string; recoveryProbability: number; confidence: number }
export type PolicyDecision = { outcome: 'auto_with_proposals' | 'auto_no_action' | 'escalate'; permittedActions: RecoveryPlan['proposedActions']; escalationReason: string | null; matchedPolicyId: string | null; gates: Array<{ name: 'fraud' | 'dispute' | 'auto_resolve_ceiling' | 'human_review_floor' | 'critical_tier' | 'contact_limits' | 'merchant_policy'; result: 'passed' | 'blocked' | 'restricted' | 'skipped'; rationale: string }> }
export type Investigation = { id: string; organizationId: string; incidentId: string; status: InvestigationStatus; plan: InvestigationPlan | null; riskAnalysis: RiskAnalysis | null; recoveryPlan: RecoveryPlan | null; policyDecision: PolicyDecision | null; modelId: string | null; tokensUsed: number | null; latencyMs: number | null; startedAt: string; completedAt: string | null }
export type DashboardQuery = { query: string }
export type EvaluationReport = { split: 'development' | 'held_out'; fixtureSetVersion: string; runAt: string; configurationHash: string; modelId: string; sampleCount: number; precision: number | null; recall: number | null; f1: number | null; falsePositiveCostPaise: number; totalAtRiskPaise: number; generatedProposals: number; approvedProposals: number; attributedRecoveryPaise: number; recoveryRate: number | null; contactToRecoveryRatio: number | null; exceptions: string[] }
