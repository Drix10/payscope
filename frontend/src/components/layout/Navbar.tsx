import { Activity, LayoutGrid, ShieldCheck } from 'lucide-react'

interface NavbarProps {
  viewMode: 'showcase' | 'dashboard'
  onViewModeChange: (mode: 'showcase' | 'dashboard') => void
  environment?: string
  variant?: 'floating' | 'inline'
}

export function Navbar({ viewMode, onViewModeChange, environment = 'test', variant }: NavbarProps) {
  const isDashboard = viewMode === 'dashboard'
  const resolvedVariant = variant ?? (isDashboard ? 'inline' : 'floating')

  if (resolvedVariant === 'inline') {
    return (
      <header className="sticky top-0 z-40 border-b border-white/[.07] bg-[#040406]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-3 px-4 py-3 sm:px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 p-1 text-[#00ff87]">
                <Activity className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-bold tracking-tight text-white">PayScope</span>
              <span className={`hidden rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide sm:inline ${environment === 'live' ? 'border-rose-400/30 bg-rose-400/10 text-rose-200' : 'border-amber-400/30 bg-amber-400/10 text-amber-200'}`}>
                {environment === 'live' ? 'Live' : 'Test'}
              </span>
            </div>
            <span className="hidden h-4 w-px bg-white/10 sm:block" />
            <span className="hidden text-[10px] font-semibold tracking-wide text-neutral-500 sm:block">Operations</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => onViewModeChange('showcase')} className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-neutral-300 transition hover:border-white/15 hover:text-white sm:flex">
              <LayoutGrid className="h-3.5 w-3.5" /> Showcase
            </button>
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-[#00ff87]/15 p-0.5">
              <span className="flex items-center gap-1 rounded-full bg-[#00ff87] px-2.5 py-1 text-[11px] font-bold text-black"><ShieldCheck className="h-3 w-3" /> Dashboard</span>
            </div>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="fixed top-5 left-1/2 z-40 flex -translate-x-1/2 items-center">
      <div className="smoked-glass hairline-border flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-full px-3 py-2 shadow-2xl backdrop-blur-xl sm:gap-3 sm:px-5">
        <div className="flex shrink-0 items-center gap-2 border-r border-white/10 pr-2 sm:pr-3">
          <div className="rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 p-1 text-[#00ff87]">
            <Activity className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-bold tracking-tight text-white">PayScope</span>
          <span className={`ml-1 hidden rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide sm:inline ${environment === 'live' ? 'border-rose-400/30 bg-rose-400/10 text-rose-200' : 'border-amber-400/30 bg-amber-400/10 text-amber-200'}`}>
            {environment === 'live' ? 'Live' : 'Test'}
          </span>
        </div>
        <div className="flex items-center rounded-full border border-white/10 bg-white/[0.04] p-0.5">
          <button
            type="button"
            aria-pressed={viewMode === 'showcase'}
            onClick={() => onViewModeChange('showcase')}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all sm:px-3.5 sm:text-[11px] ${viewMode === 'showcase' ? 'bg-white text-black shadow-sm' : 'text-neutral-400 hover:text-white'}`}
          >
            <LayoutGrid className="h-3 w-3" /> Overview
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'dashboard'}
            onClick={() => onViewModeChange('dashboard')}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all sm:px-3.5 sm:text-[11px] ${viewMode === 'dashboard' ? 'bg-[#00ff87] text-black shadow-sm' : 'text-neutral-400 hover:text-white'}`}
          >
            <ShieldCheck className="h-3 w-3" /> Dashboard
          </button>
        </div>
      </div>
    </header>
  )
}
