import { Link } from 'react-router-dom'

interface LogoProps {
  /** Where the logo links: a route (default "/") or an in-page hash such as "#top". */
  to?: string
  className?: string
}

/** Horizontal lockup (docs/design/brand/logo-lockup-horizontal.svg, served from public/). */
export function Logo({ to = '/', className = '' }: LogoProps) {
  const img = (
    <img
      src="/logo-lockup.svg"
      alt="SkyGlass"
      width={126}
      height={20}
      className="block h-5 w-auto"
    />
  )
  const classes = `inline-flex items-center min-h-11 ${className}`
  return to.startsWith('#') ? (
    <a href={to} className={classes} aria-label="SkyGlass, back to top">
      {img}
    </a>
  ) : (
    <Link to={to} className={classes} aria-label="SkyGlass home">
      {img}
    </Link>
  )
}
