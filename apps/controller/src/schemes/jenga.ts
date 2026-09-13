import { TOTAL_BLOCKS } from '@topple/shared';
import { JengaTower } from '../jenga/tower.js';
import { el, type ControlScheme, type SchemeContext } from './types.js';

/**
 * The between-rounds tower. It is a control scheme like any other, which is
 * what keeps the phone's screen router down to "mount whatever the host asked
 * for" with no special case for the one screen that has its own physics.
 */
export const jengaScheme = (ctx: SchemeContext): ControlScheme => {
  let tower: JengaTower | null = null;
  let statusLine: HTMLElement | null = null;
  let countLine: HTMLElement | null = null;
  let flash: HTMLElement | null = null;

  const setStatus = (text: string): void => {
    if (statusLine) statusLine.textContent = text;
  };

  const setCount = (blocks: number): void => {
    if (countLine) countLine.textContent = blocks + ' / ' + TOTAL_BLOCKS;
  };

  return {
    async mount() {
      const wrap = el('div', 'jenga');
      const canvas = document.createElement('canvas');
      wrap.append(canvas);

      const hud = el('div', 'jenga-hud');
      const pill = el('span', 'pill', 'YOUR TOWER');
      countLine = el('span', 'pill good');
      hud.append(pill, countLine);
      wrap.append(hud);

      const foot = el('div', 'jenga-foot');
      statusLine = el('div', 'hintline', 'Loading your tower...');
      foot.append(statusLine);
      wrap.append(foot);

      flash = el('div', 'flash');
      wrap.append(flash);

      ctx.root.replaceChildren(wrap);

      tower = new JengaTower({
        canvas,
        color: ctx.identity.color,
        haptic: (pattern) => ctx.haptic(pattern),
        onStatus: setStatus,
        onStream: (snapshot) => ctx.streamTower?.(snapshot),
        onResolve: (report) => {
          setCount(report.blocks);
          ctx.reportTower?.(report);
          if (report.collapsed) {
            flash?.classList.add('on');
            ctx.toast('TOWER DOWN');
          }
        },
      });

      await tower.init(ctx.jenga?.snapshot);
      setCount(tower.blockCount);
      tower.begin(ctx.jenga?.pulls ?? 1);
    },

    unmount() {
      tower?.dispose();
      tower = null;
      statusLine = null;
      countLine = null;
      flash = null;
      ctx.root.replaceChildren();
    },
  };
};
