import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Clock3, Database, RefreshCw, ShieldCheck } from 'lucide-react'
import { mvpApi } from './api'
import type { AuditEntry, Incident, IncidentDetail, MvpHealth } from './types/mvp'

const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100)
const stamp = (value: string) => { const time = Date.parse(value); return Number.isFinite(time) ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(time) : 'Invalid timestamp' }

export default function App() {
  const [health, setHealth] = useState<MvpHealth | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [selected, setSelected] = useState<IncidentDetail | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const refreshController = useRef<AbortController | null>(null)
  const detailController = useRef<AbortController | null>(null)

  const refresh = async () => {
    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    setLoading(true)
    try {
      const [nextHealth, nextIncidents] = await Promise.all([mvpApi.health(controller.signal), mvpApi.incidents(controller.signal)])
      if (!mounted.current || refreshController.current !== controller) return
      setHealth(nextHealth); setIncidents(nextIncidents); setError(null)
    } catch (reason) { if (mounted.current && refreshController.current === controller) setError(reason instanceof Error ? reason.message : 'Unable to load the agentic workspace.') }
    finally { if (mounted.current && refreshController.current === controller) { refreshController.current = null; setLoading(false) } }
  }
  useEffect(() => { void refresh(); return () => { mounted.current = false; refreshController.current?.abort(); detailController.current?.abort() } }, [])

  const open = async (incident: Incident) => {
    detailController.current?.abort()
    const controller = new AbortController()
    detailController.current = controller
    setDetailLoading(true)
    try {
      const [detail, entries] = await Promise.all([mvpApi.incident(incident.id, controller.signal), mvpApi.audit(incident.id, controller.signal)])
      if (!mounted.current || detailController.current !== controller) return
      setSelected(detail); setAudit(entries); setError(null)
    } catch (reason) { if (mounted.current && detailController.current === controller) setError(reason instanceof Error ? reason.message : 'Unable to load incident detail.') }
    finally { if (mounted.current && detailController.current === controller) { detailController.current = null; setDetailLoading(false) } }
  }
  const totalAtRisk = useMemo(() => incidents.reduce((sum, item) => sum + item.remainingAmountPaise, 0), [incidents])

  return <main className="min-h-screen bg-[#090a0f] text-neutral-100">
    <header className="border-b border-white/10 bg-[#0d0f16] px-5 py-4 sm:px-8"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#00ff87]">PayScope</p><h1 className="mt-1 text-xl font-bold">Agentic payment-operations MVP</h1></div><button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/10 disabled:opacity-50"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />Refresh</button></div></header>
    <section className="mx-auto max-w-7xl px-5 py-6 sm:px-8"><div className="mb-5 rounded-xl border border-amber-200/20 bg-amber-200/[.05] p-4 text-sm text-amber-50"><ShieldCheck className="mr-2 inline h-4 w-4" /><strong>Test Mode · proposal-only.</strong> Enrichment is labelled by source, communications are simulated when implemented, and no payment action is available here.</div>
      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-300/30 bg-rose-300/[.08] p-4 text-sm text-rose-100"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div>}
      <div className="mb-6 grid gap-3 sm:grid-cols-3"><Metric label="Incidents" value={String(incidents.length)} /><Metric label="Remaining at risk" value={money(totalAtRisk)} /><Metric label="Pipeline" value={health?.pipeline ?? 'Checking'} detail={health ? 'Tenant-scoped · Test Mode' : undefined} /></div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"><section className="rounded-2xl border border-white/10 bg-white/[.025]"><div className="border-b border-white/10 p-4"><h2 className="font-bold">Incident queue</h2><p className="mt-1 text-xs text-neutral-400">Deterministic lifecycle state from the durable pipeline.</p></div>{loading ? <p className="p-6 text-sm text-neutral-400">Loading incidents…</p> : incidents.length === 0 ? <p className="p-6 text-sm text-neutral-400">No incidents yet. A verified Test Mode event will appear after the durable worker processes it.</p> : <ul>{incidents.map(incident => <li key={incident.id}><button type="button" onClick={() => void open(incident)} className="w-full border-b border-white/[.08] p-4 text-left last:border-none hover:bg-white/[.04]"><div className="flex items-start justify-between gap-3"><span className="font-semibold">{incident.status.replace(/_/g, ' ')}</span><span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-[#00ff87]">{incident.riskTier}</span></div><p className="mt-2 text-sm">{money(incident.remainingAmountPaise)} remaining</p><p className="mt-1 text-xs text-neutral-500"><Clock3 className="mr-1 inline h-3 w-3" />{stamp(incident.updatedAt)}</p></button></li>)}</ul>}</section>
        <Detail detail={selected} audit={audit} loading={detailLoading} />
      </div>
    </section>
  </main>
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="rounded-xl border border-white/10 bg-white/[.025] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-2 text-xl font-bold">{value}</p>{detail && <p className="mt-1 text-xs text-neutral-500">{detail}</p>}</div> }
function Detail({ detail, audit, loading }: { detail: IncidentDetail | null; audit: AuditEntry[]; loading: boolean }) { if (loading) return <section className="rounded-2xl border border-white/10 p-5 text-sm text-neutral-400">Loading incident…</section>; if (!detail) return <section className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-neutral-400"><Database className="mb-2 h-5 w-5" />Select an incident to inspect its normalized timeline, enrichment source, proposals, and audit entries.</section>; return <section className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><h2 className="font-bold">Incident detail</h2><p className="mt-1 text-sm text-neutral-400">{money(detail.incident.remainingAmountPaise)} remaining · {detail.incident.status}</p><h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-neutral-400">Normalized timeline</h3><ol className="mt-2 space-y-2">{detail.events.map(event => <li key={event.id} className="rounded-lg border border-white/[.08] p-3 text-sm"><p className="font-semibold">{event.event.eventType}</p><p className="mt-1 text-xs text-neutral-400">{stamp(event.event.occurredAt)} · {event.enrichment ? `${event.enrichment.source}: ${event.enrichment.failureAttribution}` : 'Enrichment unavailable — human review required'}</p></li>)}</ol><h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-neutral-400">Audit trail</h3>{audit.length ? <ol className="mt-2 space-y-2">{audit.map(entry => <li key={entry.id} className="border-l border-[#00ff87]/40 pl-3 text-sm"><p>{entry.decision}</p><p className="text-xs text-neutral-400">#{entry.sequenceNumber} · {entry.actorType} · {stamp(entry.createdAt)}</p></li>)}</ol> : <p className="mt-2 text-sm text-neutral-500">No audit entries have been recorded for this incident yet.</p>}</section> }
