import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  page: number
  totalPages: number
  totalItems: number
  startIndex: number
  endIndex: number
  hasNextPage: boolean
  hasPrevPage: boolean
  onNextPage: () => void
  onPrevPage: () => void
  onGoToPage: (page: number) => void
}

export function Pagination({
  page,
  totalPages,
  totalItems,
  startIndex,
  endIndex,
  hasNextPage,
  hasPrevPage,
  onNextPage,
  onPrevPage,
  onGoToPage,
}: PaginationProps) {
  if (totalPages <= 1) return null

  // Generate page numbers to display (show current, prev, next, first, last)
  const pageNumbers: (number | 'ellipsis')[] = []
  
  if (totalPages <= 7) {
    // Show all pages if 7 or fewer
    for (let i = 1; i <= totalPages; i++) {
      pageNumbers.push(i)
    }
  } else {
    // Always show first page
    pageNumbers.push(1)
    
    if (page > 3) {
      pageNumbers.push('ellipsis')
    }
    
    // Show pages around current
    const start = Math.max(2, page - 1)
    const end = Math.min(totalPages - 1, page + 1)
    
    for (let i = start; i <= end; i++) {
      pageNumbers.push(i)
    }
    
    if (page < totalPages - 2) {
      pageNumbers.push('ellipsis')
    }
    
    // Always show last page
    pageNumbers.push(totalPages)
  }

  return (
    <div className="flex items-center justify-between border-t border-white/[.08] px-4 py-3">
      <div className="text-xs text-neutral-400">
        Showing {startIndex}–{endIndex} of {totalItems}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrevPage}
          disabled={!hasPrevPage}
          className="inline-flex items-center rounded-lg border border-white/10 bg-white/[.04] p-2 text-neutral-200 hover:bg-white/[.09] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {pageNumbers.map((pageNum, index) =>
          pageNum === 'ellipsis' ? (
            <span
              key={`ellipsis-${index}`}
              className="px-2 text-sm text-neutral-500"
            >
              ...
            </span>
          ) : (
            <button
              key={pageNum}
              type="button"
              onClick={() => onGoToPage(pageNum)}
              className={`min-w-[32px] rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                page === pageNum
                  ? 'border-[#00ff87]/35 bg-[#00ff87]/10 text-[#b8f8d8]'
                  : 'border-white/10 text-neutral-200 hover:bg-white/[.09]'
              }`}
            >
              {pageNum}
            </button>
          )
        )}

        <button
          type="button"
          onClick={onNextPage}
          disabled={!hasNextPage}
          className="inline-flex items-center rounded-lg border border-white/10 bg-white/[.04] p-2 text-neutral-200 hover:bg-white/[.09] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
