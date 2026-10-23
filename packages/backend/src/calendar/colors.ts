export const CALENDAR_PALETTE = [
  '#7ad7ff',
  '#ffb86b',
  '#c3a6ff',
  '#7ee0a1',
  '#ff8fa3',
  '#f5d76e',
  '#8fb3ff',
  '#5fd4c4',
] as const;

/** Normalize #rgb / #rrggbb / #rrggbbaa (any case) to '#rrggbb', or null. */
export function normalizeColor(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{3})$/);
  if (m) {
    const [r, g, b] = m[1];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  m = s.match(/^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  return m ? `#${m[1]}` : null;
}

/** Palette color for the n-th calendar without a provider color. */
export function paletteColor(n: number): string {
  return CALENDAR_PALETTE[
    ((n % CALENDAR_PALETTE.length) + CALENDAR_PALETTE.length) % CALENDAR_PALETTE.length
  ];
}
