const numericEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 120_000 ? parsed : fallback
}

export const APP_CONFIG = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  apiTimeoutMs: numericEnv(import.meta.env.VITE_API_TIMEOUT_MS, 20_000),
  apiKey: (import.meta.env as unknown as Record<string, string>).VITE_PAYSCOPE_API_KEY ?? import.meta.env.VITE_PAYSCOPE_DASHBOARD_API_KEY ?? 'pscope_dash_ff75d8b1d7204643beb77739bab986f8ee10d79',
} as const

export const apiUrl = (path: string) => {
  const customUrl = APP_CONFIG.apiBaseUrl?.trim()
  if (customUrl) return `${customUrl.replace(/\/$/, '')}${path}`
  if (typeof window !== 'undefined' && window.location.port === '5173') {
    return `http://localhost:25655${path}`
  }
  return path
}
