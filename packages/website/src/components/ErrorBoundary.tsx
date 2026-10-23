import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      )
    }

    return this.props.children
  }
}

interface ErrorFallbackProps {
  error: Error | null
  onRetry?: () => void
  title?: string
  description?: string
}

export function ErrorFallback({
  error,
  onRetry,
  title = 'Something went wrong',
  description = 'We encountered an unexpected error. Please try again.',
}: ErrorFallbackProps) {
  return (
    <div role="alert" className="flex min-h-[400px] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <p className="eyebrow">Error</p>
        <h2 className="mt-3 text-2xl font-light tracking-tight text-fg">{title}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{description}</p>

        {/* Error details (only in development) */}
        {import.meta.env.DEV && error && (
          <details className="notice notice-error mt-6">
            <summary className="cursor-pointer">Error details</summary>
            <pre className="mt-3 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap break-words">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn btn-primary">
              Try Again
            </button>
          )}
          <a href="/" className="btn btn-secondary">
            Back to home
          </a>
        </div>
      </div>
    </div>
  )
}
