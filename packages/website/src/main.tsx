import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import { ErrorBoundary, ErrorFallback } from './components'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary
      fallback={
        <div className="min-h-screen bg-bg flex items-center justify-center">
          <ErrorFallback
            error={null}
            title="Application Error"
            description="The application encountered an unexpected error. Please refresh the page."
            onRetry={() => window.location.reload()}
          />
        </div>
      }
    >
      <HelmetProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </HelmetProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
