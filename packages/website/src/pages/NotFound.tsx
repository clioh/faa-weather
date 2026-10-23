import { Link } from 'react-router-dom'
import { PageHeader, SEO, SiteFooter } from '../components'

export function NotFound() {
  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <SEO
        title="404 - Page Not Found"
        description="The page you're looking for doesn't exist or has been moved."
        noindex
      />

      <PageHeader />

      <main className="page-container flex-1 flex flex-col justify-center py-20">
        <p className="eyebrow">Signal Lost</p>
        <div className="display-1 mt-4 font-extralight text-fg select-none" aria-hidden="true">
          404
        </div>
        <h1 className="mt-6 text-xl font-light text-fg">Off Course</h1>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-fg-2">
          The page you're looking for doesn't exist or has been moved. Let's get you back on track.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link to="/" className="btn btn-primary">
            Return Home
          </Link>
          <button type="button" onClick={() => window.history.back()} className="btn btn-secondary">
            Go Back
          </button>
        </div>

        <p className="mt-10 font-mono text-xs text-fg-3">
          Position: N/A | Altitude: N/A | Heading: ???
        </p>
      </main>

      <SiteFooter />
    </div>
  )
}
