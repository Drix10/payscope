import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('PayScope Error Boundary caught an error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-[#040406] px-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-400/25 bg-rose-400/[.07] p-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-rose-400/30 bg-rose-400/10">
              <AlertTriangle className="h-8 w-8 text-rose-300" />
            </div>
            <h1 className="text-xl font-bold text-white">Something went wrong</h1>
            <p className="mt-2 text-sm text-neutral-400">
              The PayScope dashboard encountered an unexpected error. This has been logged for investigation.
            </p>
            {this.state.error && (
              <details className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-left">
                <summary className="cursor-pointer text-xs font-semibold text-neutral-300">
                  Error Details
                </summary>
                <pre className="mt-2 overflow-x-auto text-[10px] text-neutral-500">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            <button
              type="button"
              onClick={this.handleReset}
              className="mt-6 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.04] px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[.09]"
            >
              <RefreshCw className="h-4 w-4" />
              Reload Dashboard
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
