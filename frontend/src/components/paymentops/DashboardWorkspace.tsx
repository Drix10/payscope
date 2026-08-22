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
    overview: ['Command center', 'Understand the current payment picture before you act.', 'A focused summary of money movement, open risk, and the latest verified signals.'],
    incidents: ['Incident review', 'Work through payment risk, one incident at a time.', 'Every incident keeps its evidence, investigation, and operator decision together.'],
    connections: ['Data connections', 'Make sure PayScope can see the right payment signals.', 'Razorpay webhooks, history imports, and durable storage power the workspace.'],
    policies: ['Automation controls', 'Decide what the agent is allowed to handle.', 'Policies only run inside the thresholds you define. Everything else stays with a human.'],
  }[section]

  return <div className="min-w-0">
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#b8ffd9]">{copy[0]}</p><h1 className="mt-1.5 text-xl font-bold tracking-tight text-white sm:text-2xl">{copy[1]}</h1><p className="mt-1.5 max-w-2xl text-[11px] leading-relaxed text-neutral-400">{copy[2]}</p></div><span className="flex shrink-0 items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-neutral-600"><ShieldCheck className="h-3.5 w-3.5 text-[#00ff87]/70" />Evidence first</span></div>
    {section === 'overview' && <Overview {...props} />}
    {section === 'incidents' && <Incidents {...props} />}
    {section === 'connections' && <Connections {...props} />}
    {section === 'policies' && <Policies {...props} />}
  </div>
}

function Overview({ dashboard, incidents, connection, loading, onSelectIncident }: DashboardWorkspaceProps) {
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><MetricCard label="Captured volume" value={dashboard ? money(dashboard.capturedVolumePaise) : '—'} detail={dashboard ? `${dashboard.eventWindow.loadedEventCount} retained events` : 'Waiting for verified events'} icon={CircleDollarSign} tone="mint" /><MetricCard label="Amount at risk" value={dashboard ? money(dashboard.failedAmountAtRiskPaise) : '—'} detail="Open incidents, net of recovery" icon={TriangleAlert} tone="rose" /><MetricCard label="Recovered" value={dashboard ? money(dashboard.recoveredAmountPaise) : '—'} detail="Linked verified success events" icon={ShieldCheck} tone="sky" /><MetricCard label="Open incidents" value={dashboard ? String(dashboard.openIncidentCount) : '—'} detail="Needs review or monitoring" icon={Activity} tone="amber" /><MetricCard label="Investigations" value={dashboard ? String(dashboard.completedInvestigations) : '—'} detail="Completed evidence-bound runs" icon={Sparkles} tone="sky" /></section>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]"><section className="min-w-0"><div className="mb-2 flex items-end justify-between gap-3"><div><h2 className="text-sm font-bold text-white">Needs attention</h2><p className="mt-0.5 text-[10px] text-neutral-500">Start here when you open the workspace.</p></div><span className="text-[10px] font-semibold text-neutral-500">{dashboard?.openIncidentCount ?? 0} open</span></div><IncidentList incidents={incidents} activeId={undefined} onSelect={onSelectIncident} loading={loading} /></section><div className="space-y-5"><SignalSummary dashboard={dashboard} /><SystemSummary connection={connection} /></div></div>
  </div>
}

function Incidents({ incidents, selected, loading, detailLoading, actionPending, onSelectIncident, onCloseIncident, onInvestigate, onAction }: DashboardWorkspaceProps) {
  return <div className="grid gap-5 xl:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]"><IncidentList incidents={incidents} activeId={selected?.incident.incidentId} onSelect={onSelectIncident} loading={loading} /><IncidentDetail detail={selected} loading={detailLoading} onClose={onCloseIncident} onInvestigate={onInvestigate} onAction={type => onAction(type)} actionPending={actionPending} /></div>
}

function Connections({ connection, importing, historyProgress, onImport, onRefresh }: DashboardWorkspaceProps) {
  return <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]"><ConnectionPanel connection={connection} importing={importing} historyProgress={historyProgress} onImport={onImport} /><div className="space-y-5"><section className="rounded-2xl border border-white/[.09] bg-[#090a0f]/80 p-5"><p className="flex items-center gap-2 text-xs font-bold text-white"><CheckCircle2 className="h-4 w-4 text-[#00ff87]" />How data moves</p><div className="mt-4 space-y-3"><Step icon={KeyRound} title="Razorpay verifies" text="Signed webhook events arrive at your private API endpoint." /><Step icon={Database} title="PayScope stores" text="Signals are deduplicated and correlated into incidents." /><Step icon={ShieldCheck} title="You decide" text="Investigations explain the evidence; people or policies decide next steps." /></div></section><CheckoutButtonCard onSuccess={onRefresh} /></div></div>
}

