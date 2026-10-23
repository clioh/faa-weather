import { describe, it, expect } from 'vitest';
import { presenceSchema } from './schemas.js';

describe('presenceSchema', () => {
  it("accepts the detector's absent report, which has null user fields", () => {
    // packages/presence/detector.py report_presence() once the state is ABSENT.
    const absent = {
      present: false,
      confidence: 0,
      state: 'absent',
      userId: null,
      userName: null,
      method: 'face_recognition',
    };
    expect(presenceSchema.safeParse(absent).success).toBe(true);
  });

  it('accepts a recognized user', () => {
    const present = {
      present: true,
      confidence: 0.54,
      state: 'present',
      userId: 'abc',
      userName: 'Clio',
    };
    expect(presenceSchema.safeParse(present).success).toBe(true);
  });
});
