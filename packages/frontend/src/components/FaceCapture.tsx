import type { ReactNode } from 'react';
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
  /** Optional extra line under the body. */
  hint?: ReactNode;
  /** MJPEG stream of the presence camera; the feed panel stays empty without it. */
  videoStreamUrl?: string | null;
  /** Big number over the feed while a capture counts down. */
  countdown?: number | null;
  /** Briefly brighten the face outline (a photo was just taken). */
  pulse?: boolean;
  /** Drawn over the whole screen (capture flash). */
  overlay?: ReactNode;
}

/**
 * Face registration layout (mockups M-Face-L/P), shared by the setup screen
 * and the registration overlay: camera feed with a dashed face outline,
 * instruction beside it (landscape) or below it (portrait), photo dots top
 * right.
 */
export function FaceCapture({
  instruction,
  userName,
  samplesCollected,
  samplesNeeded,
  body,
  hint,
  videoStreamUrl,
  countdown,
  pulse = false,
  overlay,
}: FaceCaptureProps) {
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
          {videoStreamUrl && (
            <img
              key={videoStreamUrl}
              src={videoStreamUrl}
              alt="Camera feed"
              className="face-capture__video"
              referrerPolicy="no-referrer"
            />
          )}
          <div className={`sg-oval face-capture__oval${pulse ? ' is-pulse' : ''}`} />
          {countdown != null && countdown > 0 && (
            <div className="face-capture__countdown">
              <span key={countdown}>{countdown}</span>
            </div>
          )}
        </div>
        <div className="sg-col face-capture__text">
          {userName && <div className="face-capture__name">Setting up for {userName}</div>}
          <h1 className="sg-headline face-capture__headline">{instruction}</h1>
          <div className="sg-mono sg-faint face-capture__count">
            {samplesCollected} of {samplesNeeded} photos
          </div>
          <p className="sg-body face-capture__body">{body}</p>
          {hint && <p className="sg-body sg-faint">{hint}</p>}
        </div>
      </div>
    </SetupFrame>
  );
}
