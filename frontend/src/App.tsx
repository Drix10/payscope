import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, ArrowLeft, Bot, ChevronDown, CircleCheck, FileSearch, ListFilter, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Waypoints } from 'lucide-react'
import { mvpApi } from './api'
import { SpatialScroll } from './SpatialScroll'
import { Navbar } from './components/layout/Navbar'
import type { AuditEntry, AuditIntegrity, DashboardMetrics, DashboardQueryResult, Event, Incident, IncidentDetail as IncidentDetailRecord, MvpHealth, Proposal } from './types/mvp'

type IncidentDetail = Omit<IncidentDetailRecord, 'execution'> & { execution: any[] }

const money = (paise: number, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: /^[A-Z]{3}$/.test(currency) ? currency : 'INR', maximumFractionDigits: 0 }).format(paise / 100)
const stamp = (value: string) => { const time = Date.parse(value); return Number.isFinite(time) ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(time) : 'Unknown time' }
const label = (value: string | undefined) => {
  if (!value) return 'Unknown'
  if (value === 'DISMISSED') return 'Policy Blocked'
  if (value === 'MONITORING') return 'Monitoring'
  if (value === 'DISPUTE_OPENED') return 'Dispute Open'
  if (value === 'RESOLVED') return 'Recovered'
  if (value === 'OPEN') return 'Investigating'
  if (value === 'record_risk_signal') return 'Risk signal recorded'
  if (value === 'deliver_recovery_link_email') return 'Recovery email'
  if (value === 'capture_authorized_payment') return 'Capture payment'
  if (value === 'refund_payment') return 'Refund payment'
  if (value === 'submit_dispute_evidence') return 'Dispute evidence'
  if (value === 'resolve_infrastructure') return 'Infrastructure resolved'
  return value.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase())
}
const executionStateLabel: Record<string, string> = {
  queued: 'Queued', dispatching: 'Dispatching', accepted: 'SMTP accepted', unreconciled: 'Unreconciled',
  confirmed: 'Confirmed', retry_scheduled: 'Retry scheduled', compensating: 'Compensating', failed: 'Failed', cancelled: 'Cancelled',
  pending: 'Queued', simulated: 'Legacy simulation (not executed)',
}
const executionStateClass: Record<string, string> = {
  queued: 'border-sky-300/35 bg-sky-300/10 text-sky-100',
  dispatching: 'border-amber-300/35 bg-amber-300/10 text-amber-100',
  accepted: 'border-emerald-300/35 bg-emerald-300/10 text-emerald-100',
  unreconciled: 'border-orange-300/35 bg-orange-300/10 text-orange-100',
  confirmed: 'border-[#00ff87]/35 bg-[#00ff87]/10 text-[#b8f8d8]',
  retry_scheduled: 'border-violet-300/35 bg-violet-300/10 text-violet-100',
  compensating: 'border-cyan-300/35 bg-cyan-300/10 text-cyan-100',
  failed: 'border-rose-300/35 bg-rose-300/10 text-rose-100',
  cancelled: 'border-neutral-500/35 bg-neutral-500/10 text-neutral-300',
  pending: 'border-sky-300/35 bg-sky-300/10 text-sky-100',
  simulated: 'border-neutral-500/35 bg-neutral-500/10 text-neutral-300',
}
const riskOrder: Record<Incident['riskTier'], number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, MONITOR: 3 }
const queueViews: Array<{ value: Incident['status'] | 'ALL'; title: string }> = [
  { value: 'ALL', title: 'All active' }, { value: 'OPEN', title: 'Open' },
  { value: 'MONITORING', title: 'Monitoring' }, { value: 'DISPUTE_OPENED', title: 'Disputes' },
  { value: 'RESOLVED', title: 'Resolved' }, { value: 'DISMISSED', title: 'No action' },
]

