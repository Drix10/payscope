interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_API_TIMEOUT_MS?: string
  readonly VITE_API_ACCESS_TOKEN?: string
  readonly VITE_RAZORPAY_KEY_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
