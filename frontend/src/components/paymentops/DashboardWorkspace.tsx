import { Activity, CheckCircle2, CircleDollarSign, Database, KeyRound, LucideIcon, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react'
import { ConnectionPanel } from './ConnectionPanel'
import { IncidentDetail } from './IncidentDetail'
import { IncidentList } from './IncidentList'
import { MetricCard } from './MetricCard'
import { PolicyPanel } from './PolicyPanel'
import { CheckoutButton } from './CheckoutButton'
import { AutoPolicy, ConnectionStatus, Dashboard, Incident, IncidentDetail as IncidentDetailData } from '../../types/paymentOps'
import { WorkspaceSection } from './DashboardSidebar'

interface DashboardWorkspaceProps {
  section: WorkspaceSection
  dashboard: Dashboard | null
  connection: ConnectionStatus | null
  incidents: Incident[]
  selected: IncidentDetailData | null
  loading: boolean
  detailLoading: boolean
  actionPending: boolean
  importing: boolean
  historyProgress: { days: number; nextSkip: number } | null
  policies: AutoPolicy[]
  policyBusy: boolean
  onSelectIncident: (incident: Incident) => void
  onCloseIncident: () => void
  onInvestigate: () => void
  onAction: (type: string) => void
  onImport: (days: number, skip?: number) => void
  onTogglePolicy: (policy: AutoPolicy) => void
  onDeletePolicy: (id: string) => void
  onCreatePolicy: (draft: Partial<AutoPolicy> & { name: string; action: AutoPolicy['action'] }) => void
  onRefresh: () => void
}

const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100)
const relative = (value: string) => {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return 'unknown'
  const seconds = Math.max(0, Math.round((Date.now() - parsed) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

export function DashboardWorkspace(props: DashboardWorkspaceProps) {
  const { section } = props
  const copy = {
    overview: ['Overview', 'The money story, in one place.', 'Every number below is from verified, deduplicated Razorpay signals — not dashboard math.'],
    incidents: ['Incidents', 'One queue. Full context.', 'Each incident is correlated, investigated, and kept with its evidence and decision.'],
    connections: ['Connections', 'If PayScope cannot see it, it cannot save it.', 'Webhooks, imports, and storage — the three things that must be green.'],
    policies: ['Policies', 'Automation you can trust.', 'Define the safe bounds once. The agent only acts inside them; everything else waits for you.'],
  }[section] as [string, string, string]

  return <div className="min-w-0">
    <div className="mb-6 border-b border-white/[.06] pb-5">
      <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#00ff87]">{copy[0]}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">{copy[1]}</h1>
      <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-neutral-400">{copy[2]}</p>
    </div>
    {section === 'overview' && <Overview {...props} />}
    {section === 'incidents' && <Incidents {...props} />}
    {section === 'connections' && <Connections {...props} />}
    {section === 'policies' && <Policies {...props} />}
  </div>
}

function Overview({ dashboard, incidents, connection, loading, onSelectIncident }: DashboardWorkspaceProps) {
  return <div className="space-y-6">
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="Captured" value={dashboard ? money(dashboard.capturedVolumePaise) : '—'} detail={`${dashboard?.eventWindow.loadedEventCount ?? 0} events retained`} icon={CircleDollarSign} tone="mint" />
      <MetricCard label="At risk" value={dashboard ? money(dashboard.failedAmountAtRiskPaise) : '—'} detail="Open, net of recovery" icon={TriangleAlert} tone="rose" />
      <MetricCard label="Recovered" value={dashboard ? money(dashboard.recoveredAmountPaise) : '—'} detail="Verified success linked" icon={ShieldCheck} tone="sky" />
      <MetricCard label="Open" value={dashboard ? String(dashboard.openIncidentCount) : '—'} detail={`${dashboard?.completedInvestigations ?? 0} investigations`} icon={Activity} tone="amber" />
    </section>
    <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
      <section className="min-w-0">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-white">Needs attention</h2>
          <span className="text-xs text-neutral-500">{dashboard?.openIncidentCount ?? 0} open</span>
        </div>
        <IncidentList incidents={incidents} activeId={undefined} onSelect={onSelectIncident} loading={loading} />
      </section>
      <div className="space-y-4">
        <SignalSummary dashboard={dashboard} />
        <SystemSummary connection={connection} />
      </div>
    </div>
  </div>
}

function Incidents({ incidents, selected, loading, detailLoading, actionPending, onSelectIncident, onCloseIncident, onInvestigate, onAction }: DashboardWorkspaceProps) {
  return <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]"><IncidentList incidents={incidents} activeId={selected?.incident.incidentId} onSelect={onSelectIncident} loading={loading} /><IncidentDetail detail={selected} loading={detailLoading} onClose={onCloseIncident} onInvestigate={onInvestigate} onAction={type => onAction(type)} actionPending={actionPending} /></div>
}

function Connections({ connection, importing, historyProgress, onImport, onRefresh }: DashboardWorkspaceProps) {
  return <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_.95fr]"><ConnectionPanel connection={connection} importing={importing} historyProgress={historyProgress} onImport={onImport} /><div className="space-y-4"><section className="rounded-2xl border border-white/[.06] bg-white/[.02] p-5"><p className="flex items-center gap-2 text-sm font-semibold text-white"><CheckCircle2 className="h-4 w-4 text-[#00ff87]" /> How PayScope flows</p><div className="mt-4 space-y-3"><Step icon={KeyRound} title="Razorpay signs it" text="Every webhook is HMAC-verified before it enters the system." /><Step icon={Database} title="PayScope correlates" text="Same payment/order/subscription or 15-min window → one incident." /><Step icon={ShieldCheck} title="You or policy decides" text="Evidence-bound investigation first; no money moves automatically." /></div></section><CheckoutButtonCard onSuccess={onRefresh} /></div></div>
}

function Policies({ policies, policyBusy, onTogglePolicy, onDeletePolicy, onCreatePolicy }: DashboardWorkspaceProps) {
  return <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]"><PolicyPanel policies={policies} onToggle={onTogglePolicy} onDelete={onDeletePolicy} onCreate={onCreatePolicy} busy={policyBusy} /><section className="rounded-2xl border border-amber-300/15 bg-amber-300/[.04] p-5"><p className="flex items-center gap-2 text-sm font-semibold text-amber-100"><ShieldCheck className="h-4 w-4" /> Guardrails</p><ul className="mt-3 space-y-2.5 text-[12px] leading-relaxed text-neutral-300"><li className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300" /> Investigation must finish before any policy runs.</li><li className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300" /> Escalation is human-only by default.</li><li className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300" /> Auto-dismiss: low/medium only, ≤ ₹1,000.</li><li className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300" /> Every auto-step is audited as <code className="rounded bg-white/10 px-1 text-[11px]">agent:policy/*</code>.</li></ul></section></div>
}

function SignalSummary({ dashboard }: { dashboard: Dashboard | null }) {
  return <section className="rounded-2xl border border-white/[.06] bg-[#090a0f]/60 p-4 backdrop-blur"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-white">Latest signals</h2><Activity className="h-4 w-4 text-neutral-500" /></div><p className="mt-1 text-xs text-neutral-500">Verified events currently in memory</p><div className="mt-4 space-y-2">{dashboard?.recentEvents.length ? dashboard.recentEvents.slice(0, 5).map(event => <div key={event.eventId} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/[.06] bg-black/20 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs font-medium text-white">{event.eventType}</p><p className="truncate text-[11px] text-neutral-500">{event.customerReference}</p></div><span className="shrink-0 text-xs text-neutral-500">{relative(event.occurredAt)}</span></div>) : <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs leading-relaxed text-neutral-500">No verified events yet.<br />Connect Razorpay or import history.</p>}</div></section>
}

