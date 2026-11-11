import { Container, Graphics, Text } from 'pixi.js';
import type { PlayerInfo } from '@terra/shared';

interface Avatar {
  root: Container;
  body: Graphics;
  label: Text;
  hue: number;
  name: string;
}

function hsl(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** Player markers in screen space (crisp labels at any zoom). */
export class Avatars {
  readonly container = new Container();
  private avatars = new Map<string, Avatar>();
  private seen = new Set<string>();

  begin() {
    this.seen.clear();
  }

  draw(info: PlayerInfo, sx: number, sy: number, zoom: number, isSelf: boolean) {
    let a = this.avatars.get(info.id);
    if (!a || a.hue !== info.hue || a.name !== info.name) {
      a?.root.destroy({ children: true });
      const root = new Container();
      const body = new Graphics();
      const label = new Text({
        text: isSelf ? `${info.name} (you)` : info.name,
        style: { fill: 0xffffff, fontSize: 12, fontFamily: 'system-ui, sans-serif', stroke: { color: 0x000000, width: 3 } },
      });
      label.anchor.set(0.5, 1);
      root.addChild(body, label);
      this.container.addChild(root);
      a = { root, body, label, hue: info.hue, name: info.name };
      this.avatars.set(info.id, a);
    }
    const r = Math.max(5, zoom * 0.38);
    a.body.clear().circle(0, 0, r).fill(hsl(info.hue, 0.7, 0.55)).stroke({ color: isSelf ? 0xffffff : 0x10202c, width: 2 });
    a.label.y = -r - 3;
    a.root.position.set(sx, sy);
    this.seen.add(info.id);
  }

  end() {
    for (const [id, a] of this.avatars) {
      if (!this.seen.has(id)) {
        a.root.destroy({ children: true });
        this.avatars.delete(id);
      }
    }
  }
}
