/**
 * Setup step order and hand-off between steps.
 *
 * The mirror's order is WiFi → License → Location → Airport → Face
 * (GET /api/setup/status, docs/LICENSING.md). The checklist in
 * app/setup/index.tsx is the hub; a step that finishes inside the setup flow
 * hands straight over to the next incomplete one instead of making the user
 * go back and tap it.
 */

import { router, type Href } from 'expo-router';
import { api, type SetupStatus } from './api';
import { logError } from './errors';
import { goBack } from './navigation';

export type SetupStepId = 'wifi' | 'license' | 'location' | 'airport' | 'face';

/**
 * The license screen is also opened from Settings. In the setup flow it skips
 * itself when licensing is off and its Continue moves on to the next step.
 */
export const LICENSE_SETUP_ROUTE: Href = {
  pathname: '/setup/license',
  params: { flow: 'setup' },
};

const ORDER: { id: SetupStepId; route: Href; isComplete: (s: SetupStatus) => boolean }[] = [
  { id: 'wifi', route: '/setup/wifi', isComplete: (s) => s.wifiConfigured },
  { id: 'license', route: LICENSE_SETUP_ROUTE, isComplete: (s) => s.licenseActivated },
  { id: 'location', route: '/setup/location', isComplete: (s) => s.locationConfigured },
  { id: 'airport', route: '/setup/airport', isComplete: (s) => s.airportConfigured },
  { id: 'face', route: '/setup/face', isComplete: (s) => s.faceEnrolled },
];

/**
 * Replace the current step with the first incomplete step after `after`.
 * When every later step is done (or the mirror can't be reached), go back to
 * the checklist, which moves on to the "all set" screen during onboarding.
 */
export async function continueSetup(after: SetupStepId): Promise<void> {
  try {
    const status = await api.getSetupStatus();
    const start = ORDER.findIndex((s) => s.id === after) + 1;
    const next = ORDER.slice(start).find((s) => !s.isComplete(status));
    if (next) {
      router.replace(next.route);
      return;
    }
  } catch (err) {
    logError('continueSetup', err, { after });
  }
  goBack('/setup');
}
