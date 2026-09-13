import { clamp } from '@topple/shared';
import { el, type ControlScheme, type SchemeContext } from './types.js';

/** Drag distance in CSS pixels that counts as full power. */
const FULL_POWER_PIXELS = 170;
const MAX_AIM = 0.9;

/**
 * Pull-back-and-release. One gesture carries both aim and power, which is why
 * this is the only scheme with a canvas: the band, the arc and the power
 * colour all have to update under the thumb for the gesture to feel physical.
 */
export const slingshotScheme = (ctx: SchemeContext): ControlScheme => {
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let raf = 0;
  let pointerId: number | null = null;
  let anchor = { x: 0, y: 0 };
  let drag = { x: 0, y: 0 };
  let pulling = false;
  let hudNote = '';
  let hasFired = false;

  const resize = (): void => {
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.round(bounds.width * dpr);
    canvas.height = Math.round(bounds.height * dpr);
    context = canvas.getContext('2d');
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);
    anchor = { x: bounds.width / 2, y: bounds.height * 0.78 };
    drag = { ...anchor };
  };

  /** Shot heading: 0 is straight ahead, positive is to the player's right. */
  const shot = (): { aim: number; power: number } => {
    const pullX = anchor.x - drag.x;
    const pullY = anchor.y - drag.y;
    const distance = Math.hypot(pullX, pullY);
    // Pulling "down the screen" is a straight shot, so the y component is the
    // forward axis and x swings the heading left or right.
    const aim = clamp(Math.atan2(pullX, Math.max(Math.abs(pullY), 1)), -MAX_AIM, MAX_AIM);
    return { aim, power: clamp(distance / FULL_POWER_PIXELS, 0, 1) };
  };

  const draw = (): void => {
    raf = requestAnimationFrame(draw);
    if (!context || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const { aim, power } = shot();

    context.clearRect(0, 0, bounds.width, bounds.height);

    // Target lane, drawn as a perspective corridor toward the top of the pad.
    context.strokeStyle = 'rgba(255,255,255,0.10)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(anchor.x - 90, bounds.height * 0.92);
    context.lineTo(anchor.x - 26, bounds.height * 0.1);
    context.moveTo(anchor.x + 90, bounds.height * 0.92);
    context.lineTo(anchor.x + 26, bounds.height * 0.1);
    context.stroke();

    // Predicted arc.
    if (pulling && power > 0.02) {
      context.strokeStyle = ctx.identity.color;
      context.globalAlpha = 0.55;
      context.setLineDash([6, 8]);
      context.lineWidth = 3;
      context.beginPath();
      const reach = bounds.height * (0.18 + power * 0.6);
      for (let step = 0; step <= 24; step++) {
        const t = step / 24;
        const x = anchor.x + Math.sin(aim) * reach * t * 1.25;
        const y = anchor.y - reach * t;
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
    }

    // Band from the anchor to the thumb.
    context.strokeStyle = pulling ? '#ffc53d' : 'rgba(255,255,255,0.25)';
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(anchor.x - 42, anchor.y);
    context.lineTo(drag.x, drag.y);
    context.lineTo(anchor.x + 42, anchor.y);
    context.stroke();

    // The projectile in the pouch, tinted by power.
    context.fillStyle = power > 0.85 ? '#ff4d5a' : power > 0.5 ? '#ffc53d' : ctx.identity.color;
    context.beginPath();
    context.arc(drag.x, drag.y, 16, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = 'rgba(147,160,196,0.85)';
    context.font = '600 13px system-ui, sans-serif';
    context.textAlign = 'center';
    // The instruction outranks the clock until the player has actually fired;
    // the TV is already showing the timer to the whole room.
    const footer = pulling
      ? 'POWER ' + Math.round(power * 100) + '%'
      : hasFired
        ? hudNote || 'DRAG BACK, THEN LET GO'
        : 'DRAG BACK, THEN LET GO';
    context.fillText(footer, bounds.width / 2, bounds.height - 14);
  };

  return {
    mount() {
      const pad = el('div', 'pad');
      const box = el('div', 'sling');
      canvas = document.createElement('canvas');
      box.append(canvas);
      pad.append(box);
      ctx.root.replaceChildren(pad);

      resize();
      window.addEventListener('resize', resize);

      canvas.addEventListener('pointerdown', (event) => {
        if (pointerId !== null) return;
        pointerId = event.pointerId;
        canvas?.setPointerCapture(event.pointerId);
        pulling = true;
        const bounds = canvas!.getBoundingClientRect();
        drag = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      });

      canvas.addEventListener('pointermove', (event) => {
        if (event.pointerId !== pointerId) return;
        const bounds = canvas!.getBoundingClientRect();
        drag = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        const { aim, power } = shot();
        // Streaming the aim lets the TV show a live chevron before the shot.
        ctx.send.frame({ a: aim, p: power });
      });

      const release = (event: PointerEvent): void => {
        if (event.pointerId !== pointerId) return;
        pointerId = null;
        if (!pulling) return;
        pulling = false;
        const { aim, power } = shot();
        if (power > 0.08) {
          ctx.send.act({ a: 'fire', aim, power });
          ctx.haptic([25 + power * 55]);
          hasFired = true;
        }
        drag = { ...anchor };
        ctx.send.frame({ a: 0, p: 0 });
      };

      canvas.addEventListener('pointerup', release);
      canvas.addEventListener('pointercancel', release);

      raf = requestAnimationFrame(draw);
    },

    onHud(hud) {
      hudNote = hud.note ?? '';
    },

    unmount() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas = null;
      context = null;
      ctx.root.replaceChildren();
    },
  };
};
