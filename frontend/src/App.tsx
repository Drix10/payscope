import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Bot, CircleDollarSign, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { SpatialScroll } from './SpatialScroll'
import { getApiErrorMessage, isAutoPolicy, isConnectionStatus, isDashboard, isHistoryImportResult, isIncident, isIncidentDetail, isRequestCancelled, paymentOpsApi, paymentOpsPath, validAction } from './api'
import { Navbar } from './components/layout/Navbar'
import { DashboardSidebar, WorkspaceSection } from './components/paymentops/DashboardSidebar'
import { DashboardWorkspace } from './components/paymentops/DashboardWorkspace'
import { AutoPolicy, ConnectionStatus, Dashboard, Incident, IncidentDetail as IncidentDetailData } from './types/paymentOps'

const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100)
const relative = (value: string) => {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return 'unknown'
  const seconds = Math.max(0, Math.round((Date.now() - parsed) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

export default function App() {
  const [viewMode, setViewMode] = useState<'showcase' | 'dashboard'>('showcase')
  const [workspaceSection, setWorkspaceSection] = useState<WorkspaceSection>('overview')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [selected, setSelected] = useState<IncidentDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [importing, setImporting] = useState(false)
  const [historyProgress, setHistoryProgress] = useState<{ days: number; nextSkip: number } | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [policies, setPolicies] = useState<AutoPolicy[]>([])
  const [policyBusy, setPolicyBusy] = useState(false)

  const fgController = useRef<AbortController | null>(null)
  const bgController = useRef<AbortController | null>(null)
  const detailController = useRef<AbortController | null>(null)
  const investigateController = useRef<AbortController | null>(null)
  const actionController = useRef<AbortController | null>(null)
  const importController = useRef<AbortController | null>(null)
  const policyController = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  const clearAllControllers = useCallback(() => {
    fgController.current?.abort()
    bgController.current?.abort()
    detailController.current?.abort()
    investigateController.current?.abort()
    actionController.current?.abort()
    importController.current?.abort()
    policyController.current?.abort()
  }, [])

  const refresh = useCallback(async (background = false) => {
    const controller = new AbortController()
    if (background) {
      bgController.current?.abort()
      bgController.current = controller
    } else {
      fgController.current?.abort()
      fgController.current = controller
      setLoading(true)
    }
    try {
      const [dashboardResult, connectionResult, incidentResult] = await Promise.all([
        paymentOpsApi.get(paymentOpsPath('/api/payment-ops/dashboard'), { signal: controller.signal }),
        paymentOpsApi.get(paymentOpsPath('/api/payment-ops/connection'), { signal: controller.signal }),
        paymentOpsApi.get(paymentOpsPath('/api/payment-ops/incidents'), { signal: controller.signal }),
      ])
      if (!mounted.current) return
      if (background && bgController.current !== controller) return
      if (!background && fgController.current !== controller) return
      if (dashboardResult.data?.success !== true || !isDashboard(dashboardResult.data.data)) throw new Error('Invalid dashboard response')
      if (connectionResult.data?.success !== true || !isConnectionStatus(connectionResult.data.data)) throw new Error('Invalid connection response')
      if (incidentResult.data?.success !== true || !Array.isArray(incidentResult.data.data)) throw new Error('Invalid incident response')
      const rows = (incidentResult.data.data as unknown[]).filter(isIncident)
      // Strict: if any row is malformed, surface error instead of silently filtering
      if (rows.length !== (incidentResult.data.data as unknown[]).length) throw new Error('Server returned malformed incident data')
      setDashboard(dashboardResult.data.data)
      setConnection(connectionResult.data.data)
      setIncidents(rows)
      setErrorMessage(null)
    } catch (error) {
      if (mounted.current && !isRequestCancelled(error)) setErrorMessage(getApiErrorMessage(error, 'Unable to refresh the PayScope dashboard.'))
    } finally {
      if (mounted.current) {
        if (background && bgController.current === controller) bgController.current = null
        if (!background && fgController.current === controller) {
          fgController.current = null
          setLoading(false)
        }
      }
    }
  }, [])

  const openIncident = useCallback(async (incident: Incident) => {
    detailController.current?.abort()
    const controller = new AbortController()
    detailController.current = controller
    setDetailLoading(true)
    try {
      const response = await paymentOpsApi.get(paymentOpsPath(`/api/payment-ops/incidents/${encodeURIComponent(incident.incidentId)}`), { signal: controller.signal })
      if (response.data?.success !== true || !isIncidentDetail(response.data.data)) throw new Error('Invalid incident detail')
      if (mounted.current && detailController.current === controller) setSelected(response.data.data)
    } catch (error) {
      if (mounted.current && detailController.current === controller && !isRequestCancelled(error)) setErrorMessage(getApiErrorMessage(error, 'Unable to load the selected incident.'))
    } finally {
      if (mounted.current && detailController.current === controller) setDetailLoading(false)
    }
  }, [])

  const closeIncident = useCallback(() => {
    detailController.current?.abort()
    investigateController.current?.abort()
    actionController.current?.abort()
    setDetailLoading(false)
    setActionPending(false)
    setSelected(null)
  }, [])

  const investigate = useCallback(async () => {
    if (!selected) return
    const incidentId = selected.incident.incidentId
    investigateController.current?.abort()
    const controller = new AbortController()
    investigateController.current = controller
    setActionPending(true)
    try {
      const response = await paymentOpsApi.post(paymentOpsPath(`/api/payment-ops/incidents/${encodeURIComponent(incidentId)}/investigate`), {}, { signal: controller.signal })
      if (response.data?.success !== true) throw new Error('Invalid investigation response')
      if (!mounted.current || investigateController.current !== controller) return
      // Verify selection still same before reopening
      if (selected.incident.incidentId !== incidentId) return
      await openIncident(selected.incident)
      await refresh()
      if (mounted.current && investigateController.current === controller) setStatusMessage('Investigation completed and attached to the incident.')
    } catch (error) {
      if (mounted.current && investigateController.current === controller && !isRequestCancelled(error)) setErrorMessage(getApiErrorMessage(error, 'Unable to run the investigation.'))
    } finally {
      if (mounted.current && investigateController.current === controller) {
        investigateController.current = null
        setActionPending(false)
      }
    }
  }, [openIncident, refresh, selected])

  const act = useCallback(async (type: string) => {
    if (!selected || !validAction(type)) return
    const incidentId = selected.incident.incidentId
    actionController.current?.abort()
    const controller = new AbortController()
    actionController.current = controller
    setActionPending(true)
    try {
      const response = await paymentOpsApi.post(paymentOpsPath(`/api/payment-ops/incidents/${encodeURIComponent(incidentId)}/actions`), { type, operator: 'Payment operations admin' }, { signal: controller.signal })
      if (response.data?.success !== true || !isIncident(response.data.data)) throw new Error('Invalid action response')
      if (!mounted.current || actionController.current !== controller) return
      await openIncident(response.data.data)
      await refresh()
      if (mounted.current && actionController.current === controller) setStatusMessage(type === 'dismiss' ? 'Incident dismissed. No financial action was taken.' : 'Operator decision recorded. No financial action was taken.')
    } catch (error) {
      if (mounted.current && actionController.current === controller && !isRequestCancelled(error)) setErrorMessage(getApiErrorMessage(error, 'Unable to record the operator decision.'))
    } finally {
      if (mounted.current && actionController.current === controller) {
        actionController.current = null
        setActionPending(false)
      }
    }
  }, [openIncident, refresh, selected])

  const importHistory = useCallback(async (days: number, skip = 0) => {
    importController.current?.abort()
    const controller = new AbortController()
    importController.current = controller
    setImporting(true)
    try {
      const response = await paymentOpsApi.post(paymentOpsPath('/api/payment-ops/import-history'), { days, skip }, { signal: controller.signal })
      if (response.data?.success !== true || !isHistoryImportResult(response.data.data)) throw new Error('Invalid import response')
      if (!mounted.current || importController.current !== controller) return
      const result = response.data.data
      setHistoryProgress(result.hasMore && result.nextSkip !== undefined ? { days, nextSkip: result.nextSkip } : null)
      await refresh()
      if (mounted.current && importController.current === controller) setStatusMessage(`Imported ${result.eventsImported} payment events from ${result.paymentsScanned} records.${result.hasMore ? ' Continue to import the next batch.' : ''}`)
    } catch (error) {
      if (mounted.current && importController.current !== controller) return
      if (!isRequestCancelled(error)) setErrorMessage(getApiErrorMessage(error, 'Unable to import Razorpay payment history. Confirm the server-side Test Mode API keys.'))
    } finally {
      if (mounted.current && importController.current === controller) {
        importController.current = null
        setImporting(false)
      }
    }
  }, [refresh])

  const fetchPolicies = useCallback(async () => {
    policyController.current?.abort()
    const controller = new AbortController()
    policyController.current = controller
    try {
      const res = await paymentOpsApi.get(paymentOpsPath('/api/payment-ops/policies'), { signal: controller.signal })
      if (!mounted.current || policyController.current !== controller) return
      if (res.data?.success !== true || !Array.isArray(res.data.data)) throw new Error('Invalid policies response')
      const rows = (res.data.data as unknown[]).filter(isAutoPolicy)
      if (rows.length !== (res.data.data as unknown[]).length) throw new Error('Server returned malformed policy data')
      setPolicies(rows)
    } catch (error) {
      if (!isRequestCancelled(error)) setErrorMessage(getApiErrorMessage(error, 'Unable to load policies.'))
    } finally {
      if (mounted.current && policyController.current === controller) policyController.current = null
    }
  }, [])

  const togglePolicy = useCallback(async (policy: AutoPolicy) => {
    policyController.current?.abort()
    const controller = new AbortController()
    policyController.current = controller
    setPolicyBusy(true)
    try {
      const res = await paymentOpsApi.post(paymentOpsPath('/api/payment-ops/policies'), { ...policy, enabled: !policy.enabled }, { signal: controller.signal })
      if (res.data?.success !== true || !isAutoPolicy(res.data.data)) throw new Error('Invalid policy')
      if (!mounted.current || policyController.current !== controller) return
      setPolicies(prev => prev.map(p => (p.policyId === policy.policyId ? res.data.data as AutoPolicy : p)))
      setStatusMessage(`Policy "${policy.name}" ${!policy.enabled ? 'enabled' : 'disabled'}.`)
    } catch (error) {
      if (mounted.current && policyController.current === controller && !isRequestCancelled(error)) setErrorMessage(getApiErrorMessage(error, 'Unable to toggle policy.'))
    } finally {
      if (mounted.current && policyController.current === controller) {
        policyController.current = null
        setPolicyBusy(false)
      }
    }
  }, [])

  const deletePolicy = useCallback(async (policyId: string) => {
    policyController.current?.abort()
    const controller = new AbortController()
    policyController.current = controller
    setPolicyBusy(true)
    try {
      const res = await paymentOpsApi.delete(paymentOpsPath(`/api/payment-ops/policies/${encodeURIComponent(policyId)}`), { signal: controller.signal })
      if (res.data?.success !== true) throw new Error('Invalid delete response')
      if (!mounted.current || policyController.current !== controller) return
      setPolicies(prev => prev.filter(p => p.policyId !== policyId))
      setStatusMessage('Policy removed.')
    } catch (error) {
      if (mounted.current && policyController.current === controller && !isRequestCancelled(error)) setErrorMessage(getApiErrorMessage(error, 'Unable to delete policy.'))
    } finally {
      if (mounted.current && policyController.current === controller) {
        policyController.current = null
        setPolicyBusy(false)
      }
    }
  }, [])

  const createPolicy = useCallback(async (draft: Partial<AutoPolicy> & { name: string; action: AutoPolicy['action'] }) => {
    policyController.current?.abort()
    const controller = new AbortController()
    policyController.current = controller
    setPolicyBusy(true)
    try {
      const res = await paymentOpsApi.post(paymentOpsPath('/api/payment-ops/policies'), draft, { signal: controller.signal })
      if (res.data?.success !== true || !isAutoPolicy(res.data.data)) throw new Error('Invalid policy')
      if (!mounted.current || policyController.current !== controller) return
      setPolicies(prev => [...prev, res.data.data as AutoPolicy])
      setStatusMessage(`Policy "${(res.data.data as AutoPolicy).name}" created.`)
    } catch (error) {
      if (mounted.current && policyController.current === controller && !isRequestCancelled(error)) setErrorMessage(getApiErrorMessage(error, 'Unable to create policy. Check dismissal caps (≤₹1000, low/med only).'))
    } finally {
      if (mounted.current && policyController.current === controller) {
        policyController.current = null
        setPolicyBusy(false)
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    if (viewMode === 'dashboard') {
      void refresh()
      void fetchPolicies()
    } else {
      // Leaving dashboard: abort in-flight dashboard work
      fgController.current?.abort()
      bgController.current?.abort()
      detailController.current?.abort()
      investigateController.current?.abort()
      actionController.current?.abort()
      importController.current?.abort()
      policyController.current?.abort()
      setLoading(true)
    }
    const interval = window.setInterval(() => {
      if (viewMode === 'dashboard' && !document.hidden) void refresh(true)
    }, 30_000)
    const onVisibilityChange = () => {
      if (viewMode === 'dashboard' && !document.hidden) void refresh(true)
    }
    const onOpenDashboard = () => setViewMode('dashboard')
    document.addEventListener('payscope-open-dashboard', onOpenDashboard)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('payscope-open-dashboard', onOpenDashboard)
    }
  }, [refresh, fetchPolicies, viewMode])

  // Keep selected detail in sync, and clear if incident disappears
  useEffect(() => {
    if (!selected) return
    const stillExists = incidents.some(incident => incident.incidentId === selected.incident.incidentId)
    if (!stillExists) {
      detailController.current?.abort()
      setSelected(null)
      setDetailLoading(false)
      return
    }
    const refreshedIncident = incidents.find(incident => incident.incidentId === selected.incident.incidentId)
    if (refreshedIncident && refreshedIncident.updatedAt !== selected.incident.updatedAt) void openIncident(refreshedIncident)
  }, [incidents, openIncident, selected])

  useEffect(() => {
    if (!statusMessage && !errorMessage) return
    const timer = window.setTimeout(() => {
      setStatusMessage(null)
      setErrorMessage(null)
    }, 6_000)
    return () => window.clearTimeout(timer)
  }, [statusMessage, errorMessage])

  useEffect(() => () => {
    mounted.current = false
    clearAllControllers()
  }, [clearAllControllers])

  if (viewMode === 'dashboard')
    return (
      <main className="min-h-screen overflow-x-hidden bg-[#040406] text-white">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(0,255,135,.08),transparent_30%),radial-gradient(circle_at_10%_20%,rgba(56,189,248,.08),transparent_28%)]" />
        <Navbar viewMode={viewMode} onViewModeChange={setViewMode} environment={dashboard?.environment ?? connection?.environment ?? 'test'} />
        <header className="relative border-b border-white/[.08] bg-[#040406]/85 pt-20 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-3 px-5 py-4 lg:px-8">
            <div>
              <p className="text-sm font-bold tracking-tight">Operations workspace</p>
              <p className="text-[10px] text-neutral-500">A clear place to understand, review, and control payment operations.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide ${dashboard?.environment === 'live' ? 'border-rose-400/30 bg-rose-400/10 text-rose-100' : 'border-amber-300/30 bg-amber-300/10 text-amber-100'}`}>{dashboard?.environment === 'live' ? 'Live mode' : 'Test mode'}</span>
              <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-white/10 p-2 text-neutral-300 transition-colors hover:bg-white/[.08] disabled:opacity-50" aria-label="Refresh dashboard">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </header>
        <div className="bg-obsidian-grid relative mx-auto grid max-w-[1480px] gap-5 px-4 py-5 sm:px-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8 lg:py-7">
          <DashboardSidebar activeSection={workspaceSection} onChange={setWorkspaceSection} dashboard={dashboard} connection={connection} />
          <div className="min-w-0">
            {errorMessage && (
              <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-400/25 bg-rose-400/[.08] px-3 py-2.5 text-[11px] text-rose-100">
                <span>{errorMessage}</span>
                <button type="button" onClick={() => { setErrorMessage(null); void refresh() }} className="rounded-lg border border-rose-300/20 px-2 py-1 text-[10px] font-semibold hover:bg-rose-300/10">Retry</button>
              </div>
            )}
            {statusMessage && <div role="status" className="mb-4 rounded-xl border border-[#00ff87]/20 bg-[#00ff87]/[.07] px-3 py-2.5 text-[11px] text-[#b8ffd9]">{statusMessage}</div>}
            <DashboardWorkspace
              section={workspaceSection}
              dashboard={dashboard}
              connection={connection}
              incidents={incidents}
              selected={selected}
              loading={loading}
              detailLoading={detailLoading}
              actionPending={actionPending}
              importing={importing}
              historyProgress={historyProgress}
              policies={policies}
              policyBusy={policyBusy}
              onSelectIncident={incident => { setWorkspaceSection('incidents'); void openIncident(incident) }}
              onCloseIncident={closeIncident}
              onInvestigate={() => void investigate()}
              onAction={type => void act(type)}
              onImport={(days, skip) => void importHistory(days, skip)}
              onTogglePolicy={policy => void togglePolicy(policy)}
              onDeletePolicy={id => void deletePolicy(id)}
              onCreatePolicy={draft => void createPolicy(draft)}
              onRefresh={() => void refresh()}
            />
          </div>
        </div>
      </main>
    )

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#040406] text-white">
      <Navbar viewMode={viewMode} onViewModeChange={setViewMode} environment={dashboard?.environment ?? connection?.environment ?? 'test'} />
      <SpatialScroll />
    </main>
  )
}
