/**
 * SkyGlass mark: a mirror outline with an accent chevron.
 */

import Svg, { Path, Rect } from 'react-native-svg';
import { colors } from '@/lib/theme';

export function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityLabel="SkyGlass">
      <Rect x={5} y={2.5} width={14} height={19} rx={2} stroke={colors.text} strokeWidth={1.2} />
      <Path d="M9 8.5l3-2 3 2" stroke={colors.primary} strokeWidth={1.2} />
    </Svg>
  );
}
