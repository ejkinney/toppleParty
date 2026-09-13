import { el, type ControlScheme, type SchemeContext } from './types.js';

/**
 * The card a phone shows when it has nothing to do: between rounds, while
 * spectating after elimination, or during an intro. It still shows the rules
 * of whatever is about to run so nobody starts a minigame confused.
 */
export const idleScheme = (ctx: SchemeContext): ControlScheme => {
  return {
    mount() {
      const card = el('div', 'center-card');
      if (ctx.meta) {
        card.append(
          el('span', 'pill', 'NEXT UP'),
          el('h1', 'big', ctx.meta.title),
          el('p', 'dim', ctx.meta.tagline),
        );
        const rules = el('div', 'rules');
        for (const rule of ctx.meta.rules) rules.append(el('span', '', rule));
        card.append(rules);
      } else {
        card.append(el('h1', 'big', 'HOLD TIGHT'), el('p', 'dim', 'Watch the big screen.'));
      }
      ctx.root.replaceChildren(card);
    },
    unmount() {
      ctx.root.replaceChildren();
    },
  };
};
