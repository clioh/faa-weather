import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from './Logo'

interface PageHeaderProps {
  /** Right-hand slot. Defaults to a "Back to home" link. */
  right?: ReactNode
}

/** Header for pages other than Home: logo on the left, one quiet link on the right. */
export function PageHeader({ right }: PageHeaderProps) {
  return (
    <header className="site-container flex items-center justify-between gap-4 py-6">
      <Logo />
      {right ?? (
        <Link
          to="/"
          className="text-sm text-fg-2 hover:text-fg transition-colors min-h-11 inline-flex items-center"
        >
          Back to home
        </Link>
      )}
    </header>
  )
}
