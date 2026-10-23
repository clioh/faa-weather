import { Helmet } from 'react-helmet-async'
import { useLocation } from 'react-router-dom'

interface SEOProps {
  title?: string
  description?: string
  /** Path of the canonical URL, e.g. "/privacy". Defaults to the current path. */
  canonical?: string
  type?: 'website' | 'article'
  image?: string
  /** Keep this page out of search results (e.g. pages reached from emailed links). */
  noindex?: boolean
}

const defaultMeta = {
  title: 'SkyGlass | Smart Mirror for Pilots',
  description:
    'A smart mirror that displays live METAR, TFRs, and your flight schedule. Looks like a regular mirror until you walk up. Built by a pilot, for pilots.',
  siteUrl: 'https://skyglass.dev',
  image: 'https://skyglass.dev/og-image.png',
  twitterHandle: '@skyglassdev',
}

export function SEO({
  title,
  description = defaultMeta.description,
  canonical,
  type = 'website',
  image = defaultMeta.image,
  noindex = false,
}: SEOProps) {
  const pageTitle = title ? `${title} | SkyGlass` : defaultMeta.title

  // The page's own URL (no query or hash: tokens and invite codes live there).
  const { pathname } = useLocation()
  const url = `${defaultMeta.siteUrl}${canonical ?? pathname}`

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{pageTitle}</title>
      <meta name="title" content={pageTitle} />
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta name="robots" content={noindex ? 'noindex, nofollow' : 'index, follow'} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={url} />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Helmet>
  )
}
