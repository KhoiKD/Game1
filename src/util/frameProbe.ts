/**
 * Measures the average frame time over a window after a warm-up, for auto
 * quality. Feed it every frame; it reports once, when the window closes.
 */
export class FrameProbe {
  private startAt: number | null = null;
  private frames = 0;
  private total = 0;
  private finished = false;

  constructor(
    private readonly warmupMs: number,
    private readonly sampleMs: number,
  ) {}

  get done(): boolean {
    return this.finished;
  }

  /** Returns the average frame time in ms when the sample window closes, otherwise null. */
  sample(time: number, delta: number): number | null {
    if (this.finished) return null;
    if (this.startAt === null) this.startAt = time + this.warmupMs;
    if (time < this.startAt) return null;
    this.frames += 1;
    this.total += delta;
    if (time < this.startAt + this.sampleMs) return null;
    this.finished = true;
    return this.total / this.frames;
  }

  stop(): void {
    this.finished = true;
  }
}

/** Average frame time above this (about 36 fps) counts as slow. */
export const SLOW_FRAME_MS = 28;
