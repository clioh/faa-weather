/**
 * SkyGlass App Theme — "Glass Cockpit"
 *
 * Shared language with the mirror UI (packages/frontend/src/styles/theme.css).
 * Spec: docs/design/DESIGN_SYSTEM.md · mockups: docs/design/mockups/
 *
 * - Black ground, light ink, hairline rows instead of filled cards.
 * - Sky blue (#7AD7FF) is the only accent: primary actions, links, active
 *   and success states.
 * - Green is reserved for VFR. Never use it for buttons or success.
 *
 * Legacy keys are kept so existing screens compile; their values now point
 * at the new palette.
 */

export const colors = {
  // Backgrounds
  background: '#000000',
  surface: '#0B0D10', // page sheets
  surfaceElevated: '#101317', // bottom sheets, opaque cards
  surfaceHighlight: '#1A1F26', // toast, pressed rows
  surfaceTint: 'rgba(255, 255, 255, 0.04)', // grouped content, notices

  // Accent (single). `primary` and `accent` are the same colour.
  primary: '#7AD7FF',
  primaryDark: '#4FC3F2',
  primaryLight: '#B3E8FF',
  primaryMuted: 'rgba(122, 215, 255, 0.12)',
  onPrimary: '#00141F', // text/icons on the accent fill

  /** @deprecated single-accent system: use `primary` */
  accent: '#7AD7FF',
  /** @deprecated */
  accentDark: '#4FC3F2',
  /** @deprecated */
  accentLight: '#B3E8FF',
  /** @deprecated */
  accentMuted: 'rgba(122, 215, 255, 0.12)',

  // Text
  text: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.68)',
  textMuted: 'rgba(255, 255, 255, 0.58)', // floor for 4.5:1 on black
  textDisabled: 'rgba(255, 255, 255, 0.40)',

  // Status (success is the accent; green belongs to VFR)
  success: '#7AD7FF',
  warning: '#FFB74D',
  warningMuted: 'rgba(255, 183, 77, 0.08)',
  error: '#FF6B7A',
  errorMuted: 'rgba(255, 107, 122, 0.08)',
  danger: '#FF6B7A',
  info: '#7AD7FF',
  infoMuted: 'rgba(122, 215, 255, 0.08)',

  // Flight rules: same values as the mirror
  vfr: '#00E676',
  mvfr: '#2979FF',
  ifr: '#FF1744',
  lifr: '#D500F9',

  // Borders
  border: 'rgba(255, 255, 255, 0.14)', // hairline row dividers
  hairline: 'rgba(255, 255, 255, 0.14)',
  borderStrong: 'rgba(255, 255, 255, 0.22)', // inputs, outline buttons
  borderFocus: '#7AD7FF',

  // Overlays
  overlay: 'rgba(0, 0, 0, 0.66)',
  modalBackground: 'rgba(0, 0, 0, 0.9)',
};

export const fonts = {
  // Loaded in app/_layout.tsx (see IMPLEMENTATION_PLAN phase 1). Until then
  // React Native falls back to the system font.
  ui: 'Inter_400Regular',
  uiLight: 'Inter_300Light',
  uiExtraLight: 'Inter_200ExtraLight',
  uiMedium: 'Inter_500Medium',
  uiSemiBold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24, // screen gutter
  xl: 32,
  xxl: 48,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16, // cards
  xl: 22, // bottom sheets
  input: 14,
  button: 26, // 52pt pill
  full: 9999,
};

export const sizes = {
  touch: 44,
  row: 52,
  button: 52,
  buttonSmall: 40,
  input: 52,
  chip: 34,
};

export const typography = {
  hero: {
    fontSize: 48,
    fontWeight: '200' as const,
    letterSpacing: -1,
  },
  h1: {
    fontSize: 30,
    fontWeight: '300' as const,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 24,
    fontWeight: '300' as const,
    letterSpacing: -0.3,
  },
  h3: {
    fontSize: 20,
    fontWeight: '400' as const,
  },
  header: {
    fontSize: 16,
    fontWeight: '500' as const,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 22,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 17,
  },
  label: {
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const,
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: 14,
  },
};
