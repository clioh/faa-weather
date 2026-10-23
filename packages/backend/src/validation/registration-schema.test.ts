import { describe, it, expect } from 'vitest';
import { registrationStartSchema } from './schemas.js';

describe('registrationStartSchema', () => {
  it('requires userId when the app or CLI starts a session', () => {
    expect(registrationStartSchema.safeParse({ userName: 'Clio' }).success).toBe(false);
    expect(registrationStartSchema.safeParse({ userId: 'pilot-1', userName: 'Clio' }).success).toBe(
      true
    );
  });

  it('has no presence-server variant: only the backend opens camera sessions', () => {
    // web_server.py no longer notifies /api/registration/start (docs/SECURITY.md).
    expect(registrationStartSchema.safeParse({ source: 'presence-server' }).success).toBe(false);
  });

  it('rejects ids the presence server would refuse', () => {
    expect(registrationStartSchema.safeParse({ userId: '../etc' }).success).toBe(false);
  });
});
