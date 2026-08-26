import { ArrowDownAZ, ArrowUpAZ } from 'lucide-react'
import type { Incident } from '../types/mvp'

export type SortField = 'updatedAt' | 'remainingAmount' | 'riskTier' | 'openedAt'
export type SortDirection = 'asc' | 'desc'

export interface SortConfig {
  field: SortField
  direction: SortDirection
}

interface SortControlsProps {
  sortConfig: SortConfig
  onChange: (config: SortConfig) => void
}

const riskOrder: Record<Incident['riskTier'], number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  MONITOR: 3,
}

export function SortControls({ sortConfig, onChange }: SortControlsProps) {
  const sortOptions: Array<{ value: SortField; label: string }> = [
    { value: 'updatedAt', label: 'Last Updated' },
    { value: 'openedAt', label: 'Created Date' },
    { value: 'remainingAmount', label: 'Amount at Risk' },
    { value: 'riskTier', label: 'Risk Priority' },
  ]

  const toggleDirection = () => {
    onChange({
      ...sortConfig,
      direction: sortConfig.direction === 'asc' ? 'desc' : 'asc',
    })
  }

  const changeField = (field: SortField) => {
    onChange({ field, direction: sortConfig.direction })
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={sortConfig.field}
        onChange={e => changeField(e.target.value as SortField)}
        className="rounded-lg border border-white/[.08] bg-black/20 px-3 py-2 text-xs font-semibold text-white focus:border-[#00ff87]/30 focus:outline-none"
      >
        {sortOptions.map(option => (
          <option key={option.value} value={option.value}>
            Sort by {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={toggleDirection}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-white/[.09]"
        title={`Sort ${sortConfig.direction === 'asc' ? 'ascending' : 'descending'}`}
      >
        {sortConfig.direction === 'asc' ? (
          <ArrowUpAZ className="h-4 w-4" />
        ) : (
          <ArrowDownAZ className="h-4 w-4" />
        )}
        {sortConfig.direction === 'asc' ? 'Asc' : 'Desc'}
      </button>
    </div>
  )
}

export function sortIncidents(
  incidents: Incident[],
  sortConfig: SortConfig
): Incident[] {
  return [...incidents].sort((a, b) => {
    let comparison = 0

    switch (sortConfig.field) {
      case 'updatedAt':
        comparison = Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
        break
      case 'openedAt':
        comparison = Date.parse(a.openedAt) - Date.parse(b.openedAt)
        break
      case 'remainingAmount':
        comparison = a.remainingAmountPaise - b.remainingAmountPaise
        break
      case 'riskTier':
        comparison = riskOrder[a.riskTier] - riskOrder[b.riskTier]
        break
    }

    return sortConfig.direction === 'asc' ? comparison : -comparison
  })
}
