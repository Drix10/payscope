import { z } from 'zod';

export const EnrichmentSourceSchema = z.enum(['razorpay_fields_heuristic', 'fixture_signed', 'vulcan_direct', 'unavailable']);
export const IncidentStatusSchema = z.enum(['OPEN', 'MONITORING', 'ESCALATED', 'DISPUTE_OPENED', 'RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED']);
export const RiskTierSchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'MONITOR']);
export const ExecutionStateSchema = z.enum(['queued', 'dispatching', 'accepted', 'unreconciled', 'confirmed', 'retry_scheduled', 'compensating', 'failed', 'cancelled']);
export const ProposalStatusSchema = z.enum(['pending', 'approved', 'simulated', 'cancelled_by_dispute', 'cancelled_by_recovery', 'failed']);
export const ActionTypeSchema = z.enum([
  'deliver_recovery_link_email',
  'record_risk_signal',
  'submit_dispute_evidence',
  'capture_authorized_payment',
  'refund_payment',
  'resolve_infrastructure',
  'retry_subscription_charge',
  'cancel_payment_link',
  'fetch_payment_status',
]);

const isoDateTime = z.string().datetime({ offset: true });
const paise = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const uuid = z.string().min(1).max(160);
const providerScalar = z.union([z.string().max(160), z.number().finite(), z.boolean()]);
const providerContext = z.record(providerScalar).superRefine((value, context) => {
  const entries = Object.entries(value);
  if (entries.length > 8) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provider context has too many fields' });
  for (const [key] of entries) if (key.length > 64) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provider context key is too long', path: [key] });
});
const providerData = z.record(z.union([providerScalar, providerContext])).superRefine((value, context) => {
  const entries = Object.entries(value);
  if (entries.length > 12) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provider data has too many fields' });
  for (const [key] of entries) if (key.length > 64) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provider data key is too long', path: [key] });
});

export const NormalizedEventSchema = z.object({
  eventId: z.string().min(1).max(160),
  eventType: z.string().min(1).max(120),
  occurredAt: isoDateTime,
  receivedAt: isoDateTime,
  paymentId: z.string().min(1).max(160).optional(),
  orderId: z.string().min(1).max(160).optional(),
  subscriptionId: z.string().min(1).max(160).optional(),
  customerHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  amountPaise: paise.optional(),
  paymentStatus: z.string().max(80).optional(),
  paymentMethod: z.string().max(80).optional(),
  providerData: providerData.default({}),
}).strict();

export const VulcanEnrichmentSchema = z.object({
  failureAttribution: z.enum(['gateway_degraded', 'issuer_timeout', 'fraud_block', 'insufficient_funds', 'customer_drop', 'routing_suboptimal', 'subscription_lapse', 'unknown']),
  gatewayHealthScore: z.number().min(0).max(1),
  gatewayInDowntime: z.boolean(),
  downtimeScheduled: z.boolean(),
  crossBorderFlag: z.boolean(),
  priorAttemptCount: z.number().int().nonnegative(),
  partialRecoveryPossible: z.boolean(),
  recommendedRetryMethod: z.string().max(80).nullable(),
  source: EnrichmentSourceSchema.exclude(['unavailable']),
  enrichedAt: isoDateTime,
  signalsUsed: z.array(z.string().min(1).max(80)).max(32),
}).strict();

export const IncidentSchema = z.object({
  id: uuid,
  organizationId: uuid,
  riskTier: RiskTierSchema,
  status: IncidentStatusSchema,
  totalFailedAmountPaise: paise,
  recoveredAmountPaise: paise,
  remainingAmountPaise: paise,
  correlatedEventIds: z.array(uuid).max(100),
  openedAt: isoDateTime,
  resolvedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
}).strict().superRefine((value, context) => {
  if (value.recoveredAmountPaise > value.totalFailedAmountPaise) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Recovered amount cannot exceed total failed amount', path: ['recoveredAmountPaise'] });
  if (value.remainingAmountPaise !== value.totalFailedAmountPaise - value.recoveredAmountPaise) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Remaining amount must equal total minus recovered', path: ['remainingAmountPaise'] });
});

