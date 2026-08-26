export function IncidentListSkeleton() {
  return (
    <div className="space-y-1 px-2 py-2" role="status" aria-label="Loading incidents">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-white/[.07] bg-white/[.02] p-3"
        >
          <div className="flex justify-between gap-2">
            <div className="h-4 w-16 rounded-full bg-white/10" />
            <div className="h-3 w-20 rounded bg-white/10" />
          </div>
          <div className="mt-2 h-4 w-3/4 rounded bg-white/10" />
          <div className="mt-1 h-3 w-1/2 rounded bg-white/10" />
        </div>
      ))}
      <span className="sr-only">Loading incidents...</span>
    </div>
  )
}

export function IncidentDetailSkeleton() {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading incident details">
      <section className="overflow-hidden rounded-2xl border border-white/[.1] bg-[#090a0f]">
        <div className="border-b border-white/[.08] px-5 py-5 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex gap-2">
                <div className="h-6 w-24 rounded-full bg-white/10" />
                <div className="h-6 w-20 rounded-full bg-white/10" />
              </div>
              <div className="mt-4 h-7 w-3/4 rounded bg-white/10" />
              <div className="mt-2 h-4 w-1/2 rounded bg-white/10" />
            </div>
            <div className="h-20 w-32 rounded-xl bg-white/10" />
          </div>
        </div>
        <div className="border-t border-white/[.08] px-5 py-4 sm:px-7">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="rounded-xl border border-white/[.07] bg-black/15 p-3">
                <div className="h-3 w-20 rounded bg-white/10" />
                <div className="mt-2 h-4 w-16 rounded bg-white/10" />
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="h-64 rounded-2xl border border-white/[.08] bg-white/[.015]" />
        <div className="h-64 rounded-2xl border border-white/[.08] bg-white/[.015]" />
      </div>
      <span className="sr-only">Loading incident details...</span>
    </div>
  )
}

export function MetricsCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-white/[.08] bg-[#090a0f]/90 p-4">
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 rounded bg-white/10" />
        <div className="h-4 w-4 rounded-full bg-white/10" />
      </div>
      <div className="mt-2 h-8 w-32 rounded bg-white/10" />
      <div className="mt-1 h-3 w-40 rounded bg-white/10" />
    </div>
  )
}

export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="animate-pulse rounded-xl border border-white/[.07] bg-black/15 p-3">
      <div className="flex items-center justify-between gap-3">
        {[...Array(columns)].map((_, i) => (
          <div key={i} className="h-4 flex-1 rounded bg-white/10" />
        ))}
      </div>
    </div>
  )
}
