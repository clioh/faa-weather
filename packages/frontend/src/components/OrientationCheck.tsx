import { orientationLabel, type MirrorOrientation } from '../orientation';
import './OrientationCheck.css';

/**
 * "This way up?" (mockups M-Orient-L/P): shown over every screen while the
 * app's Orientation step previews a value. The outline traces the edge of
 * the screen so the user can see the whole UI is on the glass.
 */
export function OrientationCheck({ orientation }: { orientation: MirrorOrientation }) {
  return (
    <div className="orientation-check" role="status" aria-live="polite">
      <div className="orientation-check__top">
        <span className="orientation-check__kicker">Orientation</span>
        <span className="orientation-check__mode">{orientationLabel(orientation)}</span>
      </div>
      <div className="orientation-check__center">
        <svg className="orientation-check__arrow" viewBox="0 0 24 32" aria-hidden="true">
          <path d="M12 30V3M3 12l9-9 9 9" />
        </svg>
        <h1 className="orientation-check__title">This way up?</h1>
        <p className="orientation-check__body">
          If the arrow points to the ceiling and the outline traces the edge of the glass, confirm
          in the SkyGlass app.
        </p>
      </div>
      <div className="orientation-check__foot">Confirm on your phone</div>
    </div>
  );
}
