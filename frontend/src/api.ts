import { APP_CONFIG, apiUrl } from './config'
import type { AuditEntry, Incident, IncidentDetail, Investigation, MvpHealth, Proposal } from './types/mvp'

type Envelope<T> = { success: true; data: T } | { success: false; error?: { message?: string } }
type Guard<T> = (value: unknown) => value is T
type RequestOptions = { method?: 'GET' | 'POST'; token?: string; signal?: AbortSignal; failureMessage?: string }

/** One cancellation/timeout/error boundary for every browser-to-VPS request. */
async function request<T>(path: string, guard: Guard<T>, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort()
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, APP_CONFIG.apiTimeoutMs)
  try {
    const response = await fetch(apiUrl(path), { method: options.method ?? 'GET', headers: { Accept: 'application/json', ...(options.token ? { 'x-payscope-demo-approval-token': options.token } : {}) }, signal: controller.signal })
    const body = await response.json().catch(() => null) as Envelope<T> | null
    if (!response.ok || !body || body.success !== true) throw new Error(body && 'error' in body ? body.error?.message || options.failureMessage || 'Request failed' : options.failureMessage || 'Request failed')
    if (!guard(body.data)) throw new Error('The server returned an invalid MVP response. Refresh and contact the demo operator if it persists.')
    return body.data
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timedOut ? 'The API request timed out. Previous data, if any, is retained.' : 'The API request was cancelled.')
    throw error
  } finally { window.clearTimeout(timeout); options.signal?.removeEventListener('abort', abortFromCaller) }
}

