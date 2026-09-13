import { el, type ControlScheme, type SchemeContext } from './types.js';

/**
 * Two slap pads that must be hit in turn.
 *
 * The pad you are supposed to hit next is outlined, which turns a mash game
 * into a rhythm game you can play without looking at the TV - and makes the
 * "wrong side stalls you" rule feel fair rather than punishing.
 */
export const mashAltScheme = (ctx: SchemeContext): ControlScheme => {
  let expected: 'l' | 'r' = 'l';
  let left: HTMLButtonElement | null = null;
  let right: HTMLButtonElement | null = null;
  let streak = 0;
  let fill: HTMLElement | null = null;

  const highlight = (): void => {
    left?.classList.toggle('next', expected === 'l');
    right?.classList.toggle('next', expected === 'r');
  };

  const slap = (side: 'l' | 'r'): void => {
    ctx.send.act({ a: 'slap', side });
    if (side === expected) {
      streak = Math.min(streak + 1, 20);
      ctx.haptic([12]);
      expected = side === 'l' ? 'r' : 'l';
    } else {
      streak = Math.max(0, streak - 4);
      ctx.haptic([40, 30, 40]);
    }
    if (fill) fill.style.width = (streak / 20) * 100 + '%';
    highlight();
  };

  const makePad = (side: 'l' | 'r', label: string): HTMLButtonElement => {
    const button = el('button', 'btn slap');
    button.textContent = label;
    button.type = 'button';
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      slap(side);
    });
    return button;
  };

  return {
    mount() {
      const pad = el('div', 'pad');
      const mash = el('div', 'mash');
      left = makePad('l', 'LEFT');
      right = makePad('r', 'RIGHT');
      mash.append(left, right);
      pad.append(mash);

      const meter = el('div', 'meter');
      fill = el('i');
      meter.append(fill);
      pad.append(meter);

      ctx.root.replaceChildren(pad);
      highlight();
    },

    unmount() {
      left = null;
      right = null;
      fill = null;
      ctx.root.replaceChildren();
    },
  };
};
