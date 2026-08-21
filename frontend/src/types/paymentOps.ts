export type IncidentStatus = 'needs_review' | 'monitoring' | 'recovered' | 'escalated' | 'dismissed'
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type ActionType = 'review_payment_method' | 'prepare_follow_up' | 'escalate' | 'monitor' | 'dismiss'

export interface PaymentOpsEvent {
  eventId: string
  source: 'webhook' | 'history_import'
  eventType: string
  occurredAt: string
  receivedAt: string
  paymentId?: string
  orderId?: string
  subscriptionId?: string
  customerReference: string
  currency?: string
  amountPaise?: number
  paymentStatus?: string
  paymentMethod?: string
  summary: string
}

export interface ActionProposal {
  type: Exclude<ActionType, 'dismiss'>
  rationale: string
  requiresHumanApproval: true
}

export interface Investigation {
  runId: string
  incidentId: string
  status: 'completed' | 'failed'
  provider: 'rules-v1' | 'model'
  startedAt: string
  completedAt: string
  incidentSummary: string
  severity: Severity
  confidence: number
  evidenceEventIds: string[]
  observedPattern: string
  impact: { failedPayments: number; unresolvedAmountPaise: number; recoveredAmountPaise: number }
  recommendedAction: ActionProposal
  missingContext: string[]
  errorMessage?: string
}

export interface AuditEntry {
  auditId: string
  incidentId: string
  at: string
  actor: 'system' | 'agent' | 'operator'
  action: string
  detail: string
}

export interface Incident {
  incidentId: string
  incidentType: 'payment_failure' | 'refund_failure' | 'payment_dispute' | 'subscription_risk'
  status: IncidentStatus
  severity: Severity
  title: string
  customerReference: string
  paymentMethod?: string
  currency?: string
  amountAtRiskPaise: number
  recoveredAmountPaise: number
  eventIds: string[]
  eventCount: number
  summary: string
  createdAt: string
  updatedAt: string
  latestEventAt: string
  agentRun?: Investigation
  actionProposal?: ActionProposal
  operatorAction?: { actionId: string; type: ActionType; operator: string; approvedAt: string }
}

export interface Dashboard {
  generatedAt: string
  environment: 'test' | 'live'
  capturedVolumePaise: number
  failedAmountAtRiskPaise: number
  recoveredAmountPaise: number
  openIncidentCount: number
  completedInvestigations: number
  eventWindow: { loadedEventCount: number; earliestOccurredAt?: string; latestOccurredAt?: string }
  recentEvents: PaymentOpsEvent[]
  attentionIncidents: Incident[]
}

export interface ConnectionStatus {
  provider: 'razorpay'
  environment: 'test' | 'live'
  webhookUrl: string
  webhookSecretConfigured: boolean
  apiKeyConfigured: boolean
  historyImportAvailable: boolean
  databaseConfigured: boolean
  lastEventReceivedAt?: string
}

export interface HistoryImportResult {
  paymentsScanned: number
  eventsImported: number
  incidentsCreated: number
  hasMore: boolean
  nextSkip?: number
}

export interface AutoPolicy {
  policyId: string
  name: string
  enabled: boolean
  incidentTypes: Incident['incidentType'][]
  severities: Severity[]
  minConfidence: number
  maxAmountPaise: number | null
  action: ActionType
  requireHumanForEscalate: boolean
  createdAt: string
  updatedAt: string
}

export interface IncidentDetail {
  incident: Incident
  events: PaymentOpsEvent[]
  audit: AuditEntry[]
}