function SystemSummary({ connection }: { connection: ConnectionStatus | null }) {
  const checks = connection ? [{ label: 'Webhook signature', ready: connection.webhookSecretConfigured }, { label: 'History import', ready: connection.historyImportAvailable }, { label: 'Durable storage', ready: connection.databaseConfigured }] : []
  return <section className="rounded-2xl border border-white/[.06] bg-[#090a0f]/60 p-4 backdrop-blur"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-white">System</h2><span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-black">{checks.filter(c => c.ready).length}/3</span></div><div className="mt-4 space-y-2">{checks.length ? checks.map(check => <div key={check.label} className="flex items-center justify-between rounded-xl bg-black/25 px-3 py-2.5"><span className="text-xs text-neutral-300">{check.label}</span><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${check.ready ? 'bg-[#00ff87]/15 text-[#00ff87]' : 'bg-amber-300/15 text-amber-200'}`}><span className={`h-1.5 w-1.5 rounded-full ${check.ready ? 'bg-[#00ff87]' : 'bg-amber-300'}`} />{check.ready ? 'Ready' : 'Setup'}</span></div>) : <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-neutral-500">Connect the API to check readiness.</p>}</div></section>
}

function Step({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) { return <div className="flex gap-3"><div className="mt-0.5 rounded-lg border border-white/10 bg-white/[.04] p-1.5 text-[#00ff87]"><Icon className="h-3.5 w-3.5" /></div><div><p className="text-xs font-semibold text-white">{title}</p><p className="mt-0.5 text-xs leading-relaxed text-neutral-400">{text}</p></div></div> }
function CheckoutButtonCard({ onSuccess }: { onSuccess: () => void }) { return <section className="rounded-2xl border border-[#00ff87]/15 bg-[#00ff87]/[0.04] p-5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#00ff87]">Test without risk</p><h2 className="mt-1.5 text-sm font-semibold text-white">Send a Test Mode payment</h2><p className="mt-1 text-xs leading-relaxed text-neutral-400">Creates a ₹500 Razorpay order. Pay with a test card and watch the incident appear.</p><div className="mt-4"><CheckoutButton onSuccess={onSuccess} /></div></section> }
