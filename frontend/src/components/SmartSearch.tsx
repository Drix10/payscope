import { useState, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import type { Incident } from '../types/mvp'

interface SmartSearchProps {
  incidents: Incident[]
  onResults: (results: Incident[]) => void
  onClear: () => void
}

export function SmartSearch({ incidents, onResults, onClear }: SmartSearchProps) {
  const [query, setQuery] = useState('')

  const searchResults = useMemo(() => {
    if (!query.trim()) return incidents

    const normalizedQuery = query.toLowerCase().trim()
    const tokens = normalizedQuery.split(/\s+/)

    return incidents.filter(incident => {
      // Search across multiple fields
      const searchableText = [
        incident.id,
        incident.riskTier,
        incident.status,
        incident.remainingAmountPaise.toString(),
        new Date(incident.openedAt).toLocaleDateString(),
        new Date(incident.updatedAt).toLocaleDateString(),
      ]
        .join(' ')
        .toLowerCase()

      // Match if all tokens are present (AND logic)
      return tokens.every(token => searchableText.includes(token))
    })
  }, [incidents, query])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    if (value.trim()) {
      onResults(searchResults)
    } else {
      onClear()
    }
  }

  const handleClear = () => {
    setQuery('')
    onClear()
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          type="search"
          placeholder="Search incidents by ID, status, amount, date..."
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          className="w-full rounded-lg border border-white/[.08] bg-black/20 py-2 pl-10 pr-10 text-sm text-white placeholder-neutral-500 focus:border-[#00ff87]/30 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-0.5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {query && (
        <div className="mt-2 text-xs text-neutral-400">
          Found {searchResults.length} incident{searchResults.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}
