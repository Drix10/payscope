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
  { id: 'overview', label: 'Overview', description: 'At-a-glance', icon: LayoutDashboard },
  { id: 'incidents', label: 'Incidents', description: 'Payment risk', icon: Bell },
  { id: 'connections', label: 'Connections', description: 'Signals', icon: Cable },
  { id: 'policies', label: 'Policies', description: 'Automation', icon: Settings2 },
]

export function DashboardSidebar({ activeSection, onChange, dashboard, connection }: DashboardSidebarProps) {
  const readyChecks = connection ? [connection.webhookSecretConfigured, connection.historyImportAvailable, connection.databaseConfigured].filter(Boolean).length : 0
  const isOnline = Boolean(connection)

  return (
    <aside className="h-fit lg:sticky lg:top-[88px]">
      <div className="rounded-2xl border border-white/[.06] bg-[#090a0f]/60 p-2 backdrop-blur-xl">
        <nav aria-label="Dashboard sections" className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible">
          {items.map(({ id, label, description, icon: Icon }) => {
            const active = activeSection === id
            const count = id === 'incidents' ? dashboard?.openIncidentCount : undefined
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange(id)}
                aria-current={active ? 'page' : undefined}
                className={`group flex min-w-[124px] flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition lg:w-full ${active ? 'bg-white text-black' : 'text-neutral-400 hover:bg-white/[.05] hover:text-white'}`}
              >
                <span className={`rounded-lg p-1 ${active ? 'bg-black/10 text-black' : 'bg-white/[.06] text-neutral-400 group-hover:text-white'}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 text-[12px] font-semibold leading-none">
                    <span>{label}</span>
                    {count !== undefined && count > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${active ? 'bg-black text-white' : 'bg-rose-500/15 text-rose-300'}`}>{count}</span>}
                  </span>
                  <span className={`mt-1 hidden text-[10px] leading-none lg:block ${active ? 'text-black/60' : 'text-neutral-500'}`}>{description}</span>
                </span>
                <ChevronRight className={`hidden h-3 w-3 shrink-0 lg:block ${active ? 'text-black/40' : 'text-neutral-600'}`} />
              </button>
            )
          })}
        </nav>

        <div className="mt-3 rounded-xl bg-black/25 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-neutral-500">
              <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-[#00ff87] shadow-[0_0_8px_#00ff87]' : 'bg-amber-300'}`} /> API
            </span>
            <span className={`text-[11px] font-semibold ${isOnline ? 'text-white' : 'text-amber-200'}`}>{isOnline ? `${readyChecks}/3` : '—'}</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-400">{isOnline ? 'Live signal path' : 'Waiting for backend'}</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full transition-all ${isOnline ? 'bg-[#00ff87]' : 'bg-amber-300'}`} style={{ width: `${isOnline ? Math.max(14, (readyChecks / 3) * 100) : 10}%` }} />
          </div>
        </div>

        <p className="mt-2.5 flex items-start gap-1.5 px-1 text-[10px] leading-relaxed text-neutral-500">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-neutral-500" />
          <span>
            <span className="font-semibold text-neutral-300">Human in loop.</span> No transfer, refund, or subscription change is executed automatically.
          </span>
        </p>
      </div>

      <div className="mt-3 hidden rounded-xl border border-white/[.06] bg-white/[.02] p-3 lg:block">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-[#00ff87]" />
          <span className="text-[10px] font-bold uppercase tracking-[.14em] text-white">Why PayScope</span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-400">Turns noisy webhooks into reviewable incidents. Every decision is evidence-bound and audited.</p>
      </div>
    </aside>
  )
}
