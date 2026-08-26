import { Download } from 'lucide-react'
import type { Incident, IncidentDetail } from '../types/mvp'

interface ExportDataProps {
  incidents: Incident[]
  disabled?: boolean
}

export function ExportData({ incidents, disabled }: ExportDataProps) {
  const exportToCSV = () => {
    if (incidents.length === 0) return

    // CSV Headers
    const headers = [
      'Incident ID',
      'Risk Tier',
      'Status',
      'Total Failed Amount (Paise)',
      'Recovered Amount (Paise)',
      'Remaining Amount (Paise)',
      'Opened At',
      'Resolved At',
      'Updated At',
      'Event Count',
    ]

    // Convert incidents to CSV rows
    const rows = incidents.map(incident => [
      incident.id,
      incident.riskTier,
      incident.status,
      incident.totalFailedAmountPaise,
      incident.recoveredAmountPaise,
      incident.remainingAmountPaise,
      incident.openedAt,
      incident.resolvedAt || 'N/A',
      incident.updatedAt,
      incident.correlatedEventIds.length,
    ])

    // Create CSV content
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n')

    // Create download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `payscope-incidents-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportToJSON = () => {
    if (incidents.length === 0) return

    // Create sanitized export (remove sensitive organization data if needed)
    const exportData = {
      exportedAt: new Date().toISOString(),
      totalIncidents: incidents.length,
      totalAtRiskPaise: incidents.reduce((sum, i) => sum + i.remainingAmountPaise, 0),
      totalRecoveredPaise: incidents.reduce((sum, i) => sum + i.recoveredAmountPaise, 0),
      incidents: incidents.map(incident => ({
        id: incident.id,
        riskTier: incident.riskTier,
        status: incident.status,
        totalFailedAmountPaise: incident.totalFailedAmountPaise,
        recoveredAmountPaise: incident.recoveredAmountPaise,
        remainingAmountPaise: incident.remainingAmountPaise,
        eventCount: incident.correlatedEventIds.length,
        openedAt: incident.openedAt,
        resolvedAt: incident.resolvedAt,
        updatedAt: incident.updatedAt,
      })),
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `payscope-incidents-${new Date().toISOString().split('T')[0]}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={exportToCSV}
        disabled={disabled || incidents.length === 0}
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-white/[.09] disabled:cursor-not-allowed disabled:opacity-50"
        title="Export incidents to CSV"
      >
        <Download className="h-3.5 w-3.5" />
        CSV
      </button>
      <button
        type="button"
        onClick={exportToJSON}
        disabled={disabled || incidents.length === 0}
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-white/[.09] disabled:cursor-not-allowed disabled:opacity-50"
        title="Export incidents to JSON"
      >
        <Download className="h-3.5 w-3.5" />
        JSON
      </button>
    </div>
  )
}
