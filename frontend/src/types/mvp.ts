export type IncidentStatus = 'OPEN' | 'MONITORING' | 'ESCALATED' | 'DISPUTE_OPENED' | 'RESOLVED' | 'HUMAN_RESOLVED' | 'DISMISSED'
export type RiskTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'MONITOR'

export type Incident = {
  id: string; organizationId: string; riskTier: RiskTier; status: IncidentStatus
  totalFailedAmountPaise: number; recoveredAmountPaise: number; remainingAmountPaise: number
  correlatedEventIds: string[]; openedAt: string; resolvedAt: string | null; updatedAt: string
}

export type Event = { id: string; organizationId: string; event: { eventType: string; occurredAt: string; receivedAt: string; amountPaise?: number; paymentMethod?: string }; enrichment: { source: string; failureAttribution: string; gatewayHealthScore: number; gatewayInDowntime: boolean; downtimeScheduled: boolean; crossBorderFlag: boolean; priorAttemptCount: number; partialRecoveryPossible: boolean; recommendedRetryMethod: string | null; signalsUsed: string[] } | null; enrichmentSource: 'razorpay_fields_heuristic' | 'fixture_signed' | 'vulcan_direct' | 'unavailable' | null }
export type ProposalStatus = 'pending' | 'approved' | 'simulated' | 'cancelled_by_dispute' | 'cancelled_by_recovery' | 'failed'
export type Proposal = { id: string; organizationId: string; incidentId: string; actionType: string; status: ProposalStatus; proposedAt: string; simulatedAt: string | null; content: Record<string, unknown>; deliveryResult: Record<string, unknown> | null }
export type ExecutionState = 'queued' | 'dispatching' | 'accepted' | 'unreconciled' | 'confirmed' | 'retry_scheduled' | 'compensating' | 'failed' | 'cancelled'
export type ExecutionActionSummary = { id: string; capability: string; state: ExecutionState; amountPaise: number | null; currency: string | null; terminalReason: string | null; providerObjectId: string | null; retryCount: number; policyVersion: string; capabilityVersion: string; createdAt: string; dispatchedAt: string | null; completedAt: string | null }
export type IncidentDetail = { incident: Incident; events: Event[]; proposals: Proposal[]; investigation: Investigation | null; execution: ExecutionActionSummary[] }
export type AuditEntry = { id: string; organizationId: string; incidentId: string | null; sequenceNumber: number; eventType: string; actorType: 'system' | 'human' | 'legacy'; actorId: string; decision: string; rationale: string; confidence: number | null; enrichmentSource: string | null; createdAt: string }
export type AuditIntegrity = { status: 'intact' | 'broken'; entryCount: number; checkedAt: string }
export type MvpHealth = { organizationId: string; pipeline: 'autonomous'; razorpayEnvironment: 'test' | 'live'; communications: 'autonomous_simulation' | 'email_execution' | 'email_execution_unavailable'; database: 'ready'; queueWorker: 'configured'; webhook: 'signed'; enrichmentAdapter: 'razorpay_fields_heuristic' }

