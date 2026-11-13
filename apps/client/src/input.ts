/**
 * Keyboard + touch virtual-joystick movement input, and pinch to zoom.
 * One finger is the joystick. A second finger turns the gesture into a pinch:
 * the joystick lets go, and it stays let go until every finger has lifted, so
 * the finger left over from a pinch doesn't send the explorer walking.
 */
export class Input {
  private keys = new Set<string>();
  private touch: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  private stick = document.getElementById('stick')!;
  private knob = document.getElementById('knob')!;
  /** Every finger on the target, by pointer id. */
  private fingers = new Map<number, { x: number; y: number }>();
  /** The two fingers of a pinch and how far apart they last were. */
  private pinch: { a: number; b: number; dist: number } | null = null;
  /** True from a pinch's start until every finger has lifted. */
  private pinched = false;
  private onZoom: (factor: number) => void;

  /** `onZoom` is called with the factor to multiply the zoom by as a pinch opens (> 1) or closes (< 1). */
  constructor(target: HTMLElement, onZoom: (factor: number) => void = () => {}) {
    this.onZoom = onZoom;
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.key.toLowerCase());
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.fingers.size === 2 && !this.pinch) {
        const [a, b] = [...this.fingers.keys()];
        this.pinch = { a, b, dist: this.spread(a, b) };
        this.pinched = true;
        this.touch = null;
        this.stick.style.display = 'none';
        return;
      }
      if (this.touch || this.pinched) return;
      this.touch = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
      this.stick.style.display = 'block';
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.knob.style.transform = '';
    });
    target.addEventListener('pointermove', (e) => {
      const finger = this.fingers.get(e.pointerId);
      if (finger) (finger.x = e.clientX), (finger.y = e.clientY);
      if (this.pinch && (e.pointerId === this.pinch.a || e.pointerId === this.pinch.b)) {
        const dist = this.spread(this.pinch.a, this.pinch.b);
        // Fingers that touch give a distance near zero; a floor keeps the ratio sane.
        if (dist > 8 && this.pinch.dist > 8) this.onZoom(dist / this.pinch.dist);
        this.pinch.dist = dist;
        return;
      }
      if (this.touch?.id !== e.pointerId) return;
      let dx = (e.clientX - this.touch.ox) / 40, dy = (e.clientY - this.touch.oy) / 40;
      const len = Math.hypot(dx, dy);
      if (len > 1) (dx /= len), (dy /= len);
      this.touch.dx = dx;
      this.touch.dy = dy;
      this.knob.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`;
    });
    const end = (e: PointerEvent) => {
      this.fingers.delete(e.pointerId);
      if (this.pinch && (e.pointerId === this.pinch.a || e.pointerId === this.pinch.b)) this.pinch = null;
      if (this.fingers.size === 0) this.pinched = false;
      if (this.touch?.id !== e.pointerId) return;
      this.touch = null;
      this.stick.style.display = 'none';
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  /** How far apart two fingers are, in CSS pixels. */
  private spread(a: number, b: number): number {
    const p = this.fingers.get(a), q = this.fingers.get(b);
    return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : 0;
  }

  dir(): { x: number; y: number } {
    if (this.touch) {
      const { dx, dy } = this.touch;
      return Math.hypot(dx, dy) < 0.15 ? { x: 0, y: 0 } : { x: dx, y: dy };
    }
    const k = this.keys;
    return {
      x: (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0),
      y: (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0),
    };
  }
}
