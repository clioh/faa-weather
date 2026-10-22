/**
 * SkyGlass mark: a white mirror with two sky-blue diagonal bands.
 * Geometry from docs/design/brand/logo-mark.svg (64 x 92).
 */

import Svg, { Path } from 'react-native-svg';
import { colors } from '@/lib/theme';

const ASPECT = 64 / 92;

/** `size` is the mark's height; the width follows the artwork's proportions. */
export function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size * ASPECT} height={size} viewBox="0 0 64 92" accessibilityLabel="SkyGlass">
      <Path
        d="M11 2H53A9 9 0 0 1 62 11V81A9 9 0 0 1 53 90H11A9 9 0 0 1 2 81V11A9 9 0 0 1 11 2Z"
        fill={colors.text}
      />
      <Path d="M2 45L62 11V23L2 57Z" fill={colors.primary} />
      <Path d="M2 61L62 27V30L2 64Z" fill={colors.primary} />
    </Svg>
  );
}
