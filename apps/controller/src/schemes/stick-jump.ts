import { Btn } from '@topple/shared';
import { Joystick, holdButton } from '../input/joystick.js';
import { el, type ControlScheme, type SchemeContext } from './types.js';

/**
 * Stick plus jump. The button both fires a discrete hop and holds a flag, so
 * tapping gives one precise jump and holding auto-hops the moment you land -
 * which is what you want when the sky is falling.
 */
export const stickJumpScheme = (ctx: SchemeContext): ControlScheme => {
  let stick: Joystick | null = null;
  let buttons = 0;

  return {
    mount() {
      const pad = el('div', 'pad');

      stick = new Joystick({ onChange: (x, y) => ctx.send.frame({ x, y }) });
      pad.append(stick.element);

      const row = el('div', 'row-buttons');
      row.append(
        holdButton('JUMP', {
          className: 'primary',
          down: () => {
            buttons |= Btn.A;
            ctx.send.frame({ b: buttons });
            ctx.send.act({ a: 'jump' });
            ctx.haptic([18]);
          },
          up: () => {
            buttons &= ~Btn.A;
            ctx.send.frame({ b: buttons });
          },
        }),
      );
      pad.append(row);

      ctx.root.replaceChildren(pad);
    },

    unmount() {
      stick?.destroy();
      stick = null;
      ctx.root.replaceChildren();
    },
  };
};