function Policies({ policies, policyBusy, onTogglePolicy, onDeletePolicy, onCreatePolicy }: DashboardWorkspaceProps) {
  return <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]"><PolicyPanel policies={policies} onToggle={onTogglePolicy} onDelete={onDeletePolicy} onCreate={onCreatePolicy} busy={policyBusy} /><section className="rounded-2xl border border-amber-300/15 bg-amber-300/[.04] p-5"><p className="flex items-center gap-2 text-xs font-bold text-amber-100"><ShieldCheck className="h-4 w-4" />Guardrails</p><ul className="mt-4 space-y-3 text-[10px] leading-relaxed text-neutral-400"><li>Investigations must complete before an automation policy can run.</li><li>Escalation stays human-approved by default.</li><li>Auto-dismiss is limited to low or medium severity and amounts up to ₹1,000.</li><li>All automated decisions are recorded in the audit trail.</li></ul></section></div>
}

function SignalSummary({ dashboard }: { dashboard: Dashboard | null }) {
  return <section className="rounded-2xl border border-white/[.09] bg-[#090a0f]/80 p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xs font-bold text-white">Latest signals</h2><p className="mt-0.5 text-[10px] text-neutral-500">Verified events in the loaded window.</p></div><Activity className="h-4 w-4 text-sky-300" /></div><div className="mt-3 space-y-2">{dashboard?.recentEvents.length ? dashboard.recentEvents.slice(0, 5).map(event => <div key={event.eventId} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-black/15 px-3 py-2"><div className="min-w-0"><p className="truncate text-[10px] font-semibold text-neutral-200">{event.eventType}</p><p className="truncate text-[9px] text-neutral-600">{event.customerReference}</p></div><span className="shrink-0 text-[9px] text-neutral-500">{relative(event.occurredAt)}</span></div>) : <p className="rounded-xl border border-dashed border-white/[.1] p-3 text-[10px] leading-relaxed text-neutral-500">No verified events yet. Connect Razorpay or import recent history.</p>}</div></section>
}

function SystemSummary({ connection }: { connection: ConnectionStatus | null }) {
  const checks = connection ? [{ label: 'Webhook signature', ready: connection.webhookSecretConfigured }, { label: 'History import', ready: connection.historyImportAvailable }, { label: 'Durable storage', ready: connection.databaseConfigured }] : []
  return <section className="rounded-2xl border border-white/[.09] bg-[#090a0f]/80 p-4"><div className="flex items-center justify-between"><div><h2 className="text-xs font-bold text-white">System readiness</h2><p className="mt-0.5 text-[10px] text-neutral-500">Everything required for a reliable signal path.</p></div><span className="rounded-full border border-[#00ff87]/20 bg-[#00ff87]/[.07] px-2 py-1 text-[9px] font-bold text-[#b8ffd9]">{checks.filter(check => check.ready).length}/3 ready</span></div><div className="mt-3 space-y-2">{checks.length ? checks.map(check => <div key={check.label} className="flex items-center justify-between rounded-xl border border-white/[.07] bg-black/15 px-3 py-2 text-[10px]"><span className="text-neutral-300">{check.label}</span><span className={check.ready ? 'font-semibold text-[#b8ffd9]' : 'font-semibold text-amber-200'}>{check.ready ? 'Ready' : 'Needs setup'}</span></div>) : <p className="rounded-xl border border-dashed border-white/[.1] p-3 text-[10px] text-neutral-500">Connect the API to check system readiness.</p>}</div></section>
}

function Step({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) { return <div className="flex gap-3"><div className="mt-0.5 rounded-lg border border-white/10 bg-white/[.04] p-1.5 text-[#00ff87]"><Icon className="h-3.5 w-3.5" /></div><div><p className="text-[10px] font-semibold text-neutral-200">{title}</p><p className="mt-0.5 text-[10px] leading-relaxed text-neutral-500">{text}</p></div></div> }
function CheckoutButtonCard({ onSuccess }: { onSuccess: () => void }) { return <section className="rounded-2xl border border-[#00ff87]/15 bg-[#00ff87]/[.04] p-4"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#b8ffd9]">Test safely</p><h2 className="mt-1.5 text-sm font-bold text-white">Send a test payment</h2><p className="mt-1 text-[10px] leading-relaxed text-neutral-400">Create a Razorpay Test Mode order and watch the verified signal arrive here.</p><div className="mt-3"><CheckoutButton onSuccess={onSuccess} /></div></section> }
