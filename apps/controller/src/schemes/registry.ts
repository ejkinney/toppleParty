import type { SchemeId } from '@topple/shared';
import type { SchemeFactory } from './types.js';
import { idleScheme } from './idle.js';
import { stickDashScheme } from './stick-dash.js';
import { stickJumpScheme } from './stick-jump.js';
import { tiltTrayScheme } from './tilt-tray.js';
import { slingshotScheme } from './slingshot.js';
import { mashAltScheme } from './mash-alt.js';
import { jengaScheme } from './jenga.js';

/**
 * Every control surface the phone can mount, keyed by the id the host sends.
 * A new minigame that reuses one of these needs no controller changes at all.
 */
export const SCHEMES: Record<SchemeId, SchemeFactory> = {
  idle: idleScheme,
  'stick-dash': stickDashScheme,
  'tilt-tray': tiltTrayScheme,
  slingshot: slingshotScheme,
  'mash-alt': mashAltScheme,
  'stick-jump': stickJumpScheme,
  jenga: jengaScheme,
};
