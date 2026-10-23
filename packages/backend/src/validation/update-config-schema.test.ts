import { describe, it, expect } from 'vitest';
import { updateConfigSchema } from './schemas.js';

describe('updateConfigSchema', () => {
  it('drops githubRepo: a paired phone must not choose where releases come from', () => {
    // The phone posts back the whole config it read, githubRepo included.
    const parsed = updateConfigSchema.parse({ autoUpdate: true, githubRepo: 'attacker/repo' });
    expect(parsed).toEqual({ autoUpdate: true });
  });

  it('drops notifyOnly from older phones: autoUpdate alone decides auto-install', () => {
    const parsed = updateConfigSchema.parse({ autoUpdate: true, notifyOnly: true });
    expect(parsed).toEqual({ autoUpdate: true });
  });
});
