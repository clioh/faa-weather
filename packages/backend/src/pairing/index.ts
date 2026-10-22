/**
 * Process-wide pairing service and helpers (docs/SECURITY.md).
 */

import { getMirrorId, getMirrorName } from '../db/index.js';
import { PairingService } from './service.js';

export const pairingService = new PairingService({
  mirror: () => ({ id: getMirrorId(), name: getMirrorName() }),
});

/** DeviceAuthenticator for the HTTP gate and WebSocket upgrades. */
export const authenticateDevice = (token: string) => pairingService.authenticate(token);

export { PairingService, PairingError } from './service.js';
export type { PairingEvent, PublicDevice, PairingResult } from './service.js';
