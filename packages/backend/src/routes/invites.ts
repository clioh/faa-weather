/**
 * Accepting an invite (docs/SECURITY.md, "Pairing").
 *
 * Public (rate limited, like pairing):
 *   POST /api/invites/claim  { token, deviceName }  → { deviceId, token, mirror, user: { id, name } }
 *
 * Someone's phone added a person to this mirror and created an invite for
 * them (POST /api/users/:id/invite). Their phone redeems it here: it is
 * paired with the mirror as that person, who has then joined, and the
 * invite is used up. The invite token is single use and expires after
 * INVITE_TTL_MS; only its hash is stored.
 */

import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { deleteUserInvite, findInviteByTokenHash, getUser, markUserClaimed } from '../db/index.js';
import { hashToken, PairingError, type PairingService } from '../pairing/service.js';
import { createPairingLimiters, deviceNameSchema } from './pairing.js';
import { INVITE_TOKEN_PREFIX } from './users.js';

export const inviteClaimSchema = z.object({
  token: z.string().min(1).max(200),
  deviceName: deviceNameSchema,
});

const INVALID_INVITE = {
  error: 'invalid_invite',
  message: 'This invite has expired or was already used. Ask whoever invited you to send a new one.',
} as const;

export interface InvitesRouterOptions {
  service: PairingService;
  /** Rate limiters for claim (default: createPairingLimiters()). */
  limiters?: RequestHandler[];
}

export function createInvitesRouter({ service, limiters }: InvitesRouterOptions): Router {
  const router = Router();
  const limit = limiters ?? createPairingLimiters();

  router.post('/claim', ...limit, validateBody(inviteClaimSchema), (req, res) => {
    const { token, deviceName } = req.body as z.infer<typeof inviteClaimSchema>;
    res.setHeader('Cache-Control', 'no-store');

    const invite = token.startsWith(INVITE_TOKEN_PREFIX) ? findInviteByTokenHash(hashToken(token)) : null;
    if (!invite || !(Date.parse(invite.expires_at) > Date.now())) {
      res.status(400).json(INVALID_INVITE);
      return;
    }
    const user = getUser(invite.user_id);
    if (!user || user.claimed_at) {
      deleteUserInvite(invite.user_id);
      res.status(400).json(INVALID_INVITE);
      return;
    }

    try {
      const result = service.pairForUser(deviceName, user.id);
      markUserClaimed(user.id);
      deleteUserInvite(user.id);
      console.log(`[Invites] ${user.name} accepted their invite on "${deviceName}"`);
      res.json({ ...result, user: { id: user.id, name: user.name } });
    } catch (error) {
      if (error instanceof PairingError) {
        res.status(error.httpStatus).json({ error: error.code, message: error.message, ...error.extra });
        return;
      }
      console.error('[Invites] Claim failed:', error);
      res.status(500).json({ error: 'internal_error', message: 'Accepting the invite failed. Try again.' });
    }
  });

  return router;
}
