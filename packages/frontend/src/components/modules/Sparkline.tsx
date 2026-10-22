/**
 * Sparkline — a tiny trend line. No axes, no labels: the shape is the point.
 * Strokes with currentColor, so colour it from the parent (text-positive …).
 */

import { useId } from 'react';
import './Sparkline.css';

interface SparklineProps {
  values: number[];
  /** Fade the area under the line to transparent. */
  area?: boolean;
  className?: string;
}

const W = 100;
const H = 32;
// Keeps the stroke from being clipped at the extremes.
const INSET = 2;

export function Sparkline({ values, area = false, className }: SparklineProps) {
  const gradientId = useId();
  const points = values.filter((v) => Number.isFinite(v));
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = W / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = i * step;
    // A flat series sits in the middle rather than on the floor.
    const y = max === min ? H / 2 : INSET + (1 - (v - min) / span) * (H - INSET * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M${coords.join(' L')}`;

  return (
    <svg
      className={['sparkline', className ?? ''].join(' ').trim()}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {area && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${gradientId})`} stroke="none" />
        </>
      )}
      <path className="sparkline-line" d={line} />
    </svg>
  );
}
