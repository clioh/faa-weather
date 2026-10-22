/**
 * ModuleFrame — the shared chrome every widget renders inside.
 *
 * Gives widgets a consistent header (uppercase label, optional mono accent
 * such as an ICAO code, optional right-hand meta), a body that fills the
 * tile, and uniform loading / empty / error states. Styles live in
 * styles/modules.css and scale with the tile via container-query units.
 *
 * Usage:
 *   <ModuleFrame title="METAR" accent={icao} meta={<Age at={lastUpdated} />}>
 *     ...
 *   </ModuleFrame>
 */

import { ReactNode } from 'react';

interface ModuleFrameProps {
  /** Small-caps label. Omit for widgets that are their own label (clock). */
  title?: string;
  /** Mono text after the title, e.g. an ICAO code or ticker. */
  accent?: string;
  /** Right-hand side of the header: data age, a pill, a count. */
  meta?: ReactNode;
  /** Remove the tile padding for edge-to-edge content (maps, photos). */
  flush?: boolean;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function ModuleFrame({
  title,
  accent,
  meta,
  flush,
  className,
  children,
  footer,
}: ModuleFrameProps) {
  const showHeader = Boolean(title || accent || meta);
  return (
    <div className={['mf', flush ? 'mf-flush' : '', className ?? ''].join(' ').trim()}>
      {showHeader && (
        <div className="mf-header">
          <span className="mf-title">
            {title}
            {accent && (
              <>
                {title ? ' ' : ''}
                <span className="mf-title-accent">{accent}</span>
              </>
            )}
          </span>
          {meta && <span className="mf-meta-slot">{meta}</span>}
        </div>
      )}
      <div className="mf-body">{children}</div>
      {footer && <div className="mf-footer">{footer}</div>}
    </div>
  );
}

/** Three breathing bars; use while the first load is in flight. */
export function ModuleLoading() {
  return (
    <div className="mf-skeleton" aria-busy="true" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

interface StateProps {
  title: string;
  hint?: string;
}

/** Nothing to show (no events, no NOTAMs). Calm, not an error. */
export function ModuleEmpty({ title, hint }: StateProps) {
  return (
    <div className="mf-state">
      <span className="mf-state-title">{title}</span>
      {hint && <span className="mf-state-hint">{hint}</span>}
    </div>
  );
}

/** Data could not be loaded and there is nothing stale to keep showing. */
export function ModuleError({ title, hint }: StateProps) {
  return (
    <div className="mf-state error">
      <span className="mf-state-title">{title}</span>
      {hint && <span className="mf-state-hint">{hint}</span>}
    </div>
  );
}

interface MetricProps {
  label: string;
  value: ReactNode;
  unit?: string;
  className?: string;
}

/** Label-over-value stat. Compose several inside <div className="mf-metrics">. */
export function Metric({ label, value, unit, className }: MetricProps) {
  return (
    <div className={['mf-metric', className ?? ''].join(' ').trim()}>
      <span className="mf-metric-label">{label}</span>
      <span className="mf-metric-value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </span>
    </div>
  );
}

/** "3m" / "2h" style age for the header meta slot; turns amber when stale. */
export function Age({ at, stale }: { at: number | null; stale?: boolean }) {
  if (!at) return null;
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  const label =
    minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
  return <span className={`mf-meta${stale ? ' stale' : ''}`}>{label}</span>;
}

/** Flight-rules pill. */
export function FlightRulesPill({ rules }: { rules: string | null | undefined }) {
  if (!rules) return null;
  const key = rules.toLowerCase();
  return <span className={`mf-pill ${key}`}>{rules}</span>;
}

/** Map a flight-rules string to the text-colour helper class. */
export function flightRulesClass(rules: string | null | undefined): string {
  switch ((rules || '').toUpperCase()) {
    case 'VFR':
      return 'text-vfr';
    case 'MVFR':
      return 'text-mvfr';
    case 'IFR':
      return 'text-ifr';
    case 'LIFR':
      return 'text-lifr';
    default:
      return 'text-dim';
  }
}
