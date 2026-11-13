/**
 * Keeps the picture at 60 frames a second by trading sharpness for speed.
 * docs/ART_DIRECTION.md ("Technical constraints") has the budgets this serves.
 *
 * The cost of a frame on a phone is mostly pixels: the canvas is drawn at the
 * screen's pixel ratio, and a ratio of 2 is four times the pixels of 1. So when
 * frames run late the canvas is drawn a little coarser, and when they have run
 * on time for a while it is tried a little finer again. It drops quickly and
 * climbs slowly, and it remembers a ratio that proved too much, so it settles
 * instead of hunting.
 *
 * Plain numbers only: it is fed the time between frames and answers with a
 * pixel ratio when one should change. Nothing here touches the renderer.
 */

/** A frame later than this (ms) has missed 60 a second. A 60 Hz screen delivers one every 16.7. */
const LATE_MS = 19.5;
/** A gap longer than this (ms) is not a slow frame: the tab was hidden, or the device stalled on something else. */
const STALL_MS = 250;
/** Frames judged together: about three quarters of a second. */
const WINDOW = 45;
/** Frames ignored at the start, while the first chunks of the world are being built. */
const WARM_UP = 90;
/** Each step multiplies the ratio by this going down, and divides by it going up. */
const STEP = 0.85;
/** More than this share of late frames in a window, and the ratio drops. */
const TOO_MANY_LATE = 0.4;
/** Fewer than this share for CALM_WINDOWS windows running, and the ratio may rise. */
const FEW_LATE = 0.05;
const CALM_WINDOWS = 6;
/** After a drop, the ratio is held for this many windows (about 30 s) before it may rise. */
const HOLD = 40;
/** A drop this soon (windows) after a rise means the rise was a mistake: the next hold is doubled, up to MAX_HOLD. */
const REGRET = 16;
const MAX_HOLD = 640;

export class PixelRatioGovernor {
  /** The sharpest the canvas is ever drawn: the screen's own ratio, capped at 2. */
  readonly max: number;
  /** The coarsest: half of that, but never coarser than one canvas pixel to a CSS pixel. */
  readonly min: number;
  /** The ratio in force. */
  ratio: number;
  private frames = 0;
  private inWindow = 0;
  private late = 0;
  private calm = 0;
  private holdFor = 0;
  private nextHold = HOLD;
  private sinceRise = Infinity;

  constructor(deviceRatio: number) {
    this.max = Math.min(Math.max(deviceRatio, 1), 2);
    this.min = Math.max(1, this.max / 2);
    this.ratio = this.max;
  }

  /** Feed the time since the previous frame, in ms. Returns the new ratio if it should change now, else null. */
  sample(ms: number): number | null {
    if (!(ms > 0) || ms > STALL_MS) return null;
    if (this.frames++ < WARM_UP) return null;
    if (ms > LATE_MS) this.late++;
    if (++this.inWindow < WINDOW) return null;
    const share = this.late / WINDOW;
    this.inWindow = this.late = 0;
    this.sinceRise++;
    if (this.holdFor > 0) this.holdFor--;

    if (share > TOO_MANY_LATE) {
      this.calm = 0;
      if (this.ratio <= this.min) return null;
      // If this follows a rise closely, that rise was too much: wait longer before trying it again.
      this.nextHold = this.sinceRise <= REGRET ? Math.min(this.nextHold * 2, MAX_HOLD) : HOLD;
      this.holdFor = this.nextHold;
      this.ratio = Math.max(this.min, round(this.ratio * STEP));
      return this.ratio;
    }
    if (share >= FEW_LATE) {
      this.calm = 0;
      return null;
    }
    if (++this.calm < CALM_WINDOWS || this.holdFor > 0 || this.ratio >= this.max) return null;
    this.calm = 0;
    this.sinceRise = 0;
    this.ratio = Math.min(this.max, round(this.ratio / STEP));
    return this.ratio;
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
