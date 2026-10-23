import { describe, it, expect } from 'vitest';
import { GRID_COLS, GRID_ROWS, SIZE_DIMENSIONS } from './modules';
import {
  LAYOUT_TEMPLATES,
  PORTRAIT_TEMPLATES,
  getTemplateById,
  templatesFor,
  validateTemplate,
} from './templates';

const ALL = [...LAYOUT_TEMPLATES, ...PORTRAIT_TEMPLATES];

describe('layout templates', () => {
  it.each(ALL.map((t) => [t.id, t] as const))('%s is valid', (_id, template) => {
    expect(validateTemplate(template)).toEqual([]);
  });

  it('ids are unique across both orientations', () => {
    expect(new Set(ALL.map((t) => t.id)).size).toBe(ALL.length);
  });

  it('every landscape template has a portrait variant with the same name', () => {
    for (const t of LAYOUT_TEMPLATES) {
      expect(t.orientation).toBe('landscape');
      const portrait = getTemplateById(`${t.id}-portrait`);
      expect(portrait?.orientation).toBe('portrait');
      expect(portrait?.name).toBe(t.name);
    }
    expect(PORTRAIT_TEMPLATES).toHaveLength(LAYOUT_TEMPLATES.length);
  });

  it('templatesFor picks the set for the orientation', () => {
    expect(templatesFor('landscape')).toBe(LAYOUT_TEMPLATES);
    expect(templatesFor('portrait')).toBe(PORTRAIT_TEMPLATES);
  });

  it('portrait templates use the bottom row (minimal is a centred stack)', () => {
    for (const t of PORTRAIT_TEMPLATES) {
      const bottom = Math.max(...t.modules.map((m) => m.position.y + SIZE_DIMENSIONS[m.size].rows));
      expect(bottom, t.id).toBeGreaterThanOrEqual(t.id === 'minimal-portrait' ? GRID_ROWS - 1 : GRID_ROWS);
    }
  });

  it('flags portrait-only problems', () => {
    const bad = {
      ...PORTRAIT_TEMPLATES[0],
      modules: [
        { moduleId: 'notams', position: { x: 0, y: 0 }, size: 'tall' as const, config: {} },
        { moduleId: 'metar', position: { x: 3, y: 0 }, size: 'medium' as const, config: {} },
        { moduleId: 'taf', position: { x: 0, y: 4 }, size: 'medium' as const, config: {} },
      ],
    };
    const problems = validateTemplate(bad);
    expect(problems.some((p) => p.includes('notams') && p.includes('too narrow'))).toBe(true);
    expect(problems.some((p) => p.includes('METAR should be large'))).toBe(true);
    expect(problems.some((p) => p.includes('taf') && p.includes('too narrow'))).toBe(true);
    // The same tiles pass as landscape.
    expect(validateTemplate({ ...bad, orientation: 'landscape' })).toEqual([]);
  });

  it('flags overlaps and tiles off the grid', () => {
    const bad = {
      ...LAYOUT_TEMPLATES[0],
      modules: [
        { moduleId: 'metar', position: { x: 0, y: 0 }, size: 'large' as const, config: {} },
        { moduleId: 'flight-rules', position: { x: 5, y: 3 }, size: 'small' as const, config: {} },
        { moduleId: 'flight-rules', position: { x: GRID_COLS - 2, y: 0 }, size: 'small' as const, config: {} },
      ],
    };
    const problems = validateTemplate(bad);
    expect(problems.some((p) => p.includes('overlaps'))).toBe(true);
    expect(problems.some((p) => p.includes('outside'))).toBe(true);
  });
});
