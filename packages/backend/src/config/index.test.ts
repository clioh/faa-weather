import { describe, it, expect } from 'vitest';
import { normalizeOrientation, parseConfig } from './index.js';

const DEFAULTS = `
airport: KJFK
display:
  presence_timeout: 120
  orientation: landscape
`;

describe('display.orientation', () => {
  it('passes the three orientations through', () => {
    expect(normalizeOrientation('landscape')).toBe('landscape');
    expect(normalizeOrientation('portrait-cw')).toBe('portrait-cw');
    expect(normalizeOrientation('portrait-ccw')).toBe('portrait-ccw');
  });

  it('reads the legacy value portrait as portrait-cw', () => {
    expect(normalizeOrientation('portrait')).toBe('portrait-cw');
    expect(normalizeOrientation(' Portrait ')).toBe('portrait-cw');
  });

  it('falls back to landscape for missing or unknown values', () => {
    for (const v of [undefined, null, '', 'upside-down', 90, {}]) {
      expect(normalizeOrientation(v), String(v)).toBe('landscape');
    }
  });

  it('defaults to landscape without a config.yaml', () => {
    expect(parseConfig(DEFAULTS, null).display.orientation).toBe('landscape');
  });

  it('normalizes the value merged from config.yaml', () => {
    const legacy = parseConfig(DEFAULTS, 'display:\n  orientation: portrait\n');
    expect(legacy.display).toMatchObject({ orientation: 'portrait-cw', presence_timeout: 120 });
    expect(parseConfig(DEFAULTS, 'display:\n  orientation: portrait-ccw\n').display.orientation).toBe(
      'portrait-ccw'
    );
  });

  it('keeps landscape for a config.yaml with no display block, or an empty one', () => {
    expect(parseConfig(DEFAULTS, 'airport: KSFO\n').display.orientation).toBe('landscape');
    expect(parseConfig(DEFAULTS, '').airport).toBe('KJFK');
  });
});
