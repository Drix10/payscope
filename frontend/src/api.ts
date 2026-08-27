import { APP_CONFIG, apiUrl } from './config'
import type { AuditEntry, AuditIntegrity, AutonomyPolicy, DashboardMetrics, DashboardQueryResult, Incident, IncidentDetail, Investigation, MvpHealth, Proposal, RevenueIntelligence } from './types/mvp'

type Envelope<T> = { success: true; data: T } | { success: false; error?: { message?: string } }
type Guard<T> = (value: unknown) => value is T
type RequestOptions = { signal?: AbortSignal; failureMessage?: string }

/** One cancellation/timeout/error boundary for every browser-to-VPS request. */
async function request<T>(path: string, guard: Guard<T>, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort()
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, APP_CONFIG.apiTimeoutMs)
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (APP_CONFIG.apiKey) headers['x-payscope-api-key'] = APP_CONFIG.apiKey
    const response = await fetch(apiUrl(path), { headers, signal: controller.signal })
    const body = await response.json().catch(() => null) as Envelope<T> | null
    if (!response.ok || !body || body.success !== true) throw new Error(body && 'error' in body ? body.error?.message || options.failureMessage || 'Request failed' : options.failureMessage || 'Request failed')
    if (!guard(body.data)) throw new Error('The server returned an invalid MVP response. Refresh and try again if it persists.')
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
  auditIntegrity: (signal?: AbortSignal) => request<AuditIntegrity>('/api/mvp/audit/integrity', isAuditIntegrity, { signal }),
  dashboardMetrics: (signal?: AbortSignal) => request<DashboardMetrics>('/api/mvp/dashboard/metrics', isDashboardMetrics, { signal }),
  dashboardQuery: (query: string, signal?: AbortSignal) => request<DashboardQueryResult>(`/api/mvp/dashboard/query?q=${encodeURIComponent(query)}&limit=10`, isDashboardQuery, { signal }),
  revenueIntelligence: (signal?: AbortSignal) => request<RevenueIntelligence>('/api/mvp/revenue-intelligence', isRevenueIntelligence, { signal }),
  autonomyPolicy: (signal?: AbortSignal) => request<AutonomyPolicy>('/api/mvp/autonomy-policy', isAutonomyPolicy, { signal }),
}

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1_000
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const fraction = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const date = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value))
const isIncident = (value: unknown): value is Incident => { const row = object(value); return Boolean(row && text(row.id) && text(row.organizationId) && ['CRITICAL', 'HIGH', 'MEDIUM', 'MONITOR'].includes(String(row.riskTier)) && ['OPEN', 'MONITORING', 'ESCALATED', 'DISPUTE_OPENED', 'RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED'].includes(String(row.status)) && amount(row.totalFailedAmountPaise) && amount(row.recoveredAmountPaise) && amount(row.remainingAmountPaise) && row.remainingAmountPaise === row.totalFailedAmountPaise - row.recoveredAmountPaise && Array.isArray(row.correlatedEventIds) && row.correlatedEventIds.length <= 100 && row.correlatedEventIds.every(text) && date(row.openedAt) && (row.resolvedAt === null || date(row.resolvedAt)) && date(row.updatedAt)) }
const isHealth = (value: unknown): value is MvpHealth => { const row = object(value); return Boolean(row && text(row.organizationId) && row.pipeline === 'autonomous' && (row.razorpayEnvironment === 'test' || row.razorpayEnvironment === 'live') && ['autonomous_simulation', 'email_execution', 'email_execution_unavailable'].includes(String(row.communications)) && row.database === 'ready' && row.queueWorker === 'configured' && row.webhook === 'signed' && row.enrichmentAdapter === 'razorpay_fields_heuristic') }
const isIncidents = (value: unknown): value is Incident[] => Array.isArray(value) && value.length <= 100 && value.every(isIncident)
const isEvent = (value: unknown): boolean => {
  const row = object(value); const event = row && object(row.event);
  return Boolean(row && text(row.id) && text(row.organizationId) && event && text(event.eventType))
}
const isProposal = (value: unknown): value is Proposal => { const row = object(value); return Boolean(row && text(row.id) && text(row.organizationId) && text(row.incidentId) && text(row.actionType)) }
const isExecutionAction = (value: unknown): value is import('./types/mvp').ExecutionActionSummary => { const row = object(value); return Boolean(row && text(row.id) && text(row.capability) && text(row.state)) }
const isStructuredAction = (value: unknown): boolean => {
  const action = object(value)
  return Boolean(action && text(action.actionType) && (action.rationale === undefined || typeof action.rationale === 'string'))
}
const isInvestigation = (value: unknown): value is Investigation => {
  const row = object(value)
  if (!row || !text(row.id) || !text(row.organizationId) || !text(row.incidentId)) return false
  return true
}
const isDetail = (value: unknown): value is IncidentDetail => { const row = object(value); return Boolean(row && isIncident(row.incident) && Array.isArray(row.events)) }
const isAudits = (value: unknown): value is AuditEntry[] => Array.isArray(value)
const isAuditIntegrity = (value: unknown): value is AuditIntegrity => { const row = object(value); return Boolean(row && (row.status === 'intact' || row.status === 'broken')) }
const isDashboardQuery = (value: unknown): value is DashboardQueryResult => {
  const row = object(value)
  const summaries = row?.incidents
  return Boolean(row && text(row.query) && text(row.interpretation) && amount(row.matchedIncidentCount) && amount(row.matchedRemainingAmountPaise) && Array.isArray(summaries) && summaries.length <= 20 && summaries.every(item => { const incident = object(item); return Boolean(incident && text(incident.id) && ['OPEN', 'MONITORING', 'ESCALATED', 'DISPUTE_OPENED', 'RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED'].includes(String(incident.status)) && ['CRITICAL', 'HIGH', 'MEDIUM', 'MONITOR'].includes(String(incident.riskTier)) && amount(incident.remainingAmountPaise) && date(incident.updatedAt)) }) && Array.isArray(row.limitations) && row.limitations.length >= 2 && row.limitations.length <= 8 && row.limitations.every(text))
}
const nullableAmount = (value: unknown): boolean => value === null || amount(value)
const nullableFraction = (value: unknown): boolean => value === null || fraction(value)
const isDashboardMetrics = (value: unknown): value is DashboardMetrics => {
  const row = object(value); const operations = row && object(row.operations); const evaluation = row && object(row.evaluation)
  if (!operations || !evaluation || !nullableAmount(operations.totalAtRiskPaise) || !amount(operations.actionsDispatched) || !amount(operations.smtpAccepted) || !amount(operations.smtpRejected) || !amount(operations.unreconciledEmails) || !amount(operations.confirmedRecoveries) || !amount(operations.refunded) || !amount(operations.failedActions) || !amount(operations.retried) || !amount(operations.compensated) || !amount(operations.unresolvedReceipts) || !['not_run', 'available'].includes(String(evaluation.status)) || !(evaluation.split === null || evaluation.split === 'development' || evaluation.split === 'held_out') || !(evaluation.fixtureSetVersion === null || text(evaluation.fixtureSetVersion)) || !(evaluation.runAt === null || date(evaluation.runAt)) || !(evaluation.configurationHash === null || (typeof evaluation.configurationHash === 'string' && /^[a-f0-9]{64}$/.test(evaluation.configurationHash))) || !(evaluation.modelId === null || text(evaluation.modelId)) || !amount(evaluation.sampleCount) || !nullableFraction(evaluation.precision) || !nullableFraction(evaluation.recall) || !nullableFraction(evaluation.f1) || !nullableAmount(evaluation.falsePositiveCostPaise) || !Array.isArray(row.exceptions) || row.exceptions.length < 6 || row.exceptions.length > 10 || !row.exceptions.every(text)) return false
  const metadata = [evaluation.split, evaluation.fixtureSetVersion, evaluation.runAt, evaluation.configurationHash, evaluation.modelId, evaluation.precision, evaluation.recall, evaluation.f1, evaluation.falsePositiveCostPaise]
  return evaluation.status === 'not_run'
    ? evaluation.sampleCount === 0 && metadata.every(item => item === null)
    : evaluation.sampleCount > 0 && metadata.every(item => item !== null)
}
const isActiveRescue = (value: unknown): boolean => {
  const row = object(value)
  const step = row && (text(row.step) ? row.step : text(row.sagaStep) ? row.sagaStep : null)
  return Boolean(row && text(row.incidentId) && typeof row.amountPaise === 'number' && text(row.strategyName) && text(row.strategyDisplayName) && text(row.telemetryAttribution) && ['razorpay_fields_heuristic'].includes(String(row.telemetryDataSource)) && text(step) && typeof row.elapsedMs === 'number')
}
const isRevenueIntelligence = (value: unknown): value is RevenueIntelligence => {
  const row = object(value)
  const autonomous = row && object(row.autonomous)
  const sagas = autonomous && (typeof autonomous.sagasCreated === 'number' ? autonomous.sagasCreated : typeof autonomous.investigationsCreated === 'number' ? autonomous.investigationsCreated : null)
  return Boolean(row && typeof row.atRiskPaise === 'number' && typeof row.recoverablePaise === 'number' && typeof row.recoveredThisWeekPaise === 'number' && typeof row.protectedPaise === 'number' && typeof row.recoveryRate === 'number' && typeof row.merchantInterventionCount === 'number' && typeof row.telemetrySignalCoverage === 'number' && Array.isArray(row.activeRescues) && row.activeRescues.every(isActiveRescue) && autonomous && typeof autonomous.investigated === 'number' && typeof sagas === 'number' && typeof autonomous.actionsExecuted === 'number' && typeof autonomous.paymentsRecovered === 'number')
}
const isAutonomyPolicy = (value: unknown): value is AutonomyPolicy => {
  const row = object(value)
  return Boolean(row && text(row.organizationId) && typeof row.maxAutoRecoveryPaise === 'number' && typeof row.recoveryEmailEnabled === 'boolean' && typeof row.captureEnabled === 'boolean' && typeof row.refundEnabled === 'boolean' && typeof row.disputeEvidenceEnabled === 'boolean' && typeof row.maxContactsPerIncident === 'number' && typeof row.maxContactsPer24h === 'number' && (row.quietHoursStart === null || text(row.quietHoursStart)) && (row.quietHoursEnd === null || text(row.quietHoursEnd)) && date(row.updatedAt))
}
