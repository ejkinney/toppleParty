import { clampDisc } from '@topple/shared';

export interface JoystickOptions {
  /** Radius in CSS pixels at which the stick reads fully deflected. */
  radius?: number;
  onChange(x: number, y: number): void;
}

/**
 * A floating touch thumbstick.
 *
 * Floating rather than fixed: the stick appears wherever the thumb lands, so
 * players never have to look down to find it. It tracks one pointer at a time
 * and ignores the rest, which is what lets a second thumb work a button in
 * parallel without stealing the stick.
 */
export class Joystick {
  readonly element: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private readonly radius: number;

  constructor(private readonly options: JoystickOptions) {
    this.radius = options.radius ?? 62;

    this.element = document.createElement('div');
    this.element.className = 'stick-zone';

    const hint = document.createElement('div');
    hint.className = 'stick-hint';
    hint.textContent = 'TOUCH TO STEER';

    this.base = document.createElement('div');
    this.base.className = 'stick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';

    this.element.append(hint, this.base, this.knob);

    this.element.addEventListener('pointerdown', this.onDown);
    this.element.addEventListener('pointermove', this.onMove);
    this.element.addEventListener('pointerup', this.onUp);
    this.element.addEventListener('pointercancel', this.onUp);
  }

  destroy(): void {
    this.element.remove();
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    this.element.setPointerCapture(event.pointerId);

    const bounds = this.element.getBoundingClientRect();
    this.originX = event.clientX - bounds.left;
    this.originY = event.clientY - bounds.top;

    this.base.style.left = this.originX + 'px';
    this.base.style.top = this.originY + 'px';
    this.element.classList.add('live');
    this.place(this.originX, this.originY);
    this.emit(0, 0);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const bounds = this.element.getBoundingClientRect();
    const dx = event.clientX - bounds.left - this.originX;
    const dy = event.clientY - bounds.top - this.originY;

    const normalised = clampDisc(dx / this.radius, dy / this.radius);
    this.place(this.originX + normalised.x * this.radius, this.originY + normalised.y * this.radius);
    // Screen y grows downward; the game's forward axis does not.
    this.emit(normalised.x, -normalised.y);
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.element.classList.remove('live');
    this.emit(0, 0);
  };

  private place(x: number, y: number): void {
    this.knob.style.left = x + 'px';
    this.knob.style.top = y + 'px';
  }

  private emit(x: number, y: number): void {
    this.options.onChange(x, y);
  }
}

/** A hold-to-press button that reports edges, used for dash/jump/brake. */
export function holdButton(
  label: string,
  handlers: { down?(): void; up?(): void; className?: string },
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'btn big ' + (handlers.className ?? '');
  button.textContent = label;
  button.type = 'button';

  let active = false;
  const down = (event: PointerEvent): void => {
    event.preventDefault();
    if (active) return;
    active = true;
    button.classList.add('on');
    button.setPointerCapture(event.pointerId);
    handlers.down?.();
  };
  const up = (event: PointerEvent): void => {
    if (!active) return;
    event.preventDefault();
    active = false;
    button.classList.remove('on');
    handlers.up?.();
  };

  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('pointerleave', up);
  return button;
}
