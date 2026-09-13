import { clamp } from '@topple/shared';
import { el, type ControlScheme, type SchemeContext } from './types.js';

/** Degrees of phone tilt that map to a fully deflected tray. */
const FULL_TILT_DEGREES = 26;

interface OrientationPermissionApi {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * Whole-phone tilt, with a drag pad as the fallback.
 *
 * Three things make this survivable on real phones:
 *  - iOS needs an explicit permission gesture, so there is a button for it.
 *  - Neutral is captured from the player's actual grip, not assumed flat.
 *  - If orientation is unavailable or denied, a drag pad reports the same
 *    axes, so the minigame does not care which path a player took.
 */
export const tiltTrayScheme = (ctx: SchemeContext): ControlScheme => {
  let bubble: HTMLElement | null = null;
  let surface: HTMLElement | null = null;
  let neutralBeta: number | null = null;
  let neutralGamma = 0;
  let listening = false;
  let pointerId: number | null = null;

  const publish = (x: number, y: number): void => {
    ctx.send.frame({ x, y });
    if (!bubble) return;
    bubble.style.transform = 'translate(' + x * 56 + 'px,' + -y * 56 + 'px)';
  };

  const onOrientation = (event: DeviceOrientationEvent): void => {
    const beta = event.beta;
    const gamma = event.gamma;
    if (beta === null || gamma === null) return;

    // First reading becomes neutral: however the player is holding the phone
    // right now is "flat tray".
    if (neutralBeta === null) {
      neutralBeta = beta;
      neutralGamma = gamma;
    }

    const x = clamp((gamma - neutralGamma) / FULL_TILT_DEGREES, -1, 1);
    // Tilting the top of the phone away lowers beta and should push the
    // marble away from the camera, hence the negation.
    const y = clamp(-(beta - neutralBeta) / FULL_TILT_DEGREES, -1, 1);
    publish(x, y);
  };

  const startListening = (): void => {
    if (listening) return;
    listening = true;
    neutralBeta = null;
    window.addEventListener('deviceorientation', onOrientation);
  };

  const stopListening = (): void => {
    listening = false;
    window.removeEventListener('deviceorientation', onOrientation);
  };

  const enableTouchFallback = (): void => {
    if (!surface) return;
    const move = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      const bounds = surface!.getBoundingClientRect();
      const x = clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2.4, -1, 1);
      const y = clamp(-((event.clientY - bounds.top) / bounds.height - 0.5) * 2.4, -1, 1);
      publish(x, y);
    };
    surface.addEventListener('pointerdown', (event) => {
      pointerId = event.pointerId;
      surface!.setPointerCapture(event.pointerId);
      move(event);
    });
    surface.addEventListener('pointermove', move);
    const release = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      publish(0, 0);
    };
    surface.addEventListener('pointerup', release);
    surface.addEventListener('pointercancel', release);
  };

  return {
    async mount() {
      const pad = el('div', 'pad');

      surface = el('div', 'tilt');
      surface.append(el('div', 'crosshair'));
      bubble = el('div', 'bubble');
      bubble.style.background = ctx.identity.color;
      surface.append(bubble);
      pad.append(surface);

      const row = el('div', 'row-buttons');
      const recentre = el('button', 'btn');
      recentre.textContent = 'RECENTRE';
      recentre.addEventListener('click', () => {
        neutralBeta = null;
        ctx.toast('Neutral set');
        ctx.haptic([15]);
      });
      row.append(recentre);
      pad.append(row);
      ctx.root.replaceChildren(pad);

      const api = (window.DeviceOrientationEvent ?? null) as unknown as OrientationPermissionApi | null;
      if (api && typeof api.requestPermission === 'function') {
        // iOS: needs a tap. Show the ask rather than silently doing nothing.
        const ask = el('button', 'btn primary');
        ask.textContent = 'ENABLE TILT';
        ask.addEventListener('click', () => {
          void api
            .requestPermission?.()
            .then((result) => {
              if (result === 'granted') {
                ask.remove();
                startListening();
              } else {
                ctx.toast('Tilt denied - drag the pad instead');
                enableTouchFallback();
              }
            })
            .catch(() => enableTouchFallback());
        });
        row.prepend(ask);
        enableTouchFallback();
      } else if (window.DeviceOrientationEvent) {
        startListening();
        enableTouchFallback();
      } else {
        ctx.toast('No tilt sensor - drag the pad');
        enableTouchFallback();
      }
    },

    unmount() {
      stopListening();
      bubble = null;
      surface = null;
      ctx.root.replaceChildren();
    },
  };
};
