import { useState, useMemo } from 'react'

export interface PaginationConfig {
  page: number
  pageSize: number
  totalItems: number
}

export function usePagination<T>(items: T[], initialPageSize = 20) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)

  const totalPages = Math.ceil(items.length / pageSize)
  const startIndex = (page - 1) * pageSize
  const endIndex = startIndex + pageSize

  const paginatedItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex]
  )

  const goToPage = (newPage: number) => {
    setPage(Math.max(1, Math.min(newPage, totalPages)))
  }

  const nextPage = () => {
    if (page < totalPages) setPage(page + 1)
  }

  const prevPage = () => {
    if (page > 1) setPage(page - 1)
  }

  const changePageSize = (newSize: number) => {
    setPageSize(newSize)
    setPage(1) // Reset to first page when changing page size
  }

  const reset = () => {
    setPage(1)
  }

  return {
    page,
    pageSize,
    totalPages,
    totalItems: items.length,
    paginatedItems,
    startIndex: startIndex + 1, // 1-indexed for display
    endIndex: Math.min(endIndex, items.length),
    goToPage,
    nextPage,
    prevPage,
    changePageSize,
    reset,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  }
}