export const InvestigationPlanSchema = z.object({
  hypothesis: z.string().min(1).max(100),
  primaryFailureCategory: z.enum(['infrastructure', 'fraud_suspected', 'fraud_confirmed', 'customer_error', 'subscription_issue', 'unknown']),
  objectives: z.array(z.string().min(1).max(120)).min(1).max(4),
  evidencePriorities: z.array(z.object({ fact: z.string().min(1).max(160), whyItMatters: z.string().min(1).max(160) }).strict()).min(1).max(5),
  subAgents: z.array(z.object({ agent: z.enum(['risk_analyst', 'recovery_planner']), question: z.string().min(1).max(80), priority: z.union([z.literal(1), z.literal(2)]), allowedContextFields: z.array(z.string().min(1).max(80)).max(20) }).strict()).max(2),
  constraints: z.array(z.string().min(1).max(140)).min(1).max(6),
  noActionCriteria: z.array(z.string().min(1).max(140)).min(1).max(6),
  estimatedAutoResolvable: z.boolean(),
  requiresNoActionFallback: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(200),
}).strict();

export const RiskToolResultsSchema = z.object({
  incidentTimelineEventCount: z.number().int().min(0).max(100),
  merchantFailureRate: z.number().min(0).max(1).nullable(),
  networkFailureRate: z.number().min(0).max(1).nullable(),
  customerIncidentCount: z.number().int().nonnegative().nullable(),
}).strict();

export const RiskAnalysisSchema = z.object({
  failureRootCause: z.enum(['gateway_degraded', 'issuer_block', 'fraud_confirmed', 'fraud_suspected', 'customer_error', 'subscription_lapse', 'unknown']),
  evidenceStrength: z.enum(['strong', 'moderate', 'weak']),
  confidence: z.number().min(0).max(1),
  causalNarrative: z.string().min(1).max(320),
  evidenceConfidenceRationale: z.string().min(1).max(240),
  alternativeHypotheses: z.array(z.string().min(1).max(160)).max(3),
  falsePositiveCostEstimatePaise: paise,
  missingEvidence: z.array(z.string().min(1).max(160)).max(12),
  chargebackEvidenceReady: z.boolean(),
  evidenceItems: z.array(z.string().min(1).max(200)).max(30),
  recommendedActionCategory: z.enum(['auto_resolve_no_action', 'submit_dispute_evidence', 'record_risk_signal', 'propose_recovery', 'escalate_fraud', 'deliver_recovery_link_email', 'no_action']),
  toolResults: RiskToolResultsSchema,
}).strict();

/** Model output excludes server-calculated tool facts; those are added locally. */
export const RiskAnalysisModelOutputSchema = RiskAnalysisSchema.omit({ toolResults: true });

export const RecoveryPlanSchema = z.object({
  proposedActions: z.array(z.object({ actionType: ActionTypeSchema, rationale: z.string().min(1).max(100), preconditions: z.array(z.string().min(1).max(140)).min(1).max(6), expectedOutcome: z.string().min(1).max(160), estimatedRecoveryPaise: paise.nullable(), scriptContent: z.string().min(1).max(600).optional(), emailCopyIntent: z.string().min(1).max(600).optional(), requiresAutonomousExecution: z.literal(true) }).strict()).max(8),
  noActionReason: z.string().min(1).max(200).optional(),
  recoveryProbability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
}).strict();

export const PolicyDecisionSchema = z.object({
  outcome: z.enum(['auto_with_proposals', 'auto_no_action']),
  permittedActions: z.array(RecoveryPlanSchema.shape.proposedActions.element).max(8),
  noActionReason: z.string().min(1).max(120).nullable(),
  matchedPolicyId: z.string().uuid().nullable(),
  gates: z.array(z.object({ name: z.enum(['fraud', 'dispute', 'auto_resolve_ceiling', 'critical_tier', 'contact_limits', 'merchant_policy', 'execution_capability', 'provider_health', 'amount_currency', 'consent_quiet_hours', 'emergency_pause', 'idempotency', 'retry_budget']), result: z.enum(['passed', 'blocked', 'restricted', 'skipped']), rationale: z.string().min(1).max(160) }).strict()).min(6).max(13),
}).strict();

export const InvestigationStatusSchema = z.enum(['PENDING', 'RUNNING', 'COMPLETE', 'FAILED']);
export const InvestigationSchema = z.object({
  id: uuid,
  organizationId: uuid,
  incidentId: uuid,
  status: InvestigationStatusSchema,
  plan: InvestigationPlanSchema.nullable(),
  riskAnalysis: RiskAnalysisSchema.nullable(),
  recoveryPlan: RecoveryPlanSchema.nullable(),
  policyDecision: PolicyDecisionSchema.nullable(),
  modelId: z.string().min(1).max(160).nullable(),
  tokensUsed: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  startedAt: isoDateTime,
  completedAt: isoDateTime.nullable(),
}).strict();

