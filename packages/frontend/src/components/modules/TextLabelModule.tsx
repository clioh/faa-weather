/**
 * Text — a line of the user's own text.
 */

import { ModuleProps } from './index';
import { ModuleEmpty, ModuleFrame } from './ModuleFrame';
import './TextLabelModule.css';

const SIZES = ['small', 'medium', 'large'];
const ALIGNS = ['left', 'center', 'right'];

export function TextLabelModule({ config }: ModuleProps) {
  const text = typeof config.text === 'string' ? config.text.trim() : '';
  const fontSize =
    typeof config.fontSize === 'string' && SIZES.includes(config.fontSize)
      ? config.fontSize
      : 'medium';
  const align =
    typeof config.align === 'string' && ALIGNS.includes(config.align) ? config.align : 'left';

  if (!text) {
    return (
      <ModuleFrame title="Text">
        <ModuleEmpty title="No text" hint="Add your text in the app" />
      </ModuleFrame>
    );
  }

  return (
    <ModuleFrame className={`textlabel textlabel-${fontSize} textlabel-${align}`}>
      <p className="textlabel-text">{text}</p>
    </ModuleFrame>
  );
}
