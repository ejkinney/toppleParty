import type { PlayerState } from '../game/roster.js';

/** Player names come from phones, so everything user-authored is escaped. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  );
}

/**
 * All readable text lives in the DOM rather than in WebGL. It stays crisp at
 * any resolution, costs zero draw calls, and means a scene repaint is one
 * innerHTML write instead of rebuilding text geometry.
 *
 * Regions are written independently so a scene can update the timer at 10Hz
 * without touching the scoreboard.
 */
export class Overlay {
  private readonly root: HTMLElement;
  private readonly topRegion: HTMLElement;
  private readonly midRegion: HTMLElement;
  private readonly bottomRegion: HTMLElement;
  private readonly toastRail: HTMLElement;
  private readonly perfReadout: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.topRegion = div('row');
    this.midRegion = div('center');
    this.bottomRegion = div('row');
    this.toastRail = div('toast-rail');
    this.perfReadout = div('perf');
    this.root.append(this.topRegion, this.midRegion, this.bottomRegion, this.toastRail);
    document.body.append(this.perfReadout);
  }

  top(html: string): void {
    this.topRegion.innerHTML = html;
  }

  middle(html: string): void {
    this.midRegion.innerHTML = html;
  }

  bottom(html: string): void {
    this.bottomRegion.innerHTML = html;
  }

  clear(): void {
    this.top('');
    this.middle('');
    this.bottom('');
  }

  perf(text: string): void {
    this.perfReadout.textContent = text;
  }

  toast(text: string, tone: 'good' | 'bad' | 'info' = 'info'): void {
    const node = div('toast ' + tone);
    node.textContent = text;
    this.toastRail.append(node);
    // The CSS animation is 2.6s; removing at 2.8s avoids a visible pop.
    setTimeout(() => node.remove(), 2800);
  }

  /** Big centred number for round countdowns. Returns when the count hits zero. */
  async countdown(from: number, finalWord = 'GO'): Promise<void> {
    for (let n = from; n > 0; n--) {
      this.middle('<div class="countdown">' + n + '</div>');
      await wait(1000);
    }
    this.middle('<div class="countdown">' + escapeHtml(finalWord) + '</div>');
    await wait(600);
    this.middle('');
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function div(className: string): HTMLElement {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

/* ------------------------------------------------------------------ *
 * Shared fragments. Scenes compose these rather than hand-rolling markup,
 * which is what keeps the five minigames visually consistent for free.
 * ------------------------------------------------------------------ */

export function headerHtml(kicker: string, title: string, subtitle = ''): string {
  return (
    '<div class="stack">' +
    '<span class="kicker">' + escapeHtml(kicker) + '</span>' +
    '<h1 class="title">' + escapeHtml(title) + '</h1>' +
    (subtitle ? '<p class="subtitle">' + escapeHtml(subtitle) + '</p>' : '') +
    '</div>'
  );
}

export function timerHtml(seconds: number): string {
  const low = seconds <= 5;
  return (
    '<div class="card stack" style="align-items:flex-end">' +
    '<span class="kicker">TIME</span>' +
    '<span class="timer' + (low ? ' low' : '') + '">' + Math.ceil(Math.max(0, seconds)) + '</span>' +
    '</div>'
  );
}

export function rulesHtml(rules: readonly string[]): string {
  return '<ul class="rules">' + rules.map((rule) => '<li>' + escapeHtml(rule) + '</li>').join('') + '</ul>';
}

export function seatsHtml(players: PlayerState[]): string {
  if (players.length === 0) {
    return '<span class="hint">Waiting for players to join...</span>';
  }
  return (
    '<div class="seatlist">' +
    players
      .map((player) => {
        const classes = ['seat'];
        if (!player.online) classes.push('offline');
        if (player.eliminated) classes.push('out');
        return (
          '<div class="' + classes.join(' ') + '">' +
          '<span class="dot" style="background:' + player.identity.color + ';color:' + player.identity.color + '"></span>' +
          '<span>' + escapeHtml(player.identity.name) + '</span>' +
          '<span class="blocks">' + (player.eliminated ? 'OUT' : player.blocks + ' blk') + '</span>' +
          '</div>'
        );
      })
      .join('') +
    '</div>'
  );
}

export function joinHtml(code: string, qr: string): string {
  return (
    '<div class="card join">' +
    (qr ? '<img src="' + qr + '" alt="Join QR code" />' : '') +
    '<div class="stack">' +
    '<span class="kicker">Join at</span>' +
    '<span class="subtitle">' + escapeHtml(hostLabel()) + '</span>' +
    '<span class="code">' + escapeHtml(code) + '</span>' +
    '</div>' +
    '</div>'
  );
}

let joinLabel = '';
export function setJoinLabel(url: string): void {
  joinLabel = url.replace(/^https?:\/\//, '').replace(/\/?\?c=.*$/, '');
}
function hostLabel(): string {
  return joinLabel || 'this network';
}
