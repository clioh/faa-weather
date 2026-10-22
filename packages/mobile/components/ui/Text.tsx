/**
 * Text and TextInput with the app fonts.
 *
 * Inter and JetBrains Mono are loaded one family per weight (Inter_500Medium,
 * …), so `fontWeight` on its own does nothing useful. These wrappers turn the
 * style's weight into the matching family: Inter by default, JetBrains Mono
 * when the style (or a parent Text) uses `fonts.mono`. Any other explicit
 * fontFamily is left alone.
 *
 * Import these instead of the react-native ones in screens and components.
 */

import { createContext, useContext, type ComponentPropsWithRef } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { fonts } from '@/lib/theme';

type Kind = 'ui' | 'mono';

const INTER: Record<string, string> = {
  '100': fonts.uiExtraLight,
  '200': fonts.uiExtraLight,
  '300': fonts.uiLight,
  '400': fonts.ui,
  normal: fonts.ui,
  '500': fonts.uiMedium,
  '600': fonts.uiSemiBold,
  '700': fonts.uiSemiBold,
  '800': fonts.uiSemiBold,
  '900': fonts.uiSemiBold,
  bold: fonts.uiSemiBold,
};

function monoFamily(weight: string): string {
  return weight === 'bold' || Number(weight) >= 500 ? fonts.monoMedium : fonts.mono;
}

function kindOf(family: string | undefined): Kind | null {
  if (!family) return null;
  if (family.startsWith('JetBrainsMono')) return 'mono';
  if (family.startsWith('Inter')) return 'ui';
  return null;
}

// What a nested Text inherits when its own style names no family.
const FontKind = createContext<Kind>('ui');

function useFontStyle(style: StyleProp<TextStyle>) {
  const inherited = useContext(FontKind);
  const flat = StyleSheet.flatten(style) ?? {};
  const family = flat.fontFamily;
  const ownKind = kindOf(family);

  // A family we don't manage (e.g. icon fonts): pass through untouched.
  if (family && !ownKind) return { kind: inherited, style };
  // An exact family with no weight: keep it.
  if (family && flat.fontWeight == null) return { kind: ownKind!, style };

  const kind = ownKind ?? inherited;
  const weight = String(flat.fontWeight ?? '400');
  const fontFamily = kind === 'mono' ? monoFamily(weight) : (INTER[weight] ?? fonts.ui);
  // Clear the weight so iOS doesn't try to synthesise bold on top.
  return { kind, style: [style, { fontFamily, fontWeight: 'normal' as const }] };
}

export function Text({ style, ...props }: ComponentPropsWithRef<typeof RNText>) {
  const resolved = useFontStyle(style);
  return (
    <FontKind.Provider value={resolved.kind}>
      <RNText {...props} style={resolved.style} />
    </FontKind.Provider>
  );
}

export function TextInput({ style, ...props }: ComponentPropsWithRef<typeof RNTextInput>) {
  const resolved = useFontStyle(style);
  return <RNTextInput {...props} style={resolved.style} />;
}

// Instance type, so `useRef<TextInput>(null)` keeps working.
export type TextInput = RNTextInput;
