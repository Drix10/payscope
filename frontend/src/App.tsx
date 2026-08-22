import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Clock3, Database, RefreshCw, ShieldCheck } from 'lucide-react'
import { mvpApi } from './api'
import type { AuditEntry, AuditIntegrity, DashboardMetrics, DashboardQueryResult, Incident, IncidentDetail, Investigation, MvpHealth, Proposal } from './types/mvp'

const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100)
const stamp = (value: string) => { const time = Date.parse(value); return Number.isFinite(time) ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(time) : 'Invalid timestamp' }

export default function App() {
  const [health, setHealth] = useState<MvpHealth | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [statusFilter, setStatusFilter] = useState<Incident['status'] | 'ALL'>('ALL')
  const [selected, setSelected] = useState<IncidentDetail | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [auditIntegrity, setAuditIntegrity] = useState<AuditIntegrity | null>(null)
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null)
  const [dashboardQuery, setDashboardQuery] = useState('')
  const [dashboardResult, setDashboardResult] = useState<DashboardQueryResult | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [approvingProposalId, setApprovingProposalId] = useState<string | null>(null)
  const [approvalToken, setApprovalToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null)
  const mounted = useRef(true)
  const selectedIncidentId = useRef<string | null>(null)
  const refreshController = useRef<AbortController | null>(null)
  const detailController = useRef<AbortController | null>(null)
  const approvalController = useRef<AbortController | null>(null)
  const dashboardController = useRef<AbortController | null>(null)

  const refresh = async () => {
    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    setLoading(true)
    try {
      const [nextHealth, nextIncidents, nextMetrics] = await Promise.all([
        mvpApi.health(controller.signal),
        mvpApi.incidents(statusFilter === 'ALL' ? undefined : statusFilter, controller.signal),
        mvpApi.dashboardMetrics(controller.signal).catch(() => null),
      ])
      if (!mounted.current || refreshController.current !== controller) return
      setHealth(nextHealth); setIncidents(nextIncidents); setDashboardMetrics(nextMetrics); setLastLoadedAt(new Date().toISOString()); setError(null)
    } catch (reason) { if (mounted.current && refreshController.current === controller) setError(reason instanceof Error ? reason.message : 'Unable to load the agentic workspace.') }
    finally { if (mounted.current && refreshController.current === controller) { refreshController.current = null; setLoading(false) } }
  }
  useEffect(() => {
    // React Strict Mode mounts, cleans up, then mounts effects once more in
    // development. Resetting this flag prevents that safety check from
    // permanently suppressing every later state update.
    mounted.current = true
    return () => {
      mounted.current = false
      refreshController.current?.abort()
      detailController.current?.abort()
      approvalController.current?.abort()
      dashboardController.current?.abort()
    }
  }, [])
  useEffect(() => { void refresh() }, [statusFilter])

  const open = async (incident: Incident) => {
    detailController.current?.abort()
    const controller = new AbortController()
    detailController.current = controller
    selectedIncidentId.current = incident.id
    setDetailLoading(true)
    try {
      const [detail, entries] = await Promise.all([mvpApi.incident(incident.id, controller.signal), mvpApi.audit(incident.id, controller.signal)])
      const integrity = await mvpApi.auditIntegrity(controller.signal).catch(() => null)
      if (!mounted.current || detailController.current !== controller) return
      setSelected(detail); setAudit(entries); setAuditIntegrity(integrity); setError(null)
    } catch (reason) { if (mounted.current && detailController.current === controller) setError(reason instanceof Error ? reason.message : 'Unable to load incident detail.') }
    finally { if (mounted.current && detailController.current === controller) { detailController.current = null; setDetailLoading(false) } }
  }
  const totalAtRisk = useMemo(() => incidents.reduce((sum, item) => sum + item.remainingAmountPaise, 0), [incidents])
  const runDashboardQuery = async () => {
    const query = dashboardQuery.trim()
    if (!query) { setError('Enter a read-only dashboard question first.'); return }
    dashboardController.current?.abort()
    const controller = new AbortController()
    dashboardController.current = controller
    setDashboardLoading(true)
    try {
      const result = await mvpApi.dashboardQuery(query, controller.signal)
      if (!mounted.current || dashboardController.current !== controller) return
      setDashboardResult(result); setError(null)
    } catch (reason) {
      if (!mounted.current || dashboardController.current !== controller) return
      const message = reason instanceof Error ? reason.message : 'Unable to run the read-only dashboard query.'
      if (!/cancelled/.test(message)) setError(message)
    } finally { if (mounted.current && dashboardController.current === controller) { dashboardController.current = null; setDashboardLoading(false) } }
  }
  const approve = async (proposal: Proposal) => {
    if (!selected) return
    if (auditIntegrity?.status !== 'intact') { setError('Proposal approval is blocked until the audit chain verifies as intact.'); return }
    if (!approvalToken.trim()) { setError('Enter the VPS-only demo approval token to record this simulation.'); return }
    approvalController.current?.abort()
    const controller = new AbortController()
    approvalController.current = controller
    setApprovingProposalId(proposal.id)
    try {
      const approved = await mvpApi.approve(proposal.id, approvalToken, controller.signal)
      if (!mounted.current || approvalController.current !== controller) return
      // Approval has committed. Do not report it as failed merely because a
      // subsequent, read-only timeline refresh is delayed or unavailable.
      setSelected(current => current?.incident.id === approved.incidentId
        ? { ...current, proposals: current.proposals.map(item => item.id === approved.id ? approved : item) }
        : current)
      setApprovalToken('')
      const entries = await mvpApi.audit(proposal.incidentId, controller.signal).catch(() => null)
      const integrity = await mvpApi.auditIntegrity(controller.signal).catch(() => null)
      if (!mounted.current || approvalController.current !== controller) return
      if (selectedIncidentId.current === proposal.incidentId && entries) {
        setAudit(entries)
        setAuditIntegrity(integrity)
      }
      setError(entries ? null : 'Proposal approval is recorded as a simulation. The audit timeline could not refresh yet; use Refresh to retry.')
    } catch (reason) { if (mounted.current && approvalController.current === controller) setError(reason instanceof Error ? reason.message : 'Proposal approval failed.') }
    finally { if (mounted.current && approvalController.current === controller) { approvalController.current = null; setApprovingProposalId(null) } }
  }

  return <main className="min-h-screen bg-[#090a0f] text-neutral-100">
    <header className="border-b border-white/10 bg-[#0d0f16] px-5 py-4 sm:px-8"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#00ff87]">PayScope</p><h1 className="mt-1 text-xl font-bold">Agentic payment-operations MVP</h1></div><button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/10 disabled:opacity-50"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />Refresh</button></div></header>
    <section className="mx-auto max-w-7xl px-5 py-6 sm:px-8"><div className="mb-5 rounded-xl border border-amber-200/20 bg-amber-200/[.05] p-4 text-sm text-amber-50"><ShieldCheck className="mr-2 inline h-4 w-4" /><strong>Test Mode · proposal-only.</strong> Enrichment is labelled by source, communications are simulated when implemented, and no payment action is available here.{health && <span className="ml-2 text-xs text-amber-100">Demo operator · org {health.organizationId.slice(0, 8)}</span>}</div>
      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-300/30 bg-rose-300/[.08] p-4 text-sm text-rose-100"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div>}
      {selected && !auditIntegrity && !detailLoading && <div role="status" className="mb-5 rounded-xl border border-amber-200/30 bg-amber-200/[.06] p-4 text-sm text-amber-50">Audit integrity is unavailable or still checking. Proposal approval is blocked until an intact chain is returned.</div>}
      {error && lastLoadedAt && <p className="mb-5 text-xs text-amber-100">Showing previously validated data from {stamp(lastLoadedAt)} while the latest refresh is unavailable.</p>}
      <div className="mb-6 grid gap-3 sm:grid-cols-3"><Metric label="Incidents" value={String(incidents.length)} /><Metric label="Remaining at risk" value={money(totalAtRisk)} /><Metric label="Pipeline" value={health?.pipeline ?? 'Checking'} detail={health ? `${health.database} DB · ${health.queueWorker} worker · ${health.enrichmentAdapter}` : undefined} /></div>
      <DashboardPanel metrics={dashboardMetrics} query={dashboardQuery} onQuery={setDashboardQuery} result={dashboardResult} loading={dashboardLoading} onSubmit={() => void runDashboardQuery()} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"><section className="rounded-2xl border border-white/10 bg-white/[.025]"><div className="border-b border-white/10 p-4"><h2 className="font-bold">Incident queue</h2><p className="mt-1 text-xs text-neutral-400">{health ? `Webhook: ${health.webhook.replace(/_/g, ' ')} · deterministic lifecycle state.` : 'Deterministic lifecycle state from the durable pipeline.'}</p><label className="mt-3 block text-xs text-neutral-400" htmlFor="incident-status">Lifecycle filter</label><select id="incident-status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as Incident['status'] | 'ALL')} className="mt-1 w-full rounded border border-white/15 bg-[#0d0f16] px-2 py-1.5 text-sm"><option value="ALL">All incidents</option>{(['OPEN', 'MONITORING', 'ESCALATED', 'DISPUTE_OPENED', 'RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED'] as const).map(status => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}</select></div>{loading ? <p className="p-6 text-sm text-neutral-400">Loading incidents…</p> : incidents.length === 0 ? <p className="p-6 text-sm text-neutral-400">No {statusFilter === 'ALL' ? '' : `${statusFilter.replace(/_/g, ' ').toLowerCase()} `}incidents yet. A verified Test Mode event will appear after the durable worker processes it.</p> : <ul>{incidents.map(incident => <li key={incident.id}><button type="button" onClick={() => void open(incident)} className="w-full border-b border-white/[.08] p-4 text-left last:border-none hover:bg-white/[.04]"><div className="flex items-start justify-between gap-3"><span className="font-semibold">{incident.status.replace(/_/g, ' ')}</span><span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-[#00ff87]">{incident.riskTier}</span></div><p className="mt-2 text-sm">{money(incident.remainingAmountPaise)} remaining</p><p className="mt-1 text-xs text-neutral-500"><Clock3 className="mr-1 inline h-3 w-3" />{stamp(incident.updatedAt)}</p></button></li>)}</ul>}</section>
        <Detail detail={selected} audit={audit} integrity={auditIntegrity} loading={detailLoading} approvalToken={approvalToken} onApprovalToken={setApprovalToken} approvingProposalId={approvingProposalId} onApprove={approve} />
      </div>
    </section>
  </main>
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="rounded-xl border border-white/10 bg-white/[.025] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-2 text-xl font-bold">{value}</p>{detail && <p className="mt-1 text-xs text-neutral-500">{detail}</p>}</div> }
function DashboardPanel({ metrics, query, onQuery, result, loading, onSubmit }: { metrics: DashboardMetrics | null; query: string; onQuery: (value: string) => void; result: DashboardQueryResult | null; loading: boolean; onSubmit: () => void }) {
  const unavailable = 'Not available'
  const evaluationScore = metrics && metrics.evaluation.precision !== null && metrics.evaluation.recall !== null && metrics.evaluation.f1 !== null
    ? `${(metrics.evaluation.precision * 100).toFixed(1)}% / ${(metrics.evaluation.recall * 100).toFixed(1)}% / ${(metrics.evaluation.f1 * 100).toFixed(1)}%`
    : unavailable
  const rate = (value: number | null) => value === null ? unavailable : `${(value * 100).toFixed(1)}%`
  const number = (value: number | null) => value === null ? unavailable : String(value)
  return <section className="mb-6 rounded-2xl border border-sky-200/20 bg-sky-200/[.035] p-5" aria-labelledby="agentic-dashboard-title">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><div><h2 id="agentic-dashboard-title" className="font-bold">Agentic Dashboard</h2><p id="dashboard-query-scope" className="mt-1 text-xs text-sky-100/75">Read-only tenant summaries. The browser never turns this text into SQL, a filter expression, or an action.</p></div><span className="rounded border border-sky-100/20 px-2 py-1 text-[10px] font-bold uppercase text-sky-100">Test Mode metrics</span></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><div><h3 className="text-xs font-bold uppercase tracking-wide text-neutral-300">Scope and exceptions</h3>{metrics ? <><ul className="mt-2 space-y-1 text-xs text-neutral-300">{metrics.exceptions.map(item => <li key={item}>• {item}</li>)}</ul><div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2"><Metric label="Original incident value at risk" value={metrics.operations.totalAtRiskPaise === null ? unavailable : money(metrics.operations.totalAtRiskPaise)} detail="The fixed denominator for recovery rate." /><Metric label="Recovery proposals" value={number(metrics.operations.proposalsGenerated)} detail={`${number(metrics.operations.proposalsApproved)} operator-approved`} /><Metric label="Attributed Test Mode recoveries" value={number(metrics.operations.attributedRecoveries)} detail="One captured payment is credited at most once." /><Metric label="Causally attributed paise" value={metrics.operations.recoveredPaise === null ? unavailable : money(metrics.operations.recoveredPaise)} detail="Proposal → approval → capture within 24 hours." /><Metric label="Recovery rate" value={rate(metrics.operations.recoveryRate)} detail="Attributed paise ÷ original incident value." /><Metric label="Approved proposals per recovery" value={metrics.operations.contactToRecoveryRatio === null ? unavailable : metrics.operations.contactToRecoveryRatio.toFixed(2)} detail="Lower is better; unavailable before a recovery." /><Metric label="Precision / recall / F1" value={evaluationScore} detail={metrics.evaluation.status === 'not_run' ? 'No fixture score is claimed.' : `${metrics.evaluation.split} · ${metrics.evaluation.sampleCount} fixtures`} /><Metric label="False-positive cost" value={metrics.evaluation.falsePositiveCostPaise === null ? unavailable : money(metrics.evaluation.falsePositiveCostPaise)} detail="Fixture metric, never merchant loss." /></div><p className="mt-3 text-xs text-amber-100">Evaluation metadata: {metrics.evaluation.status === 'not_run' ? 'Not run — no development or held-out score is claimed.' : `${metrics.evaluation.split} · ${metrics.evaluation.fixtureSetVersion} · ${metrics.evaluation.sampleCount} samples · ${stamp(metrics.evaluation.runAt ?? '')}`}</p><p className="mt-1 text-xs text-amber-100">All recovery values are Test Mode simulation evidence, never a claim of real merchant revenue.</p></> : <p className="mt-2 text-xs text-neutral-400">Metrics are unavailable until the current backend is deployed. No client-side fallback is calculated.</p>}</div>
      <div><h3 className="text-xs font-bold uppercase tracking-wide text-neutral-300">Ask about incidents</h3><form className="mt-2" onSubmit={event => { event.preventDefault(); onSubmit() }}><label className="sr-only" htmlFor="dashboard-query">Read-only incident query</label><textarea id="dashboard-query" aria-describedby="dashboard-query-scope" value={query} onChange={event => onQuery(event.target.value)} maxLength={240} rows={3} placeholder="Example: show open high-risk incidents" className="w-full rounded border border-white/15 bg-[#0d0f16] px-3 py-2 text-sm" /><div className="mt-2 flex flex-wrap gap-2"><button type="submit" disabled={loading} className="rounded border border-sky-200/40 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-200/10 disabled:opacity-50">{loading ? 'Querying…' : 'Run read-only query'}</button>{['open incidents', 'escalated critical incidents', 'resolved incidents'].map(example => <button key={example} type="button" onClick={() => onQuery(example)} className="rounded border border-white/10 px-2 py-1 text-xs text-neutral-300 hover:bg-white/10">{example}</button>)}</div></form><div aria-live="polite" aria-atomic="true">{loading && <p className="mt-3 text-xs text-sky-100">Querying the bounded, read-only tenant summary…</p>}{result && <div className="mt-3 rounded-lg border border-white/[.1] p-3 text-xs"><p className="font-semibold">{result.interpretation}</p><p className="mt-1 text-neutral-300">{result.matchedIncidentCount} matching · {money(result.matchedRemainingAmountPaise)} remaining at risk</p>{result.incidents.length ? <ul className="mt-2 space-y-1 text-neutral-300">{result.incidents.map(incident => <li key={incident.id}>{incident.status.replace(/_/g, ' ')} · {incident.riskTier} · {money(incident.remainingAmountPaise)} · {stamp(incident.updatedAt)}</li>)}</ul> : <p className="mt-2 text-neutral-400">No tenant incidents match these supported terms.</p>}<ul className="mt-2 space-y-1 text-neutral-500">{result.limitations.map(item => <li key={item}>• {item}</li>)}</ul></div>}</div></div>
    </div>
  </section>
}
function Detail({ detail, audit, integrity, loading, approvalToken, onApprovalToken, approvingProposalId, onApprove }: { detail: IncidentDetail | null; audit: AuditEntry[]; integrity: AuditIntegrity | null; loading: boolean; approvalToken: string; onApprovalToken: (value: string) => void; approvingProposalId: string | null; onApprove: (proposal: Proposal) => void }) { if (loading) return <section className="rounded-2xl border border-white/10 p-5 text-sm text-neutral-400">Loading incident…</section>; if (!detail) return <section className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-neutral-400"><Database className="mb-2 h-5 w-3" />Select an incident to inspect its normalized timeline, enrichment source, proposals, and audit entries.</section>; return <section className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><h2 className="font-bold">Incident detail</h2><p className="mt-1 text-sm text-neutral-400">At risk {money(detail.incident.totalFailedAmountPaise)} · recovered {money(detail.incident.recoveredAmountPaise)} · remaining {money(detail.incident.remainingAmountPaise)} · {detail.incident.status}</p><h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-neutral-400">Normalized timeline</h3><ol className="mt-2 space-y-2">{detail.events.map(event => <li key={event.id} className="rounded-lg border border-white/[.08] p-3 text-sm"><p className="font-semibold">{event.event.eventType}</p><p className="mt-1 text-xs text-neutral-400">Occurred {stamp(event.event.occurredAt)} · received {stamp(event.event.receivedAt)}{Date.parse(event.event.receivedAt) < Date.parse(event.event.occurredAt) ? ' · out-of-order receipt' : ''}</p>{event.enrichment ? <div className="mt-2 text-xs text-neutral-300"><p>{event.enrichment.source} · {event.enrichment.failureAttribution} · gateway health {(event.enrichment.gatewayHealthScore * 100).toFixed(0)}%</p><p>Downtime {event.enrichment.gatewayInDowntime ? 'active' : event.enrichment.downtimeScheduled ? 'scheduled' : 'not reported'} · retry {event.enrichment.recommendedRetryMethod ?? 'not recommended'} · prior attempts {event.enrichment.priorAttemptCount}</p><p className="text-neutral-500">Signals: {event.enrichment.signalsUsed.join(', ') || 'none'}</p></div> : <p className="mt-2 text-xs text-amber-200">Enrichment unavailable — human review required; no gateway score shown.</p>}</li>)}</ol><InvestigationPanels investigation={detail.investigation} /><h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-neutral-400">Proposals</h3>{detail.proposals.length ? <div className="mt-2 space-y-2">{detail.proposals.map(proposal => <article key={proposal.id} className="rounded-lg border border-white/[.08] p-3 text-sm"><div className="flex items-start justify-between gap-2"><p className="font-semibold">{proposal.actionType.replace(/_/g, ' ')}</p><span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-bold uppercase">{proposal.status.replace(/_/g, ' ')}</span></div><p className="mt-1 text-xs text-neutral-400">{String(proposal.content.rationale ?? 'No rationale supplied.')}</p>{proposal.status === 'cancelled_by_recovery' && <p className="mt-2 text-xs text-amber-100">Cancelled because a later captured payment resolved this incident.</p>}{proposal.status === 'cancelled_by_dispute' && <p className="mt-2 text-xs text-amber-100">Cancelled because an open dispute requires human handling.</p>}{proposal.deliveryResult && <p className="mt-2 text-xs text-[#00ff87]">Simulated only — {String(proposal.deliveryResult.note ?? proposal.deliveryResult.status ?? 'recorded')}</p>}{proposal.status === 'pending' && <div className="mt-3"><label className="block text-xs text-neutral-400" htmlFor={`approval-${proposal.id}`}>Demo approval token (not stored)</label><input id={`approval-${proposal.id}`} value={approvalToken} onChange={event => onApprovalToken(event.target.value)} type="password" autoComplete="off" className="mt-1 w-full rounded border border-white/15 bg-black/20 px-2 py-1.5 text-sm" /><button type="button" onClick={() => onApprove(proposal)} disabled={approvingProposalId !== null} className="mt-2 rounded border border-[#00ff87]/40 px-2 py-1.5 text-xs font-semibold text-[#00ff87] hover:bg-[#00ff87]/10 disabled:opacity-50">{approvingProposalId === proposal.id ? 'Recording simulation…' : 'Approve simulated delivery'}</button></div>}</article>)}</div> : <p className="mt-2 text-sm text-neutral-500">No proposals were permitted for this incident.</p>}<h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-neutral-400">Audit trail</h3>{integrity && <p className={`mt-2 rounded border p-2 text-xs ${integrity.status === 'intact' ? 'border-[#00ff87]/30 text-[#aaffd5]' : 'border-rose-300/40 text-rose-100'}`}>{integrity.status === 'intact' ? `Integrity intact · ${integrity.entryCount} entries checked ${stamp(integrity.checkedAt)}` : 'Audit integrity is broken. Stop approvals and investigate before continuing.'}</p>}{audit.length ? <ol className="mt-2 space-y-2">{audit.map(entry => <li key={entry.id} className="border-l border-[#00ff87]/40 pl-3 text-sm"><p>{entry.decision}</p><p className="mt-1 text-xs text-neutral-300">{entry.rationale}</p><p className="mt-1 text-xs text-neutral-400">#{entry.sequenceNumber} · {entry.actorType} {entry.actorId} · {entry.confidence === null ? 'no confidence' : `${(entry.confidence * 100).toFixed(0)}% confidence`} · {entry.enrichmentSource ?? 'no enrichment snapshot'} · {stamp(entry.createdAt)}</p></li>)}</ol> : <p className="mt-2 text-sm text-neutral-500">No audit entries have been recorded for this incident yet.</p>}</section> }

function InvestigationPanels({ investigation }: { investigation: Investigation | null }) {
  if (!investigation) return <section className="mt-5 rounded-lg border border-white/[.08] p-3 text-sm text-neutral-400">Investigation pending — the durable worker will either record validated agent output or escalate safely.</section>
  if (investigation.status !== 'COMPLETE' || !investigation.plan || !investigation.riskAnalysis || !investigation.recoveryPlan || !investigation.policyDecision) return <section className="mt-5 rounded-lg border border-amber-200/20 bg-amber-200/[.04] p-3 text-sm text-amber-50">Investigation {investigation.status.toLowerCase()}. {investigation.status === 'FAILED' ? 'Human review is required; no action proposal was created.' : 'Awaiting validated agent output.'}</section>
  const { plan, riskAnalysis: risk, recoveryPlan: recovery, policyDecision: policy } = investigation
  return <section className="mt-5 space-y-3">
    <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Validated investigation</h3>
    <article className="rounded-lg border border-white/[.08] p-3 text-sm"><p className="font-semibold">Supervisor · {plan.primaryFailureCategory.replace(/_/g, ' ')}</p><p className="mt-1 text-xs text-neutral-300">{plan.hypothesis} · {(plan.confidence * 100).toFixed(0)}% confidence · {plan.requiresHumanReview ? 'human review required' : 'review gate passed'}</p><p className="mt-1 text-xs text-neutral-500">{plan.reasoning} · sub-agents: {plan.subAgents.map(agent => `${agent.agent.replace(/_/g, ' ')} [${agent.allowedContextFields.join(', ')}]`).join('; ') || 'none'} · {investigation.modelId ?? 'model unavailable'} · {investigation.tokensUsed ?? 0} tokens · {investigation.latencyMs ?? 0} ms</p></article>
    <article className="rounded-lg border border-white/[.08] p-3 text-sm"><p className="font-semibold">Risk Analyst · {risk.failureRootCause.replace(/_/g, ' ')}</p><p className="mt-1 text-xs text-neutral-300">{risk.evidenceStrength} evidence · {(risk.confidence * 100).toFixed(0)}% confidence · false-positive cost {money(risk.falsePositiveCostEstimatePaise)}</p><p className="mt-1 text-xs text-neutral-500">Evidence: {risk.evidenceItems.join('; ') || 'none'} · missing: {risk.missingEvidence.join('; ') || 'none'}</p><p className="mt-1 text-xs text-neutral-500">Server-scoped tools: {risk.toolResults.incidentTimelineEventCount} timeline events · merchant failure rate {risk.toolResults.merchantFailureRate === null ? 'unavailable' : `${(risk.toolResults.merchantFailureRate * 100).toFixed(0)}%`} · gateway proxy {risk.toolResults.networkFailureRate === null ? 'unavailable' : `${(risk.toolResults.networkFailureRate * 100).toFixed(0)}%`} · customer incident count {risk.toolResults.customerIncidentCount ?? 'unavailable'}</p></article>
    <article className="rounded-lg border border-white/[.08] p-3 text-sm"><p className="font-semibold">Recovery Planner · {(recovery.recoveryProbability * 100).toFixed(0)}% estimated probability</p><p className="mt-1 text-xs text-neutral-300">{recovery.proposedActions.length > 0 ? recovery.proposedActions.map(action => <span className="mr-2" key={action.actionType}>{action.actionType.replace(/_/g, ' ')}{action.estimatedRecoveryPaise === null ? '' : ` (${money(action.estimatedRecoveryPaise)})`}</span>) : (recovery.noActionReason ?? 'No action proposed.')}</p>{recovery.proposedActions.filter(action => action.scriptContent).map(action => <p key={action.actionType} className="mt-1 text-xs text-neutral-500">Script (proposal only): {action.scriptContent}</p>)}</article>
    <article className="rounded-lg border border-white/[.08] p-3 text-sm"><p className="font-semibold">Deterministic policy · {policy.outcome.replace(/_/g, ' ')}</p><p className="mt-1 text-xs text-neutral-300">Permitted: {policy.permittedActions.map(action => action.actionType.replace(/_/g, ' ')).join(', ') || 'none'}</p><ul className="mt-2 space-y-1 text-xs text-neutral-500">{policy.gates.map(gate => <li key={gate.name}><span className="font-semibold text-neutral-300">{gate.name.replace(/_/g, ' ')}: {gate.result}</span> — {gate.rationale}</li>)}</ul><p className="mt-2 text-xs text-neutral-500">{policy.escalationReason ?? `Matched policy ${policy.matchedPolicyId ?? 'none'}.`} Auto-resolve is only an internal recorded decision—not a payment action or customer message.</p></article>
  </section>
}
