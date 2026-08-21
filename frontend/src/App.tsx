import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Bot, CircleDollarSign, LayoutGrid, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { SpatialScroll } from './SpatialScroll'
import { paymentOpsApi, paymentOpsPath, getApiErrorMessage, isAutoPolicy, isConnectionStatus, isDashboard, isHistoryImportResult, isIncident, isIncidentDetail, isRequestCancelled, validAction } from './api'
import { ConnectionPanel } from './components/paymentops/ConnectionPanel'
import { IncidentDetail } from './components/paymentops/IncidentDetail'
import { IncidentList } from './components/paymentops/IncidentList'
import { MetricCard } from './components/paymentops/MetricCard'
import { PolicyPanel } from './components/paymentops/PolicyPanel'
import { CheckoutButton } from './components/paymentops/CheckoutButton'
import { AutoPolicy, ConnectionStatus, Dashboard, Incident, IncidentDetail as IncidentDetailData } from './types/paymentOps'

const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100)
const relative = (value: string) => { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) return 'unknown'; const seconds = Math.max(0, Math.round((Date.now() - parsed) / 1000)); if (seconds < 60) return 'just now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`; return `${Math.floor(seconds / 3600)}h ago` }

export default function App() {
  const [viewMode, setViewMode] = useState<'showcase' | 'dashboard'>('showcase')
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
  const refreshController = useRef<AbortController | null>(null)
  const detailController = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const selectedId = selected?.incident.incidentId

  const refresh = useCallback(async (background = false) => {
    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    if (!background) setLoading(true)
    try {
      const [dashboardResult, connectionResult, incidentResult] = await Promise.all([
        paymentOpsApi.get(paymentOpsPath('/api/payment-ops/dashboard'), { signal: controller.signal }),
        paymentOpsApi.get(paymentOpsPath('/api/payment-ops/connection'), { signal: controller.signal }),
        paymentOpsApi.get(paymentOpsPath('/api/payment-ops/incidents'), { signal: controller.signal }),
      ])
      if (!mounted.current || refreshController.current !== controller) return
      if (!dashboardResult.data?.success || !isDashboard(dashboardResult.data.data)) throw new Error('Invalid dashboard response')
      if (!connectionResult.data?.success || !isConnectionStatus(connectionResult.data.data)) throw new Error('Invalid connection response')
      const rows = Array.isArray(incidentResult.data?.data) ? incidentResult.data.data.filter(isIncident) : []
      if (!incidentResult.data?.success) throw new Error('Invalid incident response')
      setDashboard(dashboardResult.data.data)
      setConnection(connectionResult.data.data)
      setIncidents(rows)
     } catch (error) { if (mounted.current && !isRequestCancelled(error)) setErrorMessage(getApiErrorMessage(error, 'Unable to refresh the PayScope dashboard.')) } finally { if (mounted.current && refreshController.current === controller && !background) setLoading(false) }
  }, [])

  const openIncident = useCallback(async (incident: Incident) => {
    detailController.current?.abort()
    const controller = new AbortController()
    detailController.current = controller
    setDetailLoading(true)
    try { const response = await paymentOpsApi.get(paymentOpsPath(`/api/payment-ops/incidents/${encodeURIComponent(incident.incidentId)}`), { signal: controller.signal }); if (!response.data?.success || !isIncidentDetail(response.data.data)) throw new Error('Invalid incident detail'); if (mounted.current && detailController.current === controller) setSelected(response.data.data) }
    catch (error) { if (mounted.current && detailController.current === controller && !isRequestCancelled(error)) setErrorMessage(getApiErrorMessage(error, 'Unable to load the selected incident.')) } finally { if (mounted.current && detailController.current === controller) setDetailLoading(false) }
  }, [])

  const closeIncident = useCallback(() => {
    detailController.current?.abort()
    setDetailLoading(false)
    setSelected(null)
  }, [])

  const investigate = useCallback(async () => {
    if (!selected) return
    setActionPending(true)
    try { const response = await paymentOpsApi.post(paymentOpsPath(`/api/payment-ops/incidents/${encodeURIComponent(selected.incident.incidentId)}/investigate`)); if (!response.data?.success) throw new Error('Invalid investigation response'); await openIncident(selected.incident); await refresh(); setStatusMessage('Investigation completed and attached to the incident.') }
    catch (error) { setErrorMessage(getApiErrorMessage(error, 'Unable to run the investigation.')) } finally { if (mounted.current) setActionPending(false) }
  }, [openIncident, refresh, selected])

  const act = useCallback(async (type: string) => {
    if (!selected || !validAction(type)) return
    setActionPending(true)
    try { const response = await paymentOpsApi.post(paymentOpsPath(`/api/payment-ops/incidents/${encodeURIComponent(selected.incident.incidentId)}/actions`), { type, operator: 'Payment operations admin' }); if (!response.data?.success || !isIncident(response.data.data)) throw new Error('Invalid action response'); await openIncident(response.data.data); await refresh(); setStatusMessage(type === 'dismiss' ? 'Incident dismissed. No financial action was taken.' : 'Operator decision recorded. No financial action was taken.') }
    catch (error) { setErrorMessage(getApiErrorMessage(error, 'Unable to record the operator decision.')) } finally { if (mounted.current) setActionPending(false) }
  }, [openIncident, refresh, selected])

  const importHistory = useCallback(async (days: number, skip = 0) => {
    setImporting(true)
    try { const response = await paymentOpsApi.post(paymentOpsPath('/api/payment-ops/import-history'), { days, skip }); if (!response.data?.success || !isHistoryImportResult(response.data.data)) throw new Error('Invalid import response'); const result = response.data.data; setHistoryProgress(result.hasMore && result.nextSkip !== undefined ? { days, nextSkip: result.nextSkip } : null); await refresh(); setStatusMessage(`Imported ${result.eventsImported} payment events from ${result.paymentsScanned} records.${result.hasMore ? ' Continue to import the next batch.' : ''}`) }
    catch (error) { setErrorMessage(getApiErrorMessage(error, 'Unable to import Razorpay payment history. Confirm the server-side Test Mode API keys.')) } finally { if (mounted.current) setImporting(false) }
  }, [refresh])

  const fetchPolicies = useCallback(async () => {
    try { const res = await paymentOpsApi.get(paymentOpsPath('/api/payment-ops/policies')); if (res.data?.success && Array.isArray(res.data.data)) setPolicies(res.data.data.filter(isAutoPolicy)) } catch { /* policies are optional */ }
  }, [])

  const togglePolicy = useCallback(async (policy: AutoPolicy) => {
    setPolicyBusy(true)
    try { const res = await paymentOpsApi.post(paymentOpsPath('/api/payment-ops/policies'), { ...policy, enabled: !policy.enabled }); if (!res.data?.success || !isAutoPolicy(res.data.data)) throw new Error('Invalid policy'); setPolicies(prev => prev.map(p => p.policyId === policy.policyId ? res.data.data : p)); setStatusMessage(`Policy "${policy.name}" ${!policy.enabled ? 'enabled' : 'disabled'}.`) } catch (error) { setErrorMessage(getApiErrorMessage(error, 'Unable to toggle policy.')) } finally { setPolicyBusy(false) }
  }, [])

  const deletePolicy = useCallback(async (policyId: string) => {
    setPolicyBusy(true)
    try { await paymentOpsApi.delete(paymentOpsPath(`/api/payment-ops/policies/${encodeURIComponent(policyId)}`)); setPolicies(prev => prev.filter(p => p.policyId !== policyId)); setStatusMessage('Policy removed.') } catch (error) { setErrorMessage(getApiErrorMessage(error, 'Unable to delete policy.')) } finally { setPolicyBusy(false) }
  }, [])

  const createPolicy = useCallback(async (draft: Partial<AutoPolicy> & { name: string; action: AutoPolicy['action'] }) => {
    setPolicyBusy(true)
    try { const res = await paymentOpsApi.post(paymentOpsPath('/api/payment-ops/policies'), draft); if (!res.data?.success || !isAutoPolicy(res.data.data)) throw new Error('Invalid policy'); setPolicies(prev => [...prev, res.data.data]); setStatusMessage(`Policy "${res.data.data.name}" created.`) } catch (error) { setErrorMessage(getApiErrorMessage(error, 'Unable to create policy. Check dismissal caps (≤₹1000, low/med only).')) } finally { setPolicyBusy(false) }
  }, [])

  useEffect(() => { mounted.current = true; if (viewMode === 'dashboard') { void refresh(); void fetchPolicies(); } const interval = window.setInterval(() => { if (viewMode === 'dashboard' && !document.hidden) void refresh(true) }, 30_000); const onVisibilityChange = () => { if (viewMode === 'dashboard' && !document.hidden) void refresh(true) }; const onOpenDashboard = () => setViewMode('dashboard'); document.addEventListener('payscope-open-dashboard', onOpenDashboard); document.addEventListener('visibilitychange', onVisibilityChange); return () => { mounted.current = false; refreshController.current?.abort(); detailController.current?.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibilityChange); document.removeEventListener('payscope-open-dashboard', onOpenDashboard) } }, [refresh, fetchPolicies, viewMode])
  useEffect(() => { if (!selected) return; const refreshedIncident = incidents.find(incident => incident.incidentId === selected.incident.incidentId); if (refreshedIncident && refreshedIncident.updatedAt !== selected.incident.updatedAt) void openIncident(refreshedIncident) }, [incidents, openIncident, selected])
  useEffect(() => { if (!statusMessage && !errorMessage) return; const timer = window.setTimeout(() => { setStatusMessage(null); setErrorMessage(null) }, 6_000); return () => window.clearTimeout(timer) }, [statusMessage, errorMessage])

  return <main className="min-h-screen overflow-x-hidden bg-[#040406] text-white">
    {viewMode === 'showcase' ? (
      <div className="relative">
        <header className="fixed top-5 left-1/2 z-40 flex -translate-x-1/2 items-center">
          <div className="smoked-glass hairline-border flex items-center gap-4 rounded-full px-5 py-2 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-2 pr-3 border-r border-white/10">
              <div className="rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 p-1 text-[#00ff87]"><Activity className="h-3.5 w-3.5" /></div>
              <span className="text-xs font-bold tracking-tight text-white">PayScope</span>
            </div>
            <button type="button" onClick={() => setViewMode('dashboard')} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-[11px] font-semibold transition-all hover:border-[#00ff87]/50 hover:text-white text-neutral-300">
              <LayoutGrid className="h-3 w-3" /> Open Dashboard
            </button>
          </div>
        </header>
        <SpatialScroll />
      </div>
    ) : (
      <>
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(0,255,135,.08),transparent_30%),radial-gradient(circle_at_10%_20%,rgba(56,189,248,.08),transparent_28%)]" /><header className="relative border-b border-white/[.08] bg-[#040406]/85 backdrop-blur-xl"><div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-3 px-5 py-4 lg:px-8"><div className="flex items-center gap-3"><button type="button" onClick={() => setViewMode('showcase')} aria-label="Back to showcase" className="rounded-xl border border-white/10 p-2 text-neutral-300 hover:bg-white/[.08]" title="Back to showcase"><LayoutGrid className="h-5 w-5" /></button><div><p className="text-sm font-bold tracking-tight">PayScope</p><p className="text-[10px] text-neutral-500">Razorpay payment incident command center</p></div></div><div className="flex items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide ${dashboard?.environment === 'live' ? 'border-rose-400/30 bg-rose-400/10 text-rose-100' : 'border-amber-300/30 bg-amber-300/10 text-amber-100'}`}>{dashboard?.environment === 'live' ? 'Live mode' : 'Test mode'}</span><span className="hidden items-center gap-1.5 rounded-full border border-[#00ff87]/20 bg-[#00ff87]/[.07] px-2.5 py-1 text-[9px] font-semibold text-[#b8ffd9] sm:flex"><ShieldCheck className="h-3 w-3" />Policy-driven autonomy</span><button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-white/10 p-2 text-neutral-300 hover:bg-white/[.08] disabled:opacity-50" aria-label="Refresh dashboard"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button></div></div></header>
    <div className="relative mx-auto max-w-[1480px] px-5 py-6 lg:px-8"><section className="mb-6 flex flex-col justify-between gap-4 rounded-2xl border border-white/[.08] bg-white/[.025] p-5 lg:flex-row lg:items-end"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#b8ffd9]">Operations overview</p><h1 className="mt-2 max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-3xl">Know what happened. See what the agent did. Keep financial control.</h1><p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-neutral-400">PayScope turns verified Razorpay signals into reviewable incidents. Investigations are evidence-bound; admin policies auto-execute safe actions within thresholds, everything else remains human-approved.</p></div><div className="flex items-center gap-2 rounded-xl border border-white/[.08] bg-black/20 px-3 py-2 text-[10px] text-neutral-400"><Bot className="h-4 w-4 text-[#00ff87]" /><span>{dashboard ? `${dashboard.completedInvestigations} investigations completed` : 'Connecting to investigation service'}</span></div></section>
      {errorMessage && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-400/25 bg-rose-400/[.08] px-3 py-2.5 text-[11px] text-rose-100"><span>{errorMessage}</span><button type="button" onClick={() => setErrorMessage(null)} className="text-rose-100 hover:text-white">×</button></div>}{statusMessage && <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#00ff87]/20 bg-[#00ff87]/[.07] px-3 py-2.5 text-[11px] text-[#b8ffd9]"><span>{statusMessage}</span><button type="button" onClick={() => setStatusMessage(null)} className="hover:text-white">×</button></div>}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><MetricCard label="Captured in loaded window" value={dashboard ? money(dashboard.capturedVolumePaise) : '—'} detail={dashboard ? `${dashboard.eventWindow.loadedEventCount} retained events` : 'Verified captured and paid events'} icon={CircleDollarSign} tone="mint" /><MetricCard label="Amount at risk" value={dashboard ? money(dashboard.failedAmountAtRiskPaise) : '—'} detail="Open incidents, net of linked recovery" icon={TriangleAlert} tone="rose" /><MetricCard label="Recovered" value={dashboard ? money(dashboard.recoveredAmountPaise) : '—'} detail="Linked verified success events" icon={ShieldCheck} tone="sky" /><MetricCard label="Open incidents" value={dashboard ? String(dashboard.openIncidentCount) : '—'} detail="Needs review, monitoring, or escalation" icon={Activity} tone="amber" /><MetricCard label="Last signal" value={connection?.lastEventReceivedAt ? relative(connection.lastEventReceivedAt) : 'None'} detail={connection?.lastEventReceivedAt ? 'Last verified webhook or import event' : 'Awaiting Razorpay Test Mode traffic'} icon={RefreshCw} tone="sky" /></section>
      <section className="mt-5 grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)_310px]"><IncidentList incidents={incidents} activeId={selectedId} onSelect={incident => void openIncident(incident)} loading={loading} /><IncidentDetail detail={selected} loading={detailLoading} onClose={closeIncident} onInvestigate={() => void investigate()} onAction={type => void act(type)} actionPending={actionPending} /><div className="space-y-4"><ConnectionPanel connection={connection} importing={importing} historyProgress={historyProgress} onImport={(days, skip) => void importHistory(days, skip)} /><CheckoutButton onSuccess={() => void refresh()} /><PolicyPanel policies={policies} onToggle={p => void togglePolicy(p)} onDelete={id => void deletePolicy(id)} onCreate={draft => void createPolicy(draft)} busy={policyBusy} /><section className="rounded-2xl border border-white/[.09] bg-[#090a0f]/80 p-4"><div className="flex items-center justify-between"><div><h2 className="text-xs font-bold text-white">Verified event stream</h2><p className="mt-0.5 text-[9px] text-neutral-500">Latest 12 received events</p></div><span className="text-[9px] text-neutral-500">{dashboard?.recentEvents.length ?? 0} shown</span></div><div className="mt-3 space-y-2">{dashboard?.recentEvents.length ? dashboard.recentEvents.slice(0, 7).map(event => `<div key=${event.eventId} className="rounded-xl border border-white/[.07] bg-black/15 p-2"><div className="flex items-center justify-between gap-2"><p className="truncate text-[10px] font-semibold text-neutral-200">${event.eventType}</p><span className="shrink-0 rounded bg-[#00ff87]/10 px-1.5 py-0.5 text-[8px] font-bold text-[#b8ffd9]">${event.source === "history_import" ? "import" : "verified"}</span></div><p className="mt-1 truncate text-[9px] text-neutral-500">${event.customerReference} · ${relative(event.occurredAt)}</p></div>`) : `<p className="rounded-xl border border-dashed border-white/[.1] p-3 text-[10px] leading-relaxed text-neutral-500">No events yet. Connect Razorpay Test Mode or import recent payment history.</p>`}</div></section></div></section></div>
    </>
    )}
  </main>
}
