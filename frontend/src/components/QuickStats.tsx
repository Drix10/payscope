import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { Incident } from '../types/mvp'

interface QuickStatsProps {
  incidents: Incident[]
  allIncidents: Incident[]
}

export function QuickStats({ incidents, allIncidents }: QuickStatsProps) {
  const totalAtRisk = incidents.reduce((sum, i) => sum + i.remainingAmountPaise, 0)
  const totalRecovered = incidents.reduce((sum, i) => sum + i.recoveredAmountPaise, 0)
  const recoveryRate = incidents.length > 0
    ? (incidents.filter(i => i.recoveredAmountPaise > 0).length / incidents.length) * 100
    : 0

  const avgAmount = incidents.length > 0
    ? totalAtRisk / incidents.length
    : 0

  // Calculate trend (comparing filtered vs all)
  const allRecoveryRate = allIncidents.length > 0
    ? (allIncidents.filter(i => i.recoveredAmountPaise > 0).length / allIncidents.length) * 100
    : 0
  
  const trend = recoveryRate - allRecoveryRate
  const trendDirection = Math.abs(trend) < 0.1 ? 'neutral' : trend > 0 ? 'up' : 'down'

  const money = (paise: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(paise / 100)

  return (
    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
      <div className="rounded-xl border border-white/[.08] bg-black/20 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
          Total at Risk
        </p>
        <p className="mt-1 text-lg font-extrabold text-white">{money(totalAtRisk)}</p>
        <p className="mt-0.5 text-[10px] text-neutral-500">{incidents.length} incidents</p>
      </div>

      <div className="rounded-xl border border-[#00ff87]/25 bg-[#00ff87]/[.06] p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#86f4bd]">
          Recovered
        </p>
        <p className="mt-1 text-lg font-extrabold text-[#00ff87]">{money(totalRecovered)}</p>
        <p className="mt-0.5 text-[10px] text-[#86f4bd]/80">
          {recoveryRate.toFixed(1)}% rate
        </p>
      </div>

      <div className="rounded-xl border border-white/[.08] bg-black/20 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
          Avg Amount
        </p>
        <p className="mt-1 text-lg font-extrabold text-white">{money(avgAmount)}</p>
        <p className="mt-0.5 text-[10px] text-neutral-500">per incident</p>
      </div>

      <div className="rounded-xl border border-white/[.08] bg-black/20 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
          Recovery Trend
        </p>
        <div className="mt-1 flex items-baseline gap-1.5">
          <p className="text-lg font-extrabold text-white">{recoveryRate.toFixed(1)}%</p>
          {trendDirection === 'up' && <TrendingUp className="h-3.5 w-3.5 text-[#00ff87]" />}
          {trendDirection === 'down' && <TrendingDown className="h-3.5 w-3.5 text-rose-400" />}
          {trendDirection === 'neutral' && <Minus className="h-3.5 w-3.5 text-neutral-400" />}
        </div>
        <p className="mt-0.5 text-[10px] text-neutral-500">
          {Math.abs(trend).toFixed(1)}% vs all
        </p>
      </div>
    </div>
  )
}
