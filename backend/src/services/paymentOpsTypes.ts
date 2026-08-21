export type RazorpayEnvironment = 'test' | 'live';
export type EventSource = 'webhook' | 'history_import';
export type IncidentType = 'payment_failure' | 'refund_failure' | 'payment_dispute' | 'subscription_risk';
export type IncidentStatus = 'needs_review' | 'monitoring' | 'recovered' | 'escalated' | 'dismissed';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type ActionType = 'review_payment_method' | 'prepare_follow_up' | 'escalate' | 'monitor' | 'dismiss';

export interface PaymentOpsEvent {
  eventId: string;
  source: EventSource;
  eventType: string;
  occurredAt: string;
  receivedAt: string;
  paymentId?: string;
  orderId?: string;
  subscriptionId?: string;
  customerReference: string;
  currency?: string;
  amountPaise?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  summary: string;
  rawPayload: Record<string, unknown>;
}

export type PaymentOpsEventSummary = Omit<PaymentOpsEvent, 'rawPayload'>;

export interface ActionProposal {
  type: Exclude<ActionType, 'dismiss'>;
  rationale: string;
  requiresHumanApproval: true;
}

export interface Investigation {
  runId: string;
  incidentId: string;
  status: 'completed' | 'failed';
  provider: 'rules-v1' | 'model';
  startedAt: string;
  completedAt: string;
  incidentSummary: string;
  severity: Severity;
  confidence: number;
  evidenceEventIds: string[];
  observedPattern: string;
  impact: { failedPayments: number; unresolvedAmountPaise: number; recoveredAmountPaise: number };
  recommendedAction: ActionProposal;
  missingContext: string[];
  errorMessage?: string;
}

export interface IncidentAuditEntry {
  auditId: string;
  incidentId: string;
  at: string;
  actor: 'system' | 'agent' | 'operator';
  action: string;
  detail: string;
}

export interface PaymentOpsIncident {
  incidentId: string;
  incidentType: IncidentType;
  status: IncidentStatus;
  severity: Severity;
  title: string;
  customerReference: string;
  paymentMethod?: string;
  currency?: string;
  amountAtRiskPaise: number;
  recoveredAmountPaise: number;
  eventIds: string[];
  eventCount: number;
  summary: string;
  createdAt: string;
  updatedAt: string;
  latestEventAt: string;
  agentRun?: Investigation;
  actionProposal?: ActionProposal;
  operatorAction?: { actionId: string; type: ActionType; operator: string; approvedAt: string };
}

export interface PaymentOpsDashboard {
  generatedAt: string;
  environment: RazorpayEnvironment;
  capturedVolumePaise: number;
  failedAmountAtRiskPaise: number;
  recoveredAmountPaise: number;
  openIncidentCount: number;
  completedInvestigations: number;
  eventWindow: { loadedEventCount: number; earliestOccurredAt?: string; latestOccurredAt?: string };
  recentEvents: PaymentOpsEventSummary[];
  attentionIncidents: PaymentOpsIncident[];
}

export interface ConnectionStatus {
  provider: 'razorpay';
  environment: RazorpayEnvironment;
  webhookUrl: string;
  webhookSecretConfigured: boolean;
  apiKeyConfigured: boolean;
  historyImportAvailable: boolean;
  databaseConfigured: boolean;
  lastEventReceivedAt?: string;
}

export interface HistoryImportResult {
  paymentsScanned: number;
  eventsImported: number;
  incidentsCreated: number;
  hasMore: boolean;
  nextSkip?: number;
}

export type PolicyAction = ActionType;

export interface AutoPolicy {
  policyId: string;
  name: string;
  enabled: boolean;
  incidentTypes: IncidentType[]; // empty = all
  severities: Severity[]; // empty = all
  minConfidence: number; // 0-1
  maxAmountPaise: number | null; // null = no limit
  action: PolicyAction;
  requireHumanForEscalate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyEvaluation {
  policyId: string;
  policyName: string;
  matched: boolean;
  reason: string;
}
