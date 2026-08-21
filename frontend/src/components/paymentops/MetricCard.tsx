import { LucideIcon } from 'lucide-react'

export function MetricCard({ label, value, detail, icon: Icon, tone = 'mint' }: { label: string; value: string; detail: string; icon: LucideIcon; tone?: 'mint' | 'rose' | 'amber' | 'sky' }) {
  const tones = {
    mint: 'border-[#00ff87]/20 bg-[#00ff87]/[0.06] text-[#b8ffd9] shadow-[0_0_20px_rgba(0,255,135,0.08)]',
    rose: 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200 shadow-[0_0_20px_rgba(251,113,133,0.08)]',
    amber: 'border-amber-300/20 bg-amber-300/[0.06] text-amber-100 shadow-[0_0_20px_rgba(252,211,77,0.08)]',
    sky: 'border-sky-300/20 bg-sky-300/[0.06] text-sky-100 shadow-[0_0_20px_rgba(125,211,252,0.08)]',
  }
  return (
    <article className={`group relative overflow-hidden rounded-2xl border p-4 backdrop-blur-xl transition-all hover:scale-[1.02] hover:shadow-2xl ${tones[tone]}`}>
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] opacity-70">{label}</p>
          <p className="mt-2 bg-gradient-to-br from-white to-white/80 bg-clip-text text-2xl font-bold tracking-tight text-transparent">{value}</p>
          <p className="mt-1 text-[10px] leading-relaxed opacity-75">{detail}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-2.5 backdrop-blur shadow-inner">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </article>
  )
}