export const ActionProposalSchema = z.object({
  id: uuid,
  organizationId: uuid,
  incidentId: uuid,
  actionType: ActionTypeSchema,
  content: z.record(z.unknown()),
  status: ProposalStatusSchema,
  proposedAt: isoDateTime,
  simulatedAt: isoDateTime.nullable(),
  deliveryResult: z.record(z.unknown()).nullable(),
}).strict();

export const ExecutionActionSchema = z.object({
  id: uuid,
  organizationId: uuid,
  incidentId: uuid,
  proposalId: uuid.nullable(),
  capability: ActionTypeSchema,
  commandKey: z.string().min(1).max(240),
  commandPayload: z.record(z.unknown()),
  commandPayloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  canonicalPaymentId: z.string().max(160).nullable(),
  canonicalOrderId: z.string().max(160).nullable(),
  amountPaise: paise.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  state: ExecutionStateSchema,
  retryCount: z.number().int().min(0).max(5),
  nextReconciliationAt: isoDateTime.nullable(),
  terminalReason: z.string().max(320).nullable(),
  providerObjectId: z.string().max(320).nullable(),
  emailSendStartedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  dispatchedAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
}).strict();

export const ExecutionReceiptSchema = z.object({
  id: uuid,
  organizationId: uuid,
  actionId: uuid,
  provider: z.enum(['razorpay', 'smtp']),
  receiptKind: z.enum(['payment_link_created', 'smtp_accepted', 'smtp_rejected', 'unreconciled', 'payment_link_paid', 'failed', 'refund_created', 'refund_reconciled', 'capture_confirmed', 'dispute_submitted']),
  providerOperationId: z.string().max(320).nullable(),
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/),
  redactedPayload: z.record(z.unknown()),
  createdAt: isoDateTime,
}).strict();

export const AuditEntrySchema = z.object({
  id: uuid,
  organizationId: uuid,
  incidentId: uuid.nullable(),
  sequenceNumber: z.number().int().nonnegative(),
  eventType: z.string().min(1).max(120),
  actorType: z.enum(['system', 'human', 'legacy']),
  actorId: z.string().min(1).max(160),
  actorSessionHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  decision: z.string().min(1).max(240),
  rationale: z.string().min(1).max(1_000),
  confidence: z.number().min(0).max(1).nullable(),
  enrichmentSnapshot: z.record(z.unknown()).nullable(),
  prevEntryHash: z.string().regex(/^[a-f0-9]{64}$/),
  entryHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: isoDateTime,
}).strict();

export const QueueJobSchema = z.object({
  jobId: uuid,
  organizationId: uuid,
  type: z.string(),
  // Initial delivery plus the three documented retries (1s, 5s, 30s).
  attemptNumber: z.number().int().min(1).max(10).optional().default(1),
  createdAt: z.string().optional().default(() => new Date().toISOString()),
  eventId: uuid.optional(),
  incidentId: uuid.optional(),
  triggerEventId: uuid.optional(),
}).passthrough();

/** Read-only, tenant-scoped natural-language dashboard response. */
export const DashboardIncidentSummarySchema = z.object({
  id: uuid,
  status: IncidentStatusSchema,
  riskTier: RiskTierSchema,
  remainingAmountPaise: paise,
  updatedAt: isoDateTime,
}).strict();

export const DashboardQueryResponseSchema = z.object({
  query: z.string().min(1).max(240),
  interpretation: z.string().min(1).max(240),
  matchedIncidentCount: z.number().int().nonnegative().max(100),
  matchedRemainingAmountPaise: paise,
  incidents: z.array(DashboardIncidentSummarySchema).max(20),
  limitations: z.array(z.string().min(1).max(240)).min(2).max(8),
}).strict();

/**
 * Evaluation and recovery attribution are deliberately nullable until a
 * versioned fixture run / causal Payment Link reference exists. This makes an
 * absent metric visible instead of converting unknown evidence into zero.
 */
