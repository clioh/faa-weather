/**
 * Quote of the day — one quote per local day, the same on every reload and
 * on every mirror showing the same theme.
 */

import { ModuleProps } from './index';
import { ModuleFrame } from './ModuleFrame';
import { dayKey, daysBetween, useNow } from './time';
import quotes from './quotes.json';
import './QuotesModule.css';

interface Quote {
  text: string;
  author: string;
}

type Category = keyof typeof quotes;

/** Longest quote that sits comfortably in each size. */
const MAX_LENGTH: Record<string, number> = { medium: 120, wide: 160, full: 280 };

/** Stable per-category offset so two themes don't step in lockstep. */
function seed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function QuotesModule({ config, size }: ModuleProps) {
  const category: Category =
    typeof config.category === 'string' && config.category in quotes
      ? (config.category as Category)
      : 'aviation';

  // Minute ticks are enough to roll over at local midnight.
  const now = useNow(60_000);
  const dayNumber = daysBetween('1970-01-01', dayKey(now));

  const all: Quote[] = quotes[category];
  const limit = MAX_LENGTH[size] ?? 160;
  const fitting = all.filter((q) => q.text.length <= limit);
  const pool = fitting.length ? fitting : all;
  const quote = pool[(dayNumber + seed(category)) % pool.length];
  const long = quote.text.length > 100;

  return (
    <ModuleFrame className={`quote quote-${size}`}>
      <figure className="quote-figure">
        <blockquote className={`quote-text${long ? ' long' : ''}`}>{quote.text}</blockquote>
        <figcaption className="quote-author">— {quote.author}</figcaption>
      </figure>
    </ModuleFrame>
  );
}
