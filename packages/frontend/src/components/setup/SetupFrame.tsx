import type { ReactNode } from 'react';
import { LogoMark } from './LogoMark';
import './SetupLayout.css';

interface SetupFrameProps {
  /** Top left. Defaults to the SkyGlass brand (logo mark + wordmark). */
  topLeft?: ReactNode;
  /** Top right, small mono text (mirror name, connection state, photo dots). */
  topRight?: ReactNode;
  /** Bottom left / right, small mono text. */
  footLeft?: ReactNode;
  footRight?: ReactNode;
  className?: string;
  role?: string;
  children: ReactNode;
}

/**
 * Shared shell of the mirror's setup screens (docs/design/mockups/mirror.css):
 * brand row, content, foot row. Children are usually a .sg-main (two
 * columns in landscape, stacked in portrait) or a .sg-center.
 */
export function SetupFrame({
  topLeft,
  topRight,
  footLeft,
  footRight,
  className,
  role,
  children,
}: SetupFrameProps) {
  return (
    <div className={`sg-screen${className ? ` ${className}` : ''}`} role={role}>
      <div className="sg-top">
        {topLeft === undefined ? <SetupBrand /> : <div>{topLeft}</div>}
        <div className="sg-meta">{topRight}</div>
      </div>
      {children}
      <div className="sg-foot">
        <span>{footLeft}</span>
        <span>{footRight}</span>
      </div>
    </div>
  );
}

function SetupBrand() {
  return (
    <div className="sg-brand">
      <LogoMark className="sg-brand__mark" />
      SKYGLASS
    </div>
  );
}