export const DashboardMetricsSchema = z.object({
  operations: z.object({
    totalAtRiskPaise: paise.nullable(),
    actionsDispatched: z.number().int().nonnegative(),
    smtpAccepted: z.number().int().nonnegative(),
    smtpRejected: z.number().int().nonnegative(),
    unreconciledEmails: z.number().int().nonnegative(),
    confirmedRecoveries: z.number().int().nonnegative(),
    refunded: z.number().int().nonnegative(),
    failedActions: z.number().int().nonnegative(),
    retried: z.number().int().nonnegative(),
    compensated: z.number().int().nonnegative(),
    unresolvedReceipts: z.number().int().nonnegative(),
  }).strict(),
  evaluation: z.object({
    status: z.enum(['not_run', 'available']),
    split: z.enum(['development', 'held_out']).nullable(),
    fixtureSetVersion: z.string().min(1).max(160).nullable(),
    runAt: isoDateTime.nullable(),
    configurationHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    modelId: z.string().min(1).max(160).nullable(),
    sampleCount: z.number().int().nonnegative(),
    precision: z.number().min(0).max(1).nullable(),
    recall: z.number().min(0).max(1).nullable(),
    f1: z.number().min(0).max(1).nullable(),
    falsePositiveCostPaise: paise.nullable(),
  }).strict(),
  exceptions: z.array(z.string().min(1).max(240)).min(6).max(10),
}).strict().superRefine((value, context) => {
  const evaluationValues = [
    value.evaluation.split, value.evaluation.fixtureSetVersion, value.evaluation.runAt,
    value.evaluation.configurationHash, value.evaluation.modelId, value.evaluation.precision,
    value.evaluation.recall, value.evaluation.f1, value.evaluation.falsePositiveCostPaise,
  ];
  if (value.evaluation.status === 'not_run') {
    if (value.evaluation.sampleCount !== 0 || evaluationValues.some(item => item !== null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'A not_run evaluation must not expose partial metrics.', path: ['evaluation'] });
    }
  } else if (value.evaluation.sampleCount < 1 || evaluationValues.some(item => item === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'An available evaluation must include complete metadata and metrics.', path: ['evaluation'] });
  }
});

/** Read-only, redacted execution action projection for the dashboard. Excludes command payload (customer hash, reference, copy) and raw receipts. */
export const ExecutionActionSummarySchema = z.object({
  id: uuid,
  capability: ActionTypeSchema,
  state: ExecutionStateSchema,
  amountPaise: paise.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  terminalReason: z.string().max(320).nullable(),
  providerObjectId: z.string().max(320).nullable(),
  retryCount: z.number().int().min(0).max(5),
  policyVersion: z.string().max(160),
  capabilityVersion: z.string().max(160),
  createdAt: isoDateTime,
  dispatchedAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
}).strict();

export const AutonomyPolicySchema = z.object({
  organizationId: uuid,
  maxAutoRecoveryPaise: z.number().int().nonnegative(),
  maxAutoCapturePaise: z.number().int().nonnegative(),
  maxAutoRefundPaise: z.number().int().nonnegative(),
  recoveryEmailEnabled: z.boolean(),
  subscriptionRetryEnabled: z.boolean(),
  captureEnabled: z.boolean(),
  refundEnabled: z.boolean(),
  disputeEvidenceEnabled: z.boolean(),
  maxContactsPerIncident: z.number().int().min(1).max(5),
  maxContactsPer24h: z.number().int().min(1).max(3),
  quietHoursStart: z.string().nullable(),
  quietHoursEnd: z.string().nullable(),
  updatedAt: isoDateTime,
}).strict();

export type AutonomyPolicy = z.infer<typeof AutonomyPolicySchema>;

export type EnrichmentSource = z.infer<typeof EnrichmentSourceSchema>;
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;
export type RiskTier = z.infer<typeof RiskTierSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
export type VulcanEnrichment = z.infer<typeof VulcanEnrichmentSchema>;
export type Incident = z.infer<typeof IncidentSchema>;
export type InvestigationPlan = z.infer<typeof InvestigationPlanSchema>;
export type RiskAnalysis = z.infer<typeof RiskAnalysisSchema>;
export type RiskToolResults = z.infer<typeof RiskToolResultsSchema>;
export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>;
export type PolicyDecisionContract = z.infer<typeof PolicyDecisionSchema>;
export type Investigation = z.infer<typeof InvestigationSchema>;
export type ActionProposal = z.infer<typeof ActionProposalSchema>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export type QueueJob = z.infer<typeof QueueJobSchema>;
export type DashboardQueryResponse = z.infer<typeof DashboardQueryResponseSchema>;
export type DashboardMetrics = z.infer<typeof DashboardMetricsSchema>;
export type ExecutionActionSummary = z.infer<typeof ExecutionActionSummarySchema>;
