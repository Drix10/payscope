import { Activity, Bell, Cable, ChevronRight, LayoutDashboard, Settings2, ShieldCheck } from 'lucide-react'
import { ConnectionStatus, Dashboard } from '../../types/paymentOps'

export type WorkspaceSection = 'overview' | 'incidents' | 'connections' | 'policies'

interface DashboardSidebarProps {
  activeSection: WorkspaceSection
  onChange: (section: WorkspaceSection) => void
  dashboard: Dashboard | null
  connection: ConnectionStatus | null
}

const items: Array<{ id: WorkspaceSection; label: string; description: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', description: 'See the current picture', icon: LayoutDashboard },
  { id: 'incidents', label: 'Incidents', description: 'Review payment risk', icon: Bell },
  { id: 'connections', label: 'Connections', description: 'Check Razorpay signals', icon: Cable },
  { id: 'policies', label: 'Policies', description: 'Control safe automation', icon: Settings2 },
]

export function DashboardSidebar({ activeSection, onChange, dashboard, connection }: DashboardSidebarProps) {
  const readyChecks = connection ? [connection.webhookSecretConfigured, connection.historyImportAvailable, connection.databaseConfigured].filter(Boolean).length : 0
  const isOnline = Boolean(connection)

  return (
    <aside className="h-fit lg:sticky lg:top-28">
      <div className="rounded-2xl border border-white/[.09] bg-[#090a0f]/85 p-3 shadow-2xl shadow-black/20 backdrop-blur-xl">
        <div className="mb-3 flex items-center gap-2 px-2 py-1">
          <div className="rounded-lg border border-[#00ff87]/25 bg-[#00ff87]/10 p-1.5 text-[#00ff87]"><Activity className="h-3.5 w-3.5" /></div>
          <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-white">Workspace</p><p className="text-[9px] text-neutral-500">PayScope operations</p></div>
        </div>

        <nav aria-label="Dashboard sections" className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible">
          {items.map(({ id, label, description, icon: Icon }) => {
            const active = activeSection === id
            const count = id === 'incidents' ? dashboard?.openIncidentCount : undefined
            return <button key={id} type="button" onClick={() => onChange(id)} aria-current={active ? 'page' : undefined} className={`group flex min-w-[132px] flex-1 items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-all lg:w-full ${active ? 'border-[#00ff87]/25 bg-[#00ff87]/[.09] text-white shadow-[inset_0_0_20px_rgba(0,255,135,.04)]' : 'border-transparent text-neutral-400 hover:border-white/[.08] hover:bg-white/[.04] hover:text-white'}`}><div className={`rounded-lg p-1.5 ${active ? 'bg-[#00ff87]/15 text-[#00ff87]' : 'bg-white/[.04] text-neutral-500 group-hover:text-neutral-300'}`}><Icon className="h-3.5 w-3.5" /></div><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 text-[11px] font-semibold"><span>{label}</span>{count !== undefined && count > 0 && <span className="rounded-full bg-rose-400/15 px-1.5 py-0.5 text-[9px] font-bold text-rose-200">{count}</span>}</span><span className="mt-0.5 hidden truncate text-[9px] text-neutral-500 lg:block">{description}</span></span><ChevronRight className={`hidden h-3 w-3 shrink-0 lg:block ${active ? 'text-[#00ff87]' : 'text-neutral-700'}`} /></button>
          })}
        </nav>

        <div className="mt-3 border-t border-white/[.08] pt-3">
          <div className="rounded-xl border border-white/[.07] bg-black/20 p-2.5">
            <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.12em] text-neutral-500"><span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-[#00ff87] shadow-[0_0_8px_#00ff87]' : 'bg-amber-300'}`} />API status</span><span className={isOnline ? 'text-[9px] font-semibold text-[#b8ffd9]' : 'text-[9px] font-semibold text-amber-200'}>{isOnline ? 'Online' : 'Waiting'}</span></div>
            <p className="mt-2 text-[10px] leading-relaxed text-neutral-400">{isOnline ? `${readyChecks}/3 core systems ready` : 'Connect the backend to load live operations.'}</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.08]"><div className={`h-full rounded-full transition-all ${isOnline ? 'bg-[#00ff87]' : 'bg-amber-300'}`} style={{ width: `${isOnline ? Math.max(12, (readyChecks / 3) * 100) : 8}%` }} /></div>
          </div>
          <p className="mt-3 flex items-start gap-1.5 px-2 text-[9px] leading-relaxed text-neutral-600"><ShieldCheck className="h-3 w-3 shrink-0 text-[#00ff87]/70" />No financial payment operation is executed automatically; policies only auto-record operational decisions within your thresholds.</p>
        </div>
      </div>
    </aside>
  )
}
