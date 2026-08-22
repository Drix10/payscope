import axios from 'axios'
import { APP_CONFIG, apiUrl } from './config'
import { ActionType, AutoPolicy, ConnectionStatus, Dashboard, HistoryImportResult, Incident, IncidentDetail, Investigation, PaymentOpsEvent } from './types/paymentOps'

const MAX_TEXT = 3_000
const validText = (value: unknown, max = MAX_TEXT): value is string => typeof value === 'string' && value.length <= max
const requiredText = (value: unknown, max = MAX_TEXT): value is string => validText(value, max) && value.trim().length > 0
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const statuses = ['needs_review', 'monitoring', 'recovered', 'escalated', 'dismissed'] as const
const severities = ['critical', 'high', 'medium', 'low'] as const
const actionTypes = ['review_payment_method', 'prepare_follow_up', 'escalate', 'monitor', 'dismiss'] as const
const isPaise = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isDate = (value: unknown): value is string => validText(value, 100) && Number.isFinite(Date.parse(value))
const isCurrency = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value)
const stringArray = (value: unknown, max = 100): value is string[] => Array.isArray(value) && value.length <= max && value.every(item => requiredText(item))

export const paymentOpsApi = axios.create({ baseURL: APP_CONFIG.apiBaseUrl, timeout: APP_CONFIG.apiTimeoutMs, maxContentLength: 300_000, headers: { 'Content-Type': 'application/json' } })
if (APP_CONFIG.apiAccessToken) paymentOpsApi.defaults.headers.common.Authorization = `Bearer ${APP_CONFIG.apiAccessToken}`
export const paymentOpsPath = (path: string) => apiUrl(path)

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.'
    if (!error.response) return `PayScope API is unreachable at ${APP_CONFIG.apiBaseUrl || 'the local development server'}. Check the API process and allow this frontend origin in CORS_ORIGINS.`
    const message = error.response.data?.error?.message ?? error.response.data?.message
    if (typeof message === 'string') return message.slice(0, 500)
  }
  return fallback
}
export const isRequestCancelled = (error: unknown): boolean => axios.isCancel(error) || (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')

export function isPaymentOpsEvent(value: unknown): value is PaymentOpsEvent {
  if (!isObject(value)) return false
  return requiredText(value.eventId, 300) && ['webhook', 'history_import'].includes(value.source as string) && requiredText(value.eventType) && isDate(value.occurredAt) && isDate(value.receivedAt) && requiredText(value.customerReference) && validText(value.summary) && ['paymentId', 'orderId', 'subscriptionId', 'paymentStatus', 'paymentMethod'].every(key => value[key] === undefined || validText(value[key], 300)) && (value.currency === undefined || isCurrency(value.currency)) && (value.amountPaise === undefined || isPaise(value.amountPaise))
}
function isProposal(value: unknown): boolean {
  return isObject(value) && ['review_payment_method', 'prepare_follow_up', 'escalate', 'monitor'].includes(value.type as string) && requiredText(value.rationale) && value.requiresHumanApproval === true
}
function isInvestigation(value: unknown): value is Investigation {
  if (!isObject(value)) return false
  const impact = value.impact
  return requiredText(value.runId) && requiredText(value.incidentId) && ['completed', 'failed'].includes(value.status as string) && ['rules-v1', 'model'].includes(value.provider as string) && isDate(value.startedAt) && isDate(value.completedAt) && requiredText(value.incidentSummary) && severities.includes(value.severity as typeof severities[number]) && typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1 && stringArray(value.evidenceEventIds, 30) && requiredText(value.observedPattern) && isObject(impact) && isPaise(impact.failedPayments) && isPaise(impact.unresolvedAmountPaise) && isPaise(impact.recoveredAmountPaise) && isProposal(value.recommendedAction) && stringArray(value.missingContext, 10) && (value.errorMessage === undefined || validText(value.errorMessage))
}
function isOperatorAction(value: unknown): boolean {
  if (!isObject(value)) return false
  return requiredText(value.actionId) && actionTypes.includes(value.type as ActionType) && requiredText(value.operator) && isDate(value.approvedAt)
}
export function isIncident(value: unknown): value is Incident {
  if (!isObject(value)) return false
  return requiredText(value.incidentId) && ['payment_failure', 'refund_failure', 'payment_dispute', 'subscription_risk'].includes(value.incidentType as string) && statuses.includes(value.status as typeof statuses[number]) && severities.includes(value.severity as typeof severities[number]) && requiredText(value.title) && requiredText(value.customerReference) && isPaise(value.amountAtRiskPaise) && isPaise(value.recoveredAmountPaise) && value.recoveredAmountPaise <= value.amountAtRiskPaise && stringArray(value.eventIds, 100) && isPaise(value.eventCount) && value.eventCount >= value.eventIds.length && requiredText(value.summary) && isDate(value.createdAt) && isDate(value.updatedAt) && isDate(value.latestEventAt) && (value.paymentMethod === undefined || validText(value.paymentMethod, 300)) && (value.currency === undefined || isCurrency(value.currency)) && (value.agentRun === undefined || isInvestigation(value.agentRun)) && (value.actionProposal === undefined || isProposal(value.actionProposal)) && (value.operatorAction === undefined || isOperatorAction(value.operatorAction))
}
export function isDashboard(value: unknown): value is Dashboard {
  if (!isObject(value)) return false
  const eventWindow = value.eventWindow
  return isDate(value.generatedAt) && ['test', 'live'].includes(value.environment as string) && ['capturedVolumePaise', 'failedAmountAtRiskPaise', 'recoveredAmountPaise', 'openIncidentCount', 'completedInvestigations'].every(key => isPaise(value[key])) && isObject(eventWindow) && isPaise(eventWindow.loadedEventCount) && (eventWindow.earliestOccurredAt === undefined || isDate(eventWindow.earliestOccurredAt)) && (eventWindow.latestOccurredAt === undefined || isDate(eventWindow.latestOccurredAt)) && Array.isArray(value.recentEvents) && value.recentEvents.length <= 12 && value.recentEvents.every(isPaymentOpsEvent) && Array.isArray(value.attentionIncidents) && value.attentionIncidents.length <= 6 && value.attentionIncidents.every(isIncident)
}
export function isConnectionStatus(value: unknown): value is ConnectionStatus {
  if (!isObject(value)) return false
  return value.provider === 'razorpay' && ['test', 'live'].includes(value.environment as string) && validText(value.webhookUrl, 1000) && ['webhookSecretConfigured', 'apiKeyConfigured', 'historyImportAvailable', 'databaseConfigured'].every(key => typeof value[key] === 'boolean') && (value.lastEventReceivedAt === undefined || isDate(value.lastEventReceivedAt))
}
export function isHistoryImportResult(value: unknown): value is HistoryImportResult {
  if (!isObject(value)) return false
  return ['paymentsScanned', 'eventsImported', 'incidentsCreated'].every(key => isPaise(value[key])) && typeof value.hasMore === 'boolean' && (value.nextSkip === undefined || isPaise(value.nextSkip)) && (!value.hasMore || value.nextSkip !== undefined)
}
export function isAutoPolicy(value: unknown): value is AutoPolicy {
  if (!isObject(value)) return false
  return requiredText(value.policyId, 120) && requiredText(value.name, 120) && typeof value.enabled === 'boolean' && Array.isArray(value.incidentTypes) && value.incidentTypes.every((t: unknown) => ['payment_failure', 'refund_failure', 'payment_dispute', 'subscription_risk'].includes(t as string)) && Array.isArray(value.severities) && value.severities.every((s: unknown) => severities.includes(s as typeof severities[number])) && typeof value.minConfidence === 'number' && value.minConfidence >= 0 && value.minConfidence <= 1 && (value.maxAmountPaise === null || isPaise(value.maxAmountPaise)) && actionTypes.includes(value.action as ActionType) && typeof value.requireHumanForEscalate === 'boolean' && isDate(value.createdAt) && isDate(value.updatedAt)
}
export function isIncidentDetail(value: unknown): value is IncidentDetail {
  if (!isObject(value) || !isIncident(value.incident) || !Array.isArray(value.events) || !value.events.every(isPaymentOpsEvent) || !Array.isArray(value.audit) || value.audit.length > 50) return false
  const incident = value.incident
  const events = value.events
  if (!events.every(event => incident.eventIds.includes(event.eventId))) return false
  const run = incident.agentRun
  if (run && !run.evidenceEventIds.every(eventId => incident.eventIds.includes(eventId))) return false
  return value.audit.every(entry => isObject(entry) && requiredText(entry.auditId) && entry.incidentId === incident.incidentId && isDate(entry.at) && ['system', 'agent', 'operator'].includes(entry.actor as string) && requiredText(entry.action) && requiredText(entry.detail))
}
export const validAction = (value: string): value is ActionType => actionTypes.includes(value as ActionType)