// Canonical Phase 2+ contracts. A new endpoint must still add its own runtime
// guard in api.ts; these types alone are never trusted browser input.
export type InvestigationStatus = 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED'
export type InvestigationPlan = { hypothesis: string; primaryFailureCategory: 'infrastructure' | 'fraud_suspected' | 'fraud_confirmed' | 'customer_error' | 'subscription_issue' | 'unknown'; objectives: string[]; evidencePriorities: Array<{ fact: string; whyItMatters: string }>; subAgents: Array<{ agent: 'risk_analyst' | 'recovery_planner'; question: string; priority: 1 | 2; allowedContextFields: string[] }>; constraints: string[]; noActionCriteria: string[]; estimatedAutoResolvable: boolean; requiresNoActionFallback: boolean; confidence: number; reasoning: string }
export type RiskAnalysis = { failureRootCause: string; evidenceStrength: 'strong' | 'moderate' | 'weak'; confidence: number; causalNarrative: string; evidenceConfidenceRationale: string; alternativeHypotheses: string[]; falsePositiveCostEstimatePaise: number; missingEvidence: string[]; chargebackEvidenceReady: boolean; evidenceItems: string[]; recommendedActionCategory: string; toolResults: { incidentTimelineEventCount: number; merchantFailureRate: number | null; networkFailureRate: number | null; customerIncidentCount: number | null } }
export type RecoveryPlan = { proposedActions: Array<{ actionType: Proposal['actionType']; rationale: string; preconditions: string[]; expectedOutcome: string; estimatedRecoveryPaise: number | null; scriptContent?: string; requiresAutonomousExecution: true }>; noActionReason?: string; recoveryProbability: number; confidence: number }
export type PolicyDecision = { outcome: 'auto_with_proposals' | 'auto_no_action'; permittedActions: RecoveryPlan['proposedActions']; noActionReason: string | null; matchedPolicyId: string | null; gates: Array<{ name: 'fraud' | 'dispute' | 'auto_resolve_ceiling' | 'critical_tier' | 'contact_limits' | 'merchant_policy' | 'execution_capability' | 'provider_health' | 'amount_currency' | 'consent_quiet_hours' | 'emergency_pause' | 'idempotency' | 'retry_budget'; result: 'passed' | 'blocked' | 'restricted' | 'skipped'; rationale: string }> }
export type Investigation = { id: string; organizationId: string; incidentId: string; status: InvestigationStatus; plan: InvestigationPlan | null; riskAnalysis: RiskAnalysis | null; recoveryPlan: RecoveryPlan | null; policyDecision: PolicyDecision | null; modelId: string | null; tokensUsed: number | null; latencyMs: number | null; startedAt: string; completedAt: string | null }
export type DashboardQueryResult = {
  query: string; interpretation: string; matchedIncidentCount: number; matchedRemainingAmountPaise: number
  incidents: Array<{ id: string; status: IncidentStatus; riskTier: RiskTier; remainingAmountPaise: number; updatedAt: string }>
  limitations: string[]
}
export type DashboardMetrics = {
  operations: { totalAtRiskPaise: number | null; actionsDispatched: number; smtpAccepted: number; smtpRejected: number; unreconciledEmails: number; confirmedRecoveries: number; refunded: number; failedActions: number; retried: number; compensated: number; unresolvedReceipts: number }
  evaluation: { status: 'not_run' | 'available'; split: 'development' | 'held_out' | null; fixtureSetVersion: string | null; runAt: string | null; configurationHash: string | null; modelId: string | null; sampleCount: number; precision: number | null; recall: number | null; f1: number | null; falsePositiveCostPaise: number | null }
  exceptions: string[]
}

// === New autonomous pipeline types ===
export type AutonomyPolicy = {
  organizationId: string;
  maxAutoRecoveryPaise: number;
  maxAutoCapturePaise: number;
  maxAutoRefundPaise: number;
  recoveryEmailEnabled: boolean;
  subscriptionRetryEnabled: boolean;
  captureEnabled: boolean;
  refundEnabled: boolean;
  disputeEvidenceEnabled: boolean;
  maxContactsPerIncident: number;
  maxContactsPer24h: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  updatedAt: string;
}

export type ActiveRescue = {
  incidentId: string;
  amountPaise: number;
  strategyName: string;
  strategyDisplayName: string;
  vulcanAttribution: string;
  vulcanDataSource: 'vulcan_direct' | 'razorpay_fields_heuristic';
  sagaStep: string;
  elapsedMs: number;
}

export type RevenueIntelligence = {
  atRiskPaise: number;
  recoverablePaise: number;
  recoveredThisWeekPaise: number;
  protectedPaise: number;
  recoveryRate: number;
  merchantInterventionCount: number;
  vulcanSignalCoverage: number;
  activeRescues: ActiveRescue[];
  autonomous: { investigated: number; sagasCreated: number; actionsExecuted: number; paymentsRecovered: number };
}
