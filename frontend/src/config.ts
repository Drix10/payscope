const numericEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 120_000 ? parsed : fallback
}

export const APP_CONFIG = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  apiTimeoutMs: numericEnv(import.meta.env.VITE_API_TIMEOUT_MS, 20_000),
  apiKey: import.meta.env.VITE_PAYSCOPE_DASHBOARD_API_KEY ?? '',
} as const

export const apiUrl = (path: string) => `${APP_CONFIG.apiBaseUrl.replace(/\/$/, '')}${path}`
