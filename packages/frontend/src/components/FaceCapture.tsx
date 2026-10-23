import { useState, type CSSProperties, type ReactNode } from 'react';
import { SetupFrame } from './setup/SetupFrame';
import './FaceCapture.css';

interface FaceCaptureProps {
  /** Instruction for the current photo; the headline. */
  instruction: string;
  /** Name being enrolled ("Setting up for {name}"), when known. */
  userName?: string | null;
  samplesCollected: number;
  samplesNeeded: number;
  /** Body line under the photo count. */
  body: ReactNode;
  /** Live guidance under the headline ("Move a little closer"); none when null. */
  hint?: string | null;
  /** Accent hint: the person is in position (holding still). */
  hintActive?: boolean;
  /** MJPEG stream of the presence camera; the feed panel stays empty without it. */
  videoStreamUrl?: string | null;
  /** Big number over the feed while a capture counts down. */
  countdown?: number | null;
  /** Briefly brighten the face outline (a photo was just taken). */
  pulse?: boolean;
  /**
   * Steadiness timer running: the outline turns solid and a ring around it
   * fills over `ms`. A new `key` restarts the ring.
   */
  hold?: { key: number; ms: number } | null;
  /** Drawn over the whole screen (capture flash). */
  overlay?: ReactNode;
}

/**
 * Face registration layout (mockups M-Face-L/P), shared by the setup screen
 * and the registration overlay: camera feed with a dashed face outline,
 * instruction and live guidance beside it (landscape) or below it
 * (portrait), photo dots top right. The feed is flipped so it reads as a
 * mirror.
 */
/** The MJPEG feed; hidden if it fails to load, so no broken-image glyph shows on the glass. */
function CameraFeed({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt="Camera feed"
      className="face-capture__video"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function FaceCapture({
  instruction,
  userName,
  samplesCollected,
  samplesNeeded,
  body,
  hint,
  hintActive = false,
  videoStreamUrl,
  countdown,
  pulse = false,
  hold,
  overlay,
}: FaceCaptureProps) {
  const counting = countdown != null && countdown > 0;
  // The manual countdown takes over the feed; no ring meanwhile.
  const ring = counting ? null : (hold ?? null);
  return (
    <SetupFrame
      className="face-capture"
      topLeft={<span className="sg-kicker">Face registration</span>}
      topRight={
        <span className="sg-dots" aria-label={`${samplesCollected} of ${samplesNeeded} photos`}>
          {Array.from({ length: samplesNeeded }, (_, i) => (
            <i
              key={i}
              className={i < samplesCollected ? 'is-done' : i === samplesCollected ? 'is-now' : undefined}
            />
          ))}
        </span>
      }
      footLeft="Face data stays on this mirror"
    >
      {overlay}
      <div className="sg-main sg-main--top face-capture__main">
        <div className="sg-feed face-capture__feed">
          {videoStreamUrl && <CameraFeed key={videoStreamUrl} src={videoStreamUrl} />}
          <div
            className={`sg-oval face-capture__oval${ring ? ' is-hold' : ''}${pulse ? ' is-pulse' : ''}`}
          >
            {ring && (
              <svg
                key={ring.key}
                className="face-capture__ring"
                viewBox="0 0 76 100"
                preserveAspectRatio="none"
                aria-hidden="true"
                style={{ '--hold-ms': `${ring.ms}ms` } as CSSProperties}
              >
                {/* Clockwise from the top. The box is close to the ring's
                    aspect in both orientations, so the stroke stays even. */}
                <path d="M38 1 A37 49 0 1 1 38 99 A37 49 0 1 1 38 1" pathLength={100} />
              </svg>
            )}
          </div>
          {counting && (
            <div className="face-capture__countdown">
              <span key={countdown}>{countdown}</span>
            </div>
          )}
        </div>
        <div className="sg-col face-capture__text">
          {userName && <div className="face-capture__name">Setting up for {userName}</div>}
          <h1 className="sg-headline face-capture__headline">{instruction}</h1>
          {/* Always rendered, so the lines below don't jump as the hint comes and goes. */}
          <p className={`face-capture__hint${hintActive ? ' is-active' : ''}`} aria-live="polite">
            {hint}
          </p>
          <div className="sg-mono sg-faint face-capture__count">
            {samplesCollected} of {samplesNeeded} photos
          </div>
          <p className="sg-body face-capture__body">{body}</p>
        </div>
      </div>
    </SetupFrame>
  );
}
