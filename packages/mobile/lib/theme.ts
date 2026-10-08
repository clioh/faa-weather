/**
 * SkyGlass App Theme
 * Dark theme optimized for the app experience
 */

export const colors = {
  // Backgrounds
  background: '#000000',
  surface: '#0a0f1a',
  surfaceElevated: '#111827',
  surfaceHighlight: '#1a2235',

  // Primary colors
  primary: '#00ff88',
  primaryDark: '#00cc6a',
  primaryLight: '#33ff9f',
  primaryMuted: 'rgba(0, 255, 136, 0.15)',

  // Accent colors
  accent: '#0066ff',
  accentDark: '#0044cc',
  accentLight: '#3388ff',
  accentMuted: 'rgba(0, 102, 255, 0.15)',

  // Text colors
  text: '#ffffff',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  textMuted: 'rgba(255, 255, 255, 0.5)',
  textDisabled: 'rgba(255, 255, 255, 0.3)',

  // Status colors
  success: '#00ff88',
  warning: '#ffaa00',
  error: '#ff4444',
  info: '#0088ff',

  // Flight rules
  vfr: '#00ff88',
  mvfr: '#0088ff',
  ifr: '#ff4444',
  lifr: '#ff00ff',

  // Borders
  border: 'rgba(255, 255, 255, 0.1)',
  borderFocus: 'rgba(0, 255, 136, 0.5)',

  // Overlays
  overlay: 'rgba(0, 0, 0, 0.7)',
  modalBackground: 'rgba(0, 0, 0, 0.9)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const typography = {
  hero: {
    fontSize: 48,
    fontWeight: '700' as const,
    letterSpacing: -1,
  },
  h1: {
    fontSize: 32,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 24,
    fontWeight: '600' as const,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
};

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
};