export const mvpApi = {
  health: (signal?: AbortSignal) => request<MvpHealth>('/api/mvp/health', isHealth, { signal }),
  incidents: (status?: Incident['status'], signal?: AbortSignal) => request<Incident[]>(`/api/mvp/incidents?limit=100${status ? `&status=${encodeURIComponent(status)}` : ''}`, isIncidents, { signal }),
  incident: (id: string, signal?: AbortSignal) => request<IncidentDetail>(`/api/mvp/incidents/${encodeURIComponent(id)}`, isDetail, { signal }),
  audit: (incidentId: string, signal?: AbortSignal) => request<AuditEntry[]>(`/api/mvp/audit?incidentId=${encodeURIComponent(incidentId)}`, isAudits, { signal }),
  approve: (proposalId: string, token: string, signal?: AbortSignal) => request<Proposal>(`/api/mvp/proposals/${encodeURIComponent(proposalId)}/approve`, isProposal, { method: 'POST', token, signal, failureMessage: 'Proposal approval failed' }),
}

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1_000
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const fraction = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const date = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value))
const isIncident = (value: unknown): value is Incident => { const row = object(value); return Boolean(row && text(row.id) && text(row.organizationId) && ['CRITICAL', 'HIGH', 'MEDIUM', 'MONITOR'].includes(String(row.riskTier)) && ['OPEN', 'MONITORING', 'ESCALATED', 'DISPUTE_OPENED', 'RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED'].includes(String(row.status)) && amount(row.totalFailedAmountPaise) && amount(row.recoveredAmountPaise) && amount(row.remainingAmountPaise) && row.remainingAmountPaise === row.totalFailedAmountPaise - row.recoveredAmountPaise && Array.isArray(row.correlatedEventIds) && row.correlatedEventIds.length <= 100 && row.correlatedEventIds.every(text) && date(row.openedAt) && (row.resolvedAt === null || date(row.resolvedAt)) && date(row.updatedAt)) }
const isHealth = (value: unknown): value is MvpHealth => { const row = object(value); return Boolean(row && text(row.organizationId) && row.pipeline === 'agentic_mvp' && row.testMode === true && row.communications === 'proposal_only' && row.database === 'ready' && row.queueWorker === 'configured' && row.webhook === 'signed_test_mode_only' && row.enrichmentAdapter === 'razorpay_fields_heuristic') }
const isIncidents = (value: unknown): value is Incident[] => Array.isArray(value) && value.length <= 100 && value.every(isIncident)
const isEvent = (value: unknown): boolean => {
  const row = object(value); const event = row && object(row.event); const enrichment = row?.enrichment
  const parsedEnrichment = object(enrichment)
  const validEnrichment = enrichment === null || Boolean(parsedEnrichment && ['razorpay_fields_heuristic', 'fixture_signed', 'vulcan_direct'].includes(String(parsedEnrichment.source)) && ['gateway_degraded', 'issuer_timeout', 'fraud_block', 'insufficient_funds', 'customer_drop', 'routing_suboptimal', 'unknown'].includes(String(parsedEnrichment.failureAttribution)) && typeof parsedEnrichment.gatewayHealthScore === 'number' && Number.isFinite(parsedEnrichment.gatewayHealthScore) && typeof parsedEnrichment.gatewayInDowntime === 'boolean' && typeof parsedEnrichment.downtimeScheduled === 'boolean' && typeof parsedEnrichment.crossBorderFlag === 'boolean' && amount(parsedEnrichment.priorAttemptCount) && typeof parsedEnrichment.partialRecoveryPossible === 'boolean' && (parsedEnrichment.recommendedRetryMethod === null || text(parsedEnrichment.recommendedRetryMethod)) && Array.isArray(parsedEnrichment.signalsUsed) && parsedEnrichment.signalsUsed.length <= 32 && parsedEnrichment.signalsUsed.every(text))
  return Boolean(row && text(row.id) && text(row.organizationId) && event && text(event.eventType) && date(event.occurredAt) && date(event.receivedAt) && (event.amountPaise === undefined || amount(event.amountPaise)) && (event.paymentMethod === undefined || text(event.paymentMethod)) && (row.enrichmentSource === null || ['razorpay_fields_heuristic', 'fixture_signed', 'vulcan_direct', 'unavailable'].includes(String(row.enrichmentSource))) && validEnrichment)
}
const isProposal = (value: unknown): value is Proposal => { const row = object(value); return Boolean(row && text(row.id) && text(row.organizationId) && text(row.incidentId) && text(row.actionType) && ['pending', 'approved', 'simulated', 'cancelled_by_dispute', 'cancelled_by_recovery', 'failed'].includes(String(row.status)) && date(row.proposedAt) && (row.approvedAt === null || date(row.approvedAt)) && (row.approvedBy === null || text(row.approvedBy)) && object(row.content) && (row.deliveryResult === null || object(row.deliveryResult))) }
const isInvestigation = (value: unknown): value is Investigation => {
  const row = object(value); const plan = row && object(row.plan); const risk = row && object(row.riskAnalysis); const recovery = row && object(row.recoveryPlan); const policy = row && object(row.policyDecision)
  const planValid = plan === null || Boolean(plan && text(plan.hypothesis) && text(plan.primaryFailureCategory) && Array.isArray(plan.subAgents) && plan.subAgents.length <= 2 && typeof plan.requiresHumanReview === 'boolean' && typeof plan.estimatedAutoResolvable === 'boolean' && fraction(plan.confidence) && text(plan.reasoning))
  const riskValid = risk === null || Boolean(risk && text(risk.failureRootCause) && ['strong', 'moderate', 'weak'].includes(String(risk.evidenceStrength)) && fraction(risk.confidence) && amount(risk.falsePositiveCostEstimatePaise) && Array.isArray(risk.missingEvidence) && risk.missingEvidence.length <= 12 && risk.missingEvidence.every(text) && Array.isArray(risk.evidenceItems) && risk.evidenceItems.length <= 30 && risk.evidenceItems.every(text))
  const recoveryValid = recovery === null || Boolean(recovery && Array.isArray(recovery.proposedActions) && recovery.proposedActions.length <= 8 && recovery.proposedActions.every(action => { const item = object(action); return Boolean(item && text(item.actionType) && ['retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script', 'merchant_email_notification', 'merchant_webhook_notification', 'flag_for_review', 'prepare_chargeback_evidence', 'auto_resolve_infrastructure'].includes(item.actionType) && text(item.rationale) && (item.estimatedRecoveryPaise === null || amount(item.estimatedRecoveryPaise)) && (item.scriptContent === undefined || text(item.scriptContent)) && item.requiresOperatorApproval === true) }) && fraction(recovery.recoveryProbability) && fraction(recovery.confidence) && (recovery.noActionReason === undefined || text(recovery.noActionReason)))
  const policyValid = policy === null || Boolean(policy && ['auto_with_proposals', 'auto_no_action', 'escalate'].includes(String(policy.outcome)) && Array.isArray(policy.permittedActions) && policy.permittedActions.length <= 8 && (policy.escalationReason === null || text(policy.escalationReason)) && (policy.matchedPolicyId === null || text(policy.matchedPolicyId)) && Array.isArray(policy.gates) && policy.gates.length === 7 && policy.gates.every(gate => { const item = object(gate); return Boolean(item && ['fraud', 'dispute', 'auto_resolve_ceiling', 'human_review_floor', 'critical_tier', 'contact_limits', 'merchant_policy'].includes(String(item.name)) && ['passed', 'blocked', 'restricted', 'skipped'].includes(String(item.result)) && text(item.rationale)) }))
  return Boolean(row && text(row.id) && text(row.organizationId) && text(row.incidentId) && ['PENDING', 'RUNNING', 'COMPLETE', 'FAILED'].includes(String(row.status)) && planValid && riskValid && recoveryValid && policyValid && (row.modelId === null || text(row.modelId)) && (row.tokensUsed === null || amount(row.tokensUsed)) && (row.latencyMs === null || amount(row.latencyMs)) && date(row.startedAt) && (row.completedAt === null || date(row.completedAt)))
}
const isDetail = (value: unknown): value is IncidentDetail => { const row = object(value); return Boolean(row && isIncident(row.incident) && Array.isArray(row.events) && row.events.length <= 100 && row.events.every(isEvent) && Array.isArray(row.proposals) && row.proposals.length <= 100 && row.proposals.every(isProposal) && (row.investigation === null || isInvestigation(row.investigation))) }
const isAudits = (value: unknown): value is AuditEntry[] => Array.isArray(value) && value.length <= 200 && value.every(value => { const row = object(value); return Boolean(row && text(row.id) && amount(row.sequenceNumber) && text(row.eventType) && text(row.actorType) && text(row.decision) && text(row.rationale) && date(row.createdAt)) })
