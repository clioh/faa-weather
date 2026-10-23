import { Link } from 'react-router-dom'

const links = [
  { to: '/license', label: 'License' },
  { to: '/team', label: 'Team' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
]

/** Footer for every page: the briefing disclaimer, contact and policy links. */
export function SiteFooter() {
  return (
    <footer className="site-container">
      <div className="flex flex-wrap items-center justify-between gap-5 border-t border-line pt-7 pb-10 text-[13px] text-fg-3">
        <div>
          SkyGlass · For awareness only, not a substitute for an official briefing. ·{' '}
          <a href="mailto:hello@skyglass.dev" className="text-fg-2 hover:text-fg transition-colors">
            hello@skyglass.dev
          </a>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-[22px] gap-y-2">
          {links.map((link) => (
            <Link key={link.to} to={link.to} className="text-fg-2 hover:text-fg transition-colors">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
