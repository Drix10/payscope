interface ImportMetaEnv {
  readonly PROD: boolean
  readonly VITE_API_BASE_URL?: string
  readonly VITE_API_TIMEOUT_MS?: string
  readonly VITE_PAYSCOPE_DASHBOARD_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
