import { ordinal } from '@topple/shared';
import { el, type ControlScheme, type SchemeContext } from '../schemes/types.js';

/**
 * The non-playing screens. They implement ControlScheme so the router can
 * treat "you came third" and "here is a thumbstick" identically.
 */

/** Lobby: the phone's half of starting a game. */
export function readyScreen(ctx: SchemeContext, onReady: (on: boolean) => void): ControlScheme {
  let on = false;
  return {
    mount() {
      const card = el('div', 'center-card');
      const dot = el('span', 'pill');
      dot.textContent = ctx.identity.name;
      dot.style.background = ctx.identity.color;
      dot.style.color = '#0b1020';

      const button = el('button', 'btn primary', 'READY');
      button.type = 'button';
      button.addEventListener('click', () => {
        on = !on;
        button.textContent = on ? 'READY! (tap to undo)' : 'READY';
        button.classList.toggle('on', on);
        ctx.haptic([15]);
        onReady(on);
      });

      card.append(
        dot,
        el('h1', 'big', "YOU'RE IN"),
        el('p', 'dim', 'Everyone taps READY to begin. Your tower starts full.'),
        button,
      );
      ctx.root.replaceChildren(card);
    },
    unmount() {
      if (on) onReady(false);
      ctx.root.replaceChildren();
    },
  };
}

/** Shown between the minigame and the tower, so the penalty lands before the pull. */
export function resultScreen(
  ctx: SchemeContext,
  result: { place: number; of: number; pulls: number; scoreLine?: string },
): ControlScheme {
  return {
    mount() {
      const card = el('div', 'center-card');
      const won = result.place === 1;
      card.append(
        el('span', 'pill ' + (result.pulls > 0 ? 'bad' : 'good'), won ? 'WINNER' : 'RESULT'),
        el('h1', 'big', ordinal(result.place) + ' of ' + result.of),
      );
      if (result.scoreLine) card.append(el('p', 'dim', result.scoreLine));
      card.append(
        el(
          'h2',
          'mid',
          result.pulls > 0
            ? 'Pull ' + result.pulls + ' block' + (result.pulls === 1 ? '' : 's')
            : 'Your tower is safe',
        ),
      );
      ctx.root.replaceChildren(card);
    },
    unmount() {
      ctx.root.replaceChildren();
    },
  };
}

export function spectatorScreen(ctx: SchemeContext): ControlScheme {
  return {
    mount() {
      const card = el('div', 'center-card');
      card.append(
        el('span', 'pill bad', 'TOPPLED'),
        el('h1', 'big', 'YOU ARE OUT'),
        el('p', 'dim', 'Your tower fell. Stay for the carnage - the last tower standing wins.'),
      );
      ctx.root.replaceChildren(card);
    },
    unmount() {
      ctx.root.replaceChildren();
    },
  };
}

export function gameOverScreen(ctx: SchemeContext, winner: string, place: number): ControlScheme {
  return {
    mount() {
      const card = el('div', 'center-card');
      const youWon = place === 1;
      card.append(
        el('span', 'pill ' + (youWon ? 'good' : ''), 'GAME OVER'),
        el('h1', 'big', youWon ? 'YOU WON' : winner + ' WINS'),
      );
      if (place > 0) card.append(el('p', 'dim', 'You finished ' + ordinal(place) + '.'));
      card.append(el('p', 'dim', 'Another party starts from the TV.'));
      ctx.root.replaceChildren(card);
    },
    unmount() {
      ctx.root.replaceChildren();
    },
  };
}
