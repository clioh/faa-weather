import type { ReactNode } from 'react';

export interface StepListItem {
  key: string;
  label: ReactNode;
  /** done = ✓ in accent, now = white, todo = dim. Omit for a plain numbered list. */
  state?: 'done' | 'now' | 'todo';
  /** Right-aligned mono note (e.g. "Landscape" on a done step). */
  note?: ReactNode;
}

/**
 * Hairline step list (mockups M-Pair, M-License): numbered 01, 02 …, a tick
 * for done steps. `long` sets multi-line items (sentences) in body size.
 */
export function StepList({ items, long = false }: { items: StepListItem[]; long?: boolean }) {
  return (
    <ol className={`sg-steps${long ? ' sg-steps--long' : ''}`}>
      {items.map((item, index) => (
        <li key={item.key} className={`sg-step${item.state ? ` is-${item.state}` : ''}`}>
          <span className="sg-step__n">{item.state === 'done' ? '✓' : String(index + 1).padStart(2, '0')}</span>
          <span className="sg-step__label">{item.label}</span>
          {item.note != null && <span className="sg-step__note">{item.note}</span>}
        </li>
      ))}
    </ol>
  );
}
