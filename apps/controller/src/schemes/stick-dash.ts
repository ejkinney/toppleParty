import { Btn, clamp } from '@topple/shared';
import { Joystick, holdButton } from '../input/joystick.js';
import { el, type ControlScheme, type SchemeContext } from './types.js';

/** Seconds of hold to reach a full-power dash. */
const CHARGE_TIME = 0.8;

/**
 * Stick plus a charged dash. Holding DASH fills a meter and releasing fires
 * it, so the tell on the TV (a player standing still, winding up) is honest -
 * you can see a slam coming, which is what makes dodging one satisfying.
 */
export const stickDashScheme = (ctx: SchemeContext): ControlScheme => {
  let stick: Joystick | null = null;
  let charging = false;
  let charge = 0;
  let raf = 0;
  let meterFill: HTMLElement | null = null;
  let buttons = 0;

  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    if (!charging) return;
    charge = clamp(charge + 1 / 60 / CHARGE_TIME, 0, 1);
    if (meterFill) meterFill.style.width = charge * 100 + '%';
    ctx.send.frame({ p: charge });
  };

  return {
    mount() {
      const pad = el('div', 'pad');

      stick = new Joystick({
        onChange: (x, y) => ctx.send.frame({ x, y }),
      });
      pad.append(stick.element);

      const meter = el('div', 'meter');
      meterFill = el('i');
      meter.append(meterFill);
      pad.append(meter);

      const row = el('div', 'row-buttons');
      row.append(
        holdButton('BRAKE', {
          down: () => {
            buttons |= Btn.B;
            ctx.send.frame({ b: buttons });
          },
          up: () => {
            buttons &= ~Btn.B;
            ctx.send.frame({ b: buttons });
          },
        }),
        holdButton('DASH', {
          className: 'primary',
          down: () => {
            charging = true;
            charge = 0;
          },
          up: () => {
            if (!charging) return;
            charging = false;
            ctx.send.act({ a: 'dash', charge });
            ctx.haptic([20 + charge * 60]);
            charge = 0;
            if (meterFill) meterFill.style.width = '0%';
            ctx.send.frame({ p: 0 });
          },
        }),
      );
      pad.append(row);

      ctx.root.replaceChildren(pad);
      raf = requestAnimationFrame(tick);
    },

    unmount() {
      cancelAnimationFrame(raf);
      stick?.destroy();
      stick = null;
      meterFill = null;
      ctx.root.replaceChildren();
    },
  };
};
