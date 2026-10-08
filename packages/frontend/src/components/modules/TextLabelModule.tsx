/**
 * Text Label Module
 * Simple text display with customizable styling
 */

import { ModuleProps } from './index';

interface TextLabelConfig {
  text?: string;
  fontSize?: 'small' | 'medium' | 'large' | 'xlarge';
  align?: 'left' | 'center' | 'right';
  color?: string;
}

const FONT_SIZES = {
  small: '0.875rem',
  medium: '1.25rem',
  large: '2rem',
  xlarge: '3rem',
};

export function TextLabelModule({ config }: ModuleProps) {
  const labelConfig = config as TextLabelConfig;
  const text = labelConfig.text || 'Label';
  const fontSize = FONT_SIZES[labelConfig.fontSize || 'medium'];
  const align = labelConfig.align || 'center';
  const color = labelConfig.color || 'var(--color-text)';

  return (
    <div className="text-label-module" style={{ textAlign: align }}>
      <span className="label-text" style={{ fontSize, color }}>
        {text}
      </span>

      <style>{`
        .text-label-module {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: 0.5rem;
        }

        .label-text {
          font-weight: 500;
          line-height: 1.3;
        }
      `}</style>
    </div>
  );
}
