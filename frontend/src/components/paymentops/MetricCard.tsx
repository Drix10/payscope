import { LucideIcon } from 'lucide-react'

export function MetricCard({ label, value, detail, icon: Icon, tone = 'mint' }: { label: string; value: string; detail: string; icon: LucideIcon; tone?: 'mint' | 'rose' | 'amber' | 'sky' }) {
  const accent: Record<string, string> = {
    mint: 'bg-[#00ff87]',
    rose: 'bg-rose-400',
    amber: 'bg-amber-300',
    sky: 'bg-sky-300',
  }
  const iconTone: Record<string, string> = {
    mint: 'text-[#00ff87] bg-[#00ff87]/10 border-[#00ff87]/15',
    rose: 'text-rose-300 bg-rose-400/10 border-rose-400/15',
    amber: 'text-amber-300 bg-amber-300/10 border-amber-300/15',
    sky: 'text-sky-300 bg-sky-300/10 border-sky-300/15',
  }
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-white/[.06] bg-[#0a0d12]/80 p-4 backdrop-blur-xl transition hover:border-white/[.09] hover:bg-[#0f1320]/80">
      <div className={`absolute inset-x-0 top-0 h-px ${accent[tone]} opacity-60`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">{label}</p>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-white">{value}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">{detail}</p>
        </div>
        <div className={`rounded-xl border p-2 ${iconTone[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </article>
  )
}
