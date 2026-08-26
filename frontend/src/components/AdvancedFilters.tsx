import { useState } from 'react'
import { ChevronDown, Filter, X } from 'lucide-react'
import type { Incident } from '../types/mvp'

export interface FilterState {
  riskTiers: Set<Incident['riskTier']>
  statuses: Set<Incident['status']>
  amountRange: { min: number; max: number } | null
  dateRange: { start: string; end: string } | null
}

interface AdvancedFiltersProps {
  filters: FilterState
  onChange: (filters: FilterState) => void
  onReset: () => void
}

export function AdvancedFilters({ filters, onChange, onReset }: AdvancedFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const toggleRiskTier = (tier: Incident['riskTier']) => {
    const updated = new Set(filters.riskTiers)
    if (updated.has(tier)) {
      updated.delete(tier)
    } else {
      updated.add(tier)
    }
    onChange({ ...filters, riskTiers: updated })
  }

  const toggleStatus = (status: Incident['status']) => {
    const updated = new Set(filters.statuses)
    if (updated.has(status)) {
      updated.delete(status)
    } else {
      updated.add(status)
    }
    onChange({ ...filters, statuses: updated })
  }

  const setAmountRange = (min: number, max: number) => {
    onChange({ ...filters, amountRange: { min, max } })
  }

  const clearAmountRange = () => {
    onChange({ ...filters, amountRange: null })
  }

  const setDateRange = (start: string, end: string) => {
    onChange({ ...filters, dateRange: { start, end } })
  }

  const clearDateRange = () => {
    onChange({ ...filters, dateRange: null })
  }

  const activeFilterCount = 
    filters.riskTiers.size +
    filters.statuses.size +
    (filters.amountRange ? 1 : 0) +
    (filters.dateRange ? 1 : 0)

  return (
    <div className="border-b border-white/[.08] bg-[#07080d] p-4">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-[#00ff87]" />
          <span className="text-sm font-semibold text-white">Advanced Filters</span>
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-[#00ff87]/20 px-2 py-0.5 text-[10px] font-bold text-[#00ff87]">
              {activeFilterCount}
            </span>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-neutral-400 transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* Risk Tier Filter */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-neutral-300">
              Risk Tier
            </label>
            <div className="flex flex-wrap gap-2">
              {(['CRITICAL', 'HIGH', 'MEDIUM', 'MONITOR'] as const).map(tier => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => toggleRiskTier(tier)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    filters.riskTiers.has(tier)
                      ? 'border-[#00ff87]/35 bg-[#00ff87]/10 text-[#b8f8d8]'
                      : 'border-white/[.08] text-neutral-500 hover:bg-white/[.05]'
                  }`}
                >
                  {tier}
                </button>
              ))}
            </div>
          </div>

          {/* Status Filter */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-neutral-300">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {(['OPEN', 'MONITORING', 'ESCALATED', 'DISPUTE_OPENED', 'RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED'] as const).map(
                status => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleStatus(status)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      filters.statuses.has(status)
                        ? 'border-[#00ff87]/35 bg-[#00ff87]/10 text-[#b8f8d8]'
                        : 'border-white/[.08] text-neutral-500 hover:bg-white/[.05]'
                    }`}
                  >
                    {status.replace(/_/g, ' ')}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Amount Range Filter */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold text-neutral-300">
                Amount Range (₹)
              </label>
              {filters.amountRange && (
                <button
                  type="button"
                  onClick={clearAmountRange}
                  className="text-xs text-neutral-500 hover:text-neutral-300"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Min"
                value={filters.amountRange?.min ?? ''}
                onChange={e => {
                  const min = Number(e.target.value) || 0
                  const max = filters.amountRange?.max ?? 100000
                  setAmountRange(min, max)
                }}
                className="flex-1 rounded-lg border border-white/[.08] bg-black/20 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-[#00ff87]/30 focus:outline-none"
              />
              <input
                type="number"
                placeholder="Max"
                value={filters.amountRange?.max ?? ''}
                onChange={e => {
                  const max = Number(e.target.value) || 100000
                  const min = filters.amountRange?.min ?? 0
                  setAmountRange(min, max)
                }}
                className="flex-1 rounded-lg border border-white/[.08] bg-black/20 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-[#00ff87]/30 focus:outline-none"
              />
            </div>
          </div>

          {/* Date Range Filter */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold text-neutral-300">
                Date Range
              </label>
              {filters.dateRange && (
                <button
                  type="button"
                  onClick={clearDateRange}
                  className="text-xs text-neutral-500 hover:text-neutral-300"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="date"
                value={filters.dateRange?.start ?? ''}
                onChange={e => {
                  const start = e.target.value
                  const end = filters.dateRange?.end ?? new Date().toISOString().split('T')[0]
                  if (start) setDateRange(start, end)
                }}
                className="flex-1 rounded-lg border border-white/[.08] bg-black/20 px-3 py-2 text-sm text-white focus:border-[#00ff87]/30 focus:outline-none"
              />
              <input
                type="date"
                value={filters.dateRange?.end ?? ''}
                onChange={e => {
                  const end = e.target.value
                  const start = filters.dateRange?.start ?? '2024-01-01'
                  if (end) setDateRange(start, end)
                }}
                className="flex-1 rounded-lg border border-white/[.08] bg-black/20 px-3 py-2 text-sm text-white focus:border-[#00ff87]/30 focus:outline-none"
              />
            </div>
          </div>

          {/* Reset Button */}
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[.04] px-4 py-2 text-sm font-semibold text-neutral-200 hover:bg-white/[.09]"
            >
              <X className="h-4 w-4" />
              Reset All Filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function applyFilters(incidents: Incident[], filters: FilterState): Incident[] {
  return incidents.filter(incident => {
    // Risk tier filter
    if (filters.riskTiers.size > 0 && !filters.riskTiers.has(incident.riskTier)) {
      return false
    }

    // Status filter
    if (filters.statuses.size > 0 && !filters.statuses.has(incident.status)) {
      return false
    }

    // Amount range filter
    if (filters.amountRange) {
      const amountInRupees = incident.remainingAmountPaise / 100
      if (
        amountInRupees < filters.amountRange.min ||
        amountInRupees > filters.amountRange.max
      ) {
        return false
      }
    }

    // Date range filter
    if (filters.dateRange) {
      const incidentDate = new Date(incident.updatedAt).toISOString().split('T')[0]
      if (
        incidentDate < filters.dateRange.start ||
        incidentDate > filters.dateRange.end
      ) {
        return false
      }
    }

    return true
  })
}