export default function App() {
  const [viewMode, setViewMode] = useState<'showcase' | 'dashboard'>('showcase')
  const [health, setHealth] = useState<MvpHealth | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [filter, setFilter] = useState<Incident['status'] | 'ALL'>('ALL')
  const [loadedFilter, setLoadedFilter] = useState<Incident['status'] | 'ALL'>('ALL')
  const [selected, setSelected] = useState<IncidentDetail | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [integrity, setIntegrity] = useState<AuditIntegrity | null>(null)
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [query, setQuery] = useState('')
  const [queryResult, setQueryResult] = useState<DashboardQueryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [queryLoading, setQueryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const mounted = useRef(true)
  const selectedIdRef = useRef<string | null>(null)
  const refreshController = useRef<AbortController | null>(null)
  const detailController = useRef<AbortController | null>(null)
  const silentDetailController = useRef<AbortController | null>(null)
  const queryController = useRef<AbortController | null>(null)
  const detailSequence = useRef(0)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  const ordered = useMemo(() => [...incidents].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || riskOrder[a.riskTier] - riskOrder[b.riskTier]), [incidents])
  const totalAtRisk = useMemo(() => incidents.reduce((sum, incident) => sum + incident.remainingAmountPaise, 0), [incidents])

  const refresh = useCallback(async (isBackground = false) => {
    if (isBackground && refreshController.current !== null) return

    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    if (!isBackground) setLoading(true)

    try {
      const [nextHealth, nextIncidents, nextMetrics] = await Promise.all([
        mvpApi.health(controller.signal),
        mvpApi.incidents(filter === 'ALL' ? undefined : filter, controller.signal),
        mvpApi.dashboardMetrics(controller.signal).catch(() => null),
      ])

      if (!mounted.current || refreshController.current !== controller) return
      setHealth(nextHealth)
      setIncidents(nextIncidents)
      setMetrics(nextMetrics)
      setLoadedFilter(filter)
      setError(null)

      // Silent detail refresh if an incident is currently selected
      const currentSelectedId = selectedIdRef.current
      if (currentSelectedId && nextIncidents.some(i => i.id === currentSelectedId)) {
        silentDetailController.current?.abort()
        const silentController = new AbortController()
        silentDetailController.current = silentController
        detailSequence.current += 1
        const seq = detailSequence.current

        void (async () => {
          try {
            const [detail, entries] = await Promise.all([
              mvpApi.incident(currentSelectedId, silentController.signal),
              mvpApi.audit(currentSelectedId, silentController.signal),
            ])
            if (mounted.current && selectedIdRef.current === currentSelectedId && detailSequence.current === seq && !silentController.signal.aborted && !controller.signal.aborted) {
              setSelected(detail)
              setAudit(entries)
            }
          } catch {
            // Ignore background detail update errors silently
          } finally {
            if (silentDetailController.current === silentController) {
              silentDetailController.current = null
            }
          }
        })()
      }
    } catch (reason) {
      if (!controller.signal.aborted && mounted.current && !isBackground) {
        const msg = reason instanceof Error ? reason.message : 'Unable to load autonomous incident data.'
        if (!msg.includes('Too many')) setError(msg)
      }
    } finally {
      if (mounted.current && refreshController.current === controller) {
        refreshController.current = null
        if (!isBackground) setLoading(false)
      }
    }
  }, [filter])

  const openIncident = useCallback(async (incident: Incident) => {
    detailController.current?.abort()
    silentDetailController.current?.abort()
    const controller = new AbortController()
    detailController.current = controller
    detailSequence.current += 1
    const seq = detailSequence.current
    setSelectedId(incident.id)
    setSelected(null)
    setAudit([])
    setIntegrity(null)
    setDetailLoading(true)

    try {
      const [detail, entries, chain] = await Promise.all([
        mvpApi.incident(incident.id, controller.signal),
        mvpApi.audit(incident.id, controller.signal),
        mvpApi.auditIntegrity(controller.signal).catch(() => null),
      ])
      if (!mounted.current || detailController.current !== controller || detailSequence.current !== seq) return
      setSelected(detail)
      setAudit(entries)
      setIntegrity(chain)
      setError(null)
    } catch (reason) {
      if (!controller.signal.aborted && mounted.current && detailSequence.current === seq) {
        setError(reason instanceof Error ? reason.message : 'Unable to load this incident.')
        setSelectedId(null)
      }
    } finally {
      if (mounted.current && detailController.current === controller) {
        detailController.current = null
        setDetailLoading(false)
      }
    }
  }, [])

  const changeFilter = (next: Incident['status'] | 'ALL') => {
    detailController.current?.abort()
    silentDetailController.current?.abort()
    queryController.current?.abort()
    setFilter(next)
    setSelected(null)
    setSelectedId(null)
    setAudit([])
    setIntegrity(null)
    setQueryResult(null)
    setLoading(true)
  }

  const runQuery = async () => {
    const text = query.trim()
    if (!text) return
    queryController.current?.abort()
    const controller = new AbortController()
    queryController.current = controller
    setQueryLoading(true)

    try {
      const result = await mvpApi.dashboardQuery(text, controller.signal)
      if (mounted.current && queryController.current === controller) setQueryResult(result)
    } catch (reason) {
      if (!controller.signal.aborted && mounted.current) setError(reason instanceof Error ? reason.message : 'Unable to answer that queue question.')
    } finally {
      if (mounted.current && queryController.current === controller) {
        queryController.current = null
        setQueryLoading(false)
      }
    }
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      refreshController.current?.abort()
      detailController.current?.abort()
      silentDetailController.current?.abort()
      queryController.current?.abort()
    }
  }, [])

  useEffect(() => {
    const open = () => setViewMode('dashboard')
    window.addEventListener('payscope-open-dashboard', open)
    return () => window.removeEventListener('payscope-open-dashboard', open)
  }, [])

  useEffect(() => {
    if (viewMode === 'dashboard') void refresh()
  }, [refresh, viewMode])

  // Real-time Background Polling Engine (every 3s when dashboard is open)
  useEffect(() => {
    if (viewMode !== 'dashboard') return
    const interval = setInterval(() => {
      void refresh(true)
    }, 3000)
    return () => clearInterval(interval)
  }, [refresh, viewMode])

  // Auto-Select First Matching Incident if none selected or if selection left current filter
  useEffect(() => {
    if (viewMode === 'dashboard' && !loading && !detailLoading && loadedFilter === filter) {
      if (selectedId && !ordered.some(i => i.id === selectedId)) {
        setSelectedId(null)
        setSelected(null)
      } else if (!selectedId && ordered[0]) {
        void openIncident(ordered[0])
      }
    }
  }, [detailLoading, filter, loadedFilter, loading, openIncident, ordered, selectedId, viewMode])

  if (viewMode === 'showcase') return <main className="min-h-screen overflow-x-hidden bg-[#040406] text-white"><Navbar viewMode={viewMode} onViewModeChange={setViewMode} environment="test" /><SpatialScroll /></main>

  return <main className="min-h-screen bg-[#040406] text-neutral-100">
    <header className="sticky top-0 z-40 border-b border-white/[.08] bg-[#040406]/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setViewMode('showcase')} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-neutral-400 hover:bg-white/[.05] hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /><span className="hidden sm:inline">Overview</span>
          </button>
          <div className="rounded-lg border border-[#00ff87]/25 bg-[#00ff87]/10 p-1.5 text-[#00ff87]">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">PayScope</p>
            <p className="text-[10px] font-medium text-neutral-500">Autonomous payment operations</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 px-2.5 py-1 text-[11px] font-semibold text-[#00ff87]">
            <span className="h-2 w-2 rounded-full bg-[#00ff87] animate-pulse" />
            Live Syncing
          </span>
          <button type="button" onClick={() => void refresh(false)} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-white/[.09] disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>
      </div>
    </header>

    <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[292px_minmax(0,1fr)]">
      <aside className="border-b border-white/[.08] bg-[#07080d] lg:min-h-[calc(100vh-65px)] lg:border-b-0 lg:border-r">
        <div className="p-5">
          <p className="text-sm font-bold text-white">Incident feed</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">Read the AI record for every verified incident.</p>
          <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Filter incidents">
            {queueViews.map(view => (
              <button
                key={view.value}
                type="button"
                aria-pressed={filter === view.value}
                onClick={() => changeFilter(view.value)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${filter === view.value ? 'border-[#00ff87]/35 bg-[#00ff87]/10 text-[#b8f8d8]' : 'border-white/[.08] text-neutral-500 hover:bg-white/[.05] hover:text-neutral-200'}`}
              >
                {view.title}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[440px] overflow-y-auto px-2 py-2 lg:max-h-[calc(100vh-245px)]">
          {loading ? <LoadingList /> : ordered.length ? (
            <ul className="space-y-1">
              {ordered.map(incident => (
                <li key={incident.id}>
                  <button
                    type="button"
                    onClick={() => void openIncident(incident)}
                    aria-current={selectedId === incident.id ? 'page' : undefined}
                    className={`w-full rounded-xl border p-3 text-left transition ${selectedId === incident.id ? 'border-[#00ff87] bg-[#00ff87]/[0.12] shadow-[0_0_20px_rgba(0,255,135,0.15)] text-white font-bold' : 'border-white/[.07] hover:border-white/[.15] hover:bg-white/[.035] text-neutral-200'}`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${riskClass(incident.riskTier)}`}>
                        {label(incident.riskTier)}
                      </span>
                      <span className="text-[10px] text-neutral-400">{stamp(incident.updatedAt).split(',')[0]}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-neutral-100">
                      {incident.status === 'DISMISSED' ? 'Policy Blocked — No Outreach' :
                       incident.status === 'DISPUTE_OPENED' ? 'Dispute Open — Outreach Blocked' :
                       incident.status === 'RESOLVED' ? 'Payment Recovered & Reconciled' :
                       incident.status === 'MONITORING' ? 'Monitoring Active Telemetry' :
                       'Payment Incident'}
                    </p>
                    <p className="mt-1 text-xs text-neutral-400">{money(incident.remainingAmountPaise)} at risk</p>
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyList />}
        </div>

        <div className="border-t border-white/[.08] px-5 py-4 text-xs text-neutral-500">
          <span className={`mr-2 inline-block h-2 w-2 rounded-full ${health ? 'bg-[#00ff87]' : 'bg-amber-300'}`} />
          {health ? 'Autonomous pipeline ready' : 'Checking pipeline'}
        </div>
      </aside>

      <section className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1180px]">
          {error && <div role="alert" className="mb-5 flex gap-3 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] p-4 text-sm text-rose-100"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
          <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#00ff87]">Autonomous execution ledger</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">What the AI executed</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">The AI investigates, the deterministic policy authorizes, the provider command is dispatched, and the verified receipt is reconciled — all recorded here.</p>
            </div>
            <div className="flex gap-2 text-xs text-neutral-400">
              <span className="rounded-full border border-white/10 bg-white/[.03] px-3 py-1.5">{incidents.length} shown</span>
              <span className="rounded-full border border-white/10 bg-white/[.03] px-3 py-1.5">{money(totalAtRisk)} at risk</span>
            </div>
          </section>

          {detailLoading && !selected ? <LoadingDetail /> : selected ? <IncidentRecord detail={selected} audit={audit} integrity={integrity} /> : <EmptyDetail loading={loading} />}
          <Insights metrics={metrics} query={query} onQuery={setQuery} result={queryResult} loading={queryLoading} onSubmit={() => void runQuery()} />
        </div>
      </section>
    </div>
  </main>
}

function IncidentRecord({ detail, audit, integrity }: { detail: IncidentDetail; audit: AuditEntry[]; integrity: AuditIntegrity | null }) {
  const latest = detail.execution[0] ?? detail.proposals[0];
  return <>
    <section className="overflow-hidden rounded-2xl border border-white/[.1] bg-[#090a0f]">
      <div className="border-b border-white/[.08] px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${riskClass(detail.incident.riskTier)}`}>
                {label(detail.incident.riskTier)} priority
              </span>
              <span className="rounded-full border border-white/[.1] bg-white/[.035] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-neutral-300">
                {label(detail.incident.status)}
              </span>
            </div>
            <h2 className="mt-4 text-xl font-semibold text-white sm:text-2xl">
              {detail.investigation?.plan?.hypothesis ?? (
                detail.incident.status === 'DISMISSED' ? 'Autonomous policy evaluated — outreach blocked by safety rules' :
                detail.incident.status === 'DISPUTE_OPENED' ? 'Dispute created — automated outreach suspended' :
                detail.incident.status === 'RESOLVED' ? 'Payment recovered and reconciled via Razorpay' :
                'Payment failure signal under multi-agent investigation'
              )}
            </h2>
            <p className="mt-2 text-sm text-neutral-400">
              {detail.events.length} verified signal{detail.events.length === 1 ? '' : 's'} · {money(detail.incident.remainingAmountPaise)} remains at risk
            </p>
          </div>
          <div className="rounded-xl border border-[#00ff87]/20 bg-[#00ff87]/[.06] px-4 py-3 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#86f4bd]">AI outcome</p>
            <p className="mt-1 text-sm font-semibold text-white">{outcomeText(detail.incident.status, latest)}</p>
          </div>
        </div>
      </div>
      <ActualStages entries={audit} />
    </section>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.08fr_.82fr]">
      <Timeline events={detail.events} />
      <AiDecision detail={detail} proposal={latest} integrity={integrity} />
    </div>
    <ExecutionLedger execution={detail.execution} />
    <AuditTrail entries={audit} integrity={integrity} />
  </>
}

function ExecutionLedger({ execution }: { execution: import('./types/mvp').ExecutionActionSummary[] }) {
  return <section className="mt-6 rounded-2xl border border-white/[.08] bg-white/[.015] p-5 sm:p-6">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold text-white">Execution ledger</p>
        <p className="mt-1 text-xs text-neutral-500">Provider commands and their verified receipt state — never recipient data or raw payloads.</p>
      </div>
      <span className="text-xs text-neutral-500">{execution.length} action{execution.length === 1 ? '' : 's'}</span>
    </div>
    {execution.length ? (
      <ol className="mt-4 space-y-2">
        {execution.map(action => (
          <li key={action.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[.07] bg-black/15 p-3">
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${executionStateClass[action.state] ?? 'border-white/10 text-neutral-300'}`}>
                {executionStateLabel[action.state] ?? label(action.state)}
              </span>
              <span className="text-xs font-semibold text-neutral-100">{label(action.capability)}</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-neutral-400">
              {action.amountPaise !== null && <span className="font-semibold text-neutral-200">{money(action.amountPaise, action.currency ?? 'INR')}</span>}
              <span>{action.terminalReason ? label(action.terminalReason) : action.providerObjectId ?? 'no provider receipt'}</span>
              <span className="text-neutral-600">{stamp(action.createdAt)}</span>
            </div>
          </li>
        ))}
      </ol>
    ) : <p className="mt-2 text-xs text-neutral-500">No provider command has been dispatched for this incident yet.</p>}
  </section>
}

function ActualStages({ entries }: { entries: AuditEntry[] }) {
  const allowed = ['event_received', 'event_enriched', 'incident_opened', 'policy_decision_recorded', 'execution_command_queued', 'execution_receipt_recorded', 'execution_command_blocked', 'autonomous_action_simulated', 'autonomous_no_action_recorded', 'investigation_completed', 'callback_verified', 'reconciled'];
  const matched = entries.filter(entry => allowed.includes(entry.eventType));
  const map = new Map<string, AuditEntry>();
  for (const entry of matched) {
    map.set(entry.eventType, entry);
  }
  const stages = Array.from(map.values())
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-4);

  return <div className="border-t border-white/[.08] px-5 py-4 sm:px-7">
    <p className="text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Execution stages — investigation → policy → command → receipt → reconciliation</p>
    {stages.length ? (
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map(entry => (
          <li key={entry.id} className="rounded-xl border border-white/[.07] bg-black/15 p-3">
            <p className="text-xs font-semibold text-neutral-100">{label(entry.eventType)}</p>
            <p className="mt-1 text-[11px] text-neutral-500">{stamp(entry.createdAt)}</p>
            <p className="mt-1 text-[10px] text-neutral-500">{entry.decision}</p>
          </li>
        ))}
      </ol>
    ) : <p className="mt-2 text-xs text-neutral-500">The worker has not attached a durable AI stage yet.</p>}
  </div>
}

function Timeline({ events }: { events: Event[] }) {
  return <section className="rounded-2xl border border-white/[.09] bg-white/[.018] p-5 sm:p-6">
    <div className="flex justify-between gap-3">
      <div>
        <p className="text-sm font-bold text-white">Verified timeline</p>
        <p className="mt-1 text-xs text-neutral-500">Only signals retained by the durable pipeline.</p>
      </div>
      <span className="text-xs text-neutral-500">{events.length} events</span>
    </div>
    <ol className="mt-5 space-y-3">
      {events.length ? events.map(event => (
        <li key={event.id} className="rounded-xl border border-white/[.07] bg-black/15 p-3.5">
          <div className="flex justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-100">{label(event.event.eventType)}</p>
              <p className="mt-1 text-xs text-neutral-500">{stamp(event.event.occurredAt)}</p>
            </div>
            {event.event.amountPaise !== undefined && <span className="text-xs font-semibold text-neutral-300">{money(event.event.amountPaise)}</span>}
          </div>
          {event.enrichment && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
              <span>{label(event.enrichment.failureAttribution)}</span>
              <span className="text-neutral-600">•</span>
              {event.enrichment.source === 'vulcan_direct' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 px-2 py-0.5 text-[10px] font-bold text-[#86f4bd]">
                  <Sparkles className="h-3 w-3 text-[#00ff87]" />
                  Razorpay Vulcan AI Direct
                </span>
              ) : (
                <span className="text-neutral-500">source: {event.enrichment.source}</span>
              )}
            </div>
          )}
        </li>
      )) : <li className="rounded-xl border border-dashed border-white/[.12] p-4 text-sm text-neutral-500">No verified events are available for this record.</li>}
    </ol>
  </section>
}

function AiDecision({ detail, proposal, integrity }: { detail: IncidentDetail; proposal: Proposal | undefined; integrity: AuditIntegrity | null }) {
  const plan = detail.investigation?.plan;
  const risk = detail.investigation?.riskAnalysis;
  const policy = detail.investigation?.policyDecision;
  const plannedAction = detail.investigation?.recoveryPlan?.proposedActions.find(action => action.actionType === proposal?.actionType);
  const simulatedNote = proposal && typeof proposal.deliveryResult?.note === 'string' ? proposal.deliveryResult.note : null;

  return <section className="rounded-2xl border border-white/[.09] bg-white/[.018] p-5 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-bold text-white">AI → Policy → Execution</p>
        <p className="mt-1 text-xs leading-5 text-neutral-500">Bounded investigation, deterministic gates, provider-confirmed outcome.</p>
      </div>
      <Bot className="h-5 w-5 text-[#00ff87]" />
    </div>
    <div className="mt-5 space-y-3">
      <DecisionRow icon={<Waypoints className="h-4 w-4" />} title={plan ? label(plan.primaryFailureCategory) : 'Investigation pending'} detail={plan ? `${plan.hypothesis} · ${plan.objectives[0]}` : 'The worker has not persisted an investigation yet.'} />
      <DecisionRow icon={<Sparkles className="h-4 w-4" />} title={risk ? `Likely cause: ${label(risk.failureRootCause)}` : 'Evidence being checked'} detail={risk?.causalNarrative ?? 'No unsupported conclusion is shown.'} />
      <DecisionRow icon={<ShieldCheck className="h-4 w-4" />} title={proposal ? `${label(proposal.actionType)} · ${executionStateLabel[proposal.status] ?? label(proposal.status)}` : label(detail.incident.status)} detail={proposal ? simulatedNote ?? plannedAction?.expectedOutcome ?? String(proposal.content.rationale ?? 'Autonomous action recorded.') : (policy?.noActionReason ?? detail.investigation?.recoveryPlan?.noActionReason ?? 'The AI recorded no external action.')} />
    </div>
    {risk?.alternativeHypotheses.length ? <p className="mt-4 text-xs leading-5 text-neutral-500">Alternatives considered: {risk.alternativeHypotheses.join(' · ')}</p> : null}
    <div className={`mt-5 flex gap-2 rounded-xl border p-3 text-xs ${integrity?.status === 'intact' ? 'border-[#00ff87]/20 bg-[#00ff87]/[.06] text-[#b8f8d8]' : 'border-amber-300/20 bg-amber-300/[.06] text-amber-100'}`}>
      {integrity?.status === 'intact' ? <CircleCheck className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
      {integrity?.status === 'intact' ? `Audit chain intact · ${integrity.entryCount} entries verified` : 'Audit integrity is unavailable; no autonomous simulation should proceed.'}
    </div>
  </section>
}

function DecisionRow({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="flex gap-3 rounded-xl border border-white/[.07] bg-black/15 p-3">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#00ff87]/20 bg-[#00ff87]/[.07] text-[#86f4bd]">{icon}</span>
    <div>
      <p className="text-xs font-semibold text-neutral-100">{title}</p>
      <p className="mt-1 text-xs leading-5 text-neutral-500">{detail}</p>
    </div>
  </div>
}

function AuditTrail({ entries, integrity }: { entries: AuditEntry[]; integrity: AuditIntegrity | null }) {
  const grouped: Array<{ entry: AuditEntry; count: number }> = [];
  for (const entry of entries) {
    const last = grouped[grouped.length - 1];
    if (last && last.entry.eventType === entry.eventType && last.entry.decision === entry.decision && last.entry.rationale === entry.rationale) {
      last.count += 1;
      last.entry = entry;
    } else {
      grouped.push({ entry, count: 1 });
    }
  }

  return <section className="mt-6 rounded-2xl border border-white/[.08] bg-white/[.015] p-5 sm:p-6">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold text-white">Audit trail</p>
        <p className="mt-1 text-xs text-neutral-500">Append-only records of what the pipeline did.</p>
      </div>
      <span className={`text-xs ${integrity?.status === 'intact' ? 'text-[#aaffd5]' : 'text-amber-100'}`}>{integrity?.status ?? 'checking'}</span>
    </div>
    <ol className="mt-5 space-y-3">
      {grouped.length ? grouped.map(({ entry, count }) => (
        <li key={entry.id} className="border-l border-[#00ff87]/35 pl-4">
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-neutral-100">{label(entry.decision)}</p>
              {count > 1 && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-neutral-400">
                  {count}x repeated
                </span>
              )}
            </div>
            <span className="text-[11px] text-neutral-500">{stamp(entry.createdAt)}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-neutral-400">{entry.rationale || entry.decision}</p>
        </li>
      )) : <li className="text-sm text-neutral-500">No audit entries were returned for this incident.</li>}
    </ol>
  </section>
}

function Insights({ metrics, query, onQuery, result, loading, onSubmit }: { metrics: DashboardMetrics | null; query: string; onQuery: (value: string) => void; result: DashboardQueryResult | null; loading: boolean; onSubmit: () => void }) {
  return <section className="mt-6 rounded-2xl border border-white/[.08] bg-white/[.015] p-5 sm:p-6">
    <p className="text-sm font-semibold text-white">Read-only operational insights</p>
    <p className="mt-1 text-xs text-neutral-500">Ask about the tenant-scoped incident record. This cannot trigger an action.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <Metric label="At risk" value={metrics?.operations.totalAtRiskPaise === null || !metrics ? 'Not available' : money(metrics.operations.totalAtRiskPaise)} />
      <Metric label="Actions dispatched" value={metrics ? String(metrics.operations.actionsDispatched) : 'Not available'} />
      <Metric label="Confirmed recoveries" value={metrics ? String(metrics.operations.confirmedRecoveries) : 'Not available'} />
    </div>
    <form className="mt-5 flex gap-2" onSubmit={event => { event.preventDefault(); onSubmit() }}>
      <label className="sr-only" htmlFor="dashboard-query">Ask about this incident feed</label>
      <input id="dashboard-query" value={query} onChange={event => onQuery(event.target.value)} maxLength={240} placeholder="Example: show open high-risk incidents" className="min-w-0 flex-1 rounded-xl border border-white/[.12] bg-black/20 px-3 py-2 text-sm text-white placeholder:text-neutral-600" />
      <button type="submit" disabled={loading || !query.trim()} className="rounded-xl border border-[#00ff87]/30 px-3 text-xs font-bold text-[#aaffd5] hover:bg-[#00ff87]/10 disabled:opacity-50">{loading ? 'Checking…' : 'Ask'}</button>
    </form>
    {result && <div className="mt-3 rounded-xl border border-white/[.08] bg-black/15 p-3 text-xs"><p className="font-semibold text-neutral-100">{result.interpretation}</p><p className="mt-1 text-neutral-400">{result.matchedIncidentCount} matching · {money(result.matchedRemainingAmountPaise)} at risk</p></div>}
  </section>
}

function Metric({ label: title, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[.08] bg-black/15 p-3">
    <p className="text-[10px] font-bold uppercase tracking-[.14em] text-neutral-500">{title}</p>
    <p className="mt-2 text-lg font-semibold text-white">{value}</p>
  </div>
}

function LoadingList() {
  return <div className="space-y-2 p-3">{[1, 2, 3].map(item => <div key={item} className="h-16 animate-pulse rounded-xl bg-white/[.045]" />)}</div>
}

function EmptyList() {
  return <div className="p-5 text-center">
    <CircleCheck className="mx-auto h-5 w-5 text-[#00ff87]" />
    <p className="mt-3 text-sm font-semibold text-neutral-200">No incidents in this view</p>
    <p className="mt-1 text-xs leading-5 text-neutral-500">Verified events appear after the autonomous worker finishes.</p>
  </div>
}

function LoadingDetail() {
  return <section className="rounded-2xl border border-white/[.08] bg-white/[.015] p-6 text-sm text-neutral-400">
    <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin text-[#00ff87]" />Loading autonomous record…
  </section>
}

function EmptyDetail({ loading }: { loading: boolean }) {
  return <section className="rounded-2xl border border-dashed border-white/[.12] bg-white/[.015] p-10 text-center">
    <FileSearch className="mx-auto h-7 w-7 text-[#00ff87]" />
    <h2 className="mt-4 text-lg font-semibold text-white">{loading ? 'Loading incident feed' : 'No incident selected'}</h2>
    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-neutral-500">Select an incident to see its verified signals and autonomous decision record.</p>
  </section>
}

function outcomeText(status: Incident['status'], proposal: Proposal | undefined) {
  if (!proposal) {
    if (status === 'DISPUTE_OPENED') return 'Dispute Open — Outreach Blocked'
    if (status === 'RESOLVED') return 'Payment Recovered & Reconciled'
    if (status === 'MONITORING') return 'Monitoring Active Signals'
    if (status === 'DISMISSED') return 'No Action Required (Policy Blocked)'
    if (status === 'OPEN') return 'AI Investigating & Evaluating'
    return label(status)
  }
  const state = ('state' in proposal ? proposal.state : proposal.status) as string
  const m: Record<string, string> = {
    simulated: 'Simulation Mode (Not Executed)',
    accepted: 'SMTP Accepted — Awaiting Callback',
    confirmed: 'Confirmed Payment Recovery',
    unreconciled: 'Unreconciled — Awaiting Razorpay Proof',
    queued: 'Execution Command Queued',
    dispatching: 'Dispatching Provider Command',
    retry_scheduled: 'Retry Scheduled',
    compensating: 'Compensating Action Recorded',
    cancelled: 'Outreach Cancelled by Policy',
    failed: 'Command Execution Failed',
  }
  return m[state] ?? label(state)
}

function riskClass(risk: Incident['riskTier']) {
  return {
    CRITICAL: 'border-rose-300/35 bg-rose-300/10 text-rose-100',
    HIGH: 'border-orange-300/35 bg-orange-300/10 text-orange-100',
    MEDIUM: 'border-amber-300/35 bg-amber-300/10 text-amber-100',
    MONITOR: 'border-sky-300/35 bg-sky-300/10 text-sky-100'
  }[risk]
}
