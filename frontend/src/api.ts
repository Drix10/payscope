import { APP_CONFIG, apiUrl } from './config'
import type { AuditEntry, Incident, IncidentDetail, MvpHealth, Proposal } from './types/mvp'

type Envelope<T> = { success: true; data: T } | { success: false; error?: { message?: string } }
type Guard<T> = (value: unknown) => value is T

async function request<T>(path: string, guard: Guard<T>, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = window.setTimeout(abort, APP_CONFIG.apiTimeoutMs)
  try {
    const response = await fetch(apiUrl(path), { headers: { Accept: 'application/json' }, signal: controller.signal })
    const body = await response.json().catch(() => null) as Envelope<T> | null
    if (!response.ok || !body || body.success !== true) throw new Error(body && 'error' in body ? body.error?.message || 'Request failed' : 'Request failed')
    if (!guard(body.data)) throw new Error('The server returned an invalid MVP response.')
    return body.data
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The API request timed out or was cancelled.')
    throw error
  } finally { window.clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}

async function approvalRequest<T>(path: string, token: string, guard: Guard<T>, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = window.setTimeout(abort, APP_CONFIG.apiTimeoutMs)
  try {
    const response = await fetch(apiUrl(path), { method: 'POST', headers: { Accept: 'application/json', 'x-payscope-demo-approval-token': token }, signal: controller.signal })
    const body = await response.json().catch(() => null) as Envelope<T> | null
    if (!response.ok || !body || body.success !== true) throw new Error(body && 'error' in body ? body.error?.message || 'Proposal approval failed' : 'Proposal approval failed')
    if (!guard(body.data)) throw new Error('The server returned an invalid proposal response.')
    return body.data
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The proposal approval request timed out or was cancelled.')
    throw error
  } finally { window.clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}

export const mvpApi = {
  health: (signal?: AbortSignal) => request<MvpHealth>('/api/mvp/health', isHealth, signal),
  incidents: (signal?: AbortSignal) => request<Incident[]>('/api/mvp/incidents?limit=100', isIncidents, signal),
  incident: (id: string, signal?: AbortSignal) => request<IncidentDetail>(`/api/mvp/incidents/${encodeURIComponent(id)}`, isDetail, signal),
  audit: (incidentId: string, signal?: AbortSignal) => request<AuditEntry[]>(`/api/mvp/audit?incidentId=${encodeURIComponent(incidentId)}`, isAudits, signal),
  approve: (proposalId: string, token: string, signal?: AbortSignal) => approvalRequest<Proposal>(`/api/mvp/proposals/${encodeURIComponent(proposalId)}/approve`, token, isProposal, signal),
}

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1_000
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const date = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value))
const isIncident = (value: unknown): value is Incident => { const row = object(value); return Boolean(row && text(row.id) && text(row.organizationId) && ['CRITICAL', 'HIGH', 'MEDIUM', 'MONITOR'].includes(String(row.riskTier)) && ['OPEN', 'MONITORING', 'ESCALATED', 'DISPUTE_OPENED', 'RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED'].includes(String(row.status)) && amount(row.totalFailedAmountPaise) && amount(row.recoveredAmountPaise) && amount(row.remainingAmountPaise) && Array.isArray(row.correlatedEventIds) && row.correlatedEventIds.every(text) && date(row.openedAt) && (row.resolvedAt === null || date(row.resolvedAt)) && date(row.updatedAt)) }
const isHealth = (value: unknown): value is MvpHealth => { const row = object(value); return Boolean(row && text(row.organizationId) && row.pipeline === 'agentic_mvp' && row.testMode === true && row.communications === 'proposal_only') }
const isIncidents = (value: unknown): value is Incident[] => Array.isArray(value) && value.length <= 100 && value.every(isIncident)
const isEvent = (value: unknown): boolean => {
  const row = object(value); const event = row && object(row.event); const enrichment = row?.enrichment
  const validEnrichment = enrichment === null || Boolean(object(enrichment) && text(object(enrichment)?.source) && text(object(enrichment)?.failureAttribution) && typeof object(enrichment)?.gatewayHealthScore === 'number' && Number.isFinite(object(enrichment)?.gatewayHealthScore) && typeof object(enrichment)?.gatewayInDowntime === 'boolean')
  return Boolean(row && text(row.id) && text(row.organizationId) && event && text(event.eventType) && date(event.occurredAt) && (event.amountPaise === undefined || amount(event.amountPaise)) && (event.paymentMethod === undefined || text(event.paymentMethod)) && validEnrichment)
}
const isProposal = (value: unknown): value is Proposal => { const row = object(value); return Boolean(row && text(row.id) && text(row.organizationId) && text(row.incidentId) && text(row.actionType) && ['pending', 'approved', 'simulated', 'cancelled_by_dispute', 'cancelled_by_recovery', 'failed'].includes(String(row.status)) && date(row.proposedAt) && (row.approvedAt === null || date(row.approvedAt)) && (row.approvedBy === null || text(row.approvedBy)) && object(row.content) && (row.deliveryResult === null || object(row.deliveryResult))) }
const isDetail = (value: unknown): value is IncidentDetail => { const row = object(value); return Boolean(row && isIncident(row.incident) && Array.isArray(row.events) && row.events.length <= 100 && row.events.every(isEvent) && Array.isArray(row.proposals) && row.proposals.length <= 100 && row.proposals.every(isProposal)) }
const isAudits = (value: unknown): value is AuditEntry[] => Array.isArray(value) && value.length <= 200 && value.every(value => { const row = object(value); return Boolean(row && text(row.id) && amount(row.sequenceNumber) && text(row.eventType) && text(row.actorType) && text(row.decision) && text(row.rationale) && date(row.createdAt)) })
