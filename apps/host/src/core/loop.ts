/**
 * Fixed-step simulation with an interpolated render pass.
 *
 * Physics must run at exactly BALANCE.TICK_HZ or minigame tuning drifts with
 * the display; rendering runs at whatever the monitor does. The accumulator is
 * clamped so a stalled tab resumes instead of trying to catch up on 600 steps.
 */
export interface LoopCallbacks {
  fixedUpdate(dt: number): void;
  frame(dt: number, alpha: number): void;
}

export class Loop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private raf = 0;

  /** Rolling averages for the corner readout. */
  fps = 0;
  stepMs = 0;

  constructor(
    private readonly callbacks: LoopCallbacks,
    private readonly stepHz = 60,
    private readonly maxStepsPerFrame = 5,
  ) {}

  get fixedDelta(): number {
    return 1 / this.stepHz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    const elapsed = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;
    this.fps += ((1 / Math.max(elapsed, 0.0001)) - this.fps) * 0.05;

    const step = this.fixedDelta;
    this.accumulator += elapsed;

    const started = performance.now();
    let steps = 0;
    while (this.accumulator >= step && steps < this.maxStepsPerFrame) {
      this.callbacks.fixedUpdate(step);
      this.accumulator -= step;
      steps++;
    }
    // Dropping the backlog beats simulating in slow motion for the next second.
    if (this.accumulator > step * this.maxStepsPerFrame) this.accumulator = 0;
    this.stepMs += (performance.now() - started - this.stepMs) * 0.08;

    this.callbacks.frame(elapsed, this.accumulator / step);
  };
}
