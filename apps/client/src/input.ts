/** Keyboard + touch virtual-joystick movement input. */
export class Input {
  private keys = new Set<string>();
  private touch: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  private stick = document.getElementById('stick')!;
  private knob = document.getElementById('knob')!;

  constructor(target: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.key.toLowerCase());
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.touch) return;
      this.touch = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
      this.stick.style.display = 'block';
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.knob.style.transform = '';
    });
    target.addEventListener('pointermove', (e) => {
      if (this.touch?.id !== e.pointerId) return;
      let dx = (e.clientX - this.touch.ox) / 40, dy = (e.clientY - this.touch.oy) / 40;
      const len = Math.hypot(dx, dy);
      if (len > 1) (dx /= len), (dy /= len);
      this.touch.dx = dx;
      this.touch.dy = dy;
      this.knob.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`;
    });
    const end = (e: PointerEvent) => {
      if (this.touch?.id !== e.pointerId) return;
      this.touch = null;
      this.stick.style.display = 'none';
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
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
