import { Application, Container } from 'pixi.js';
import type { TileCache } from '@terra/shared';
import type { Player, View } from '../view.ts';
import { Avatars } from './avatars.ts';
import { Terrain } from './terrain.ts';

/** The original top-down PixiJS renderer. */
export class View2D implements View {
  private readonly app: Application;
  private readonly world: Container;
  private readonly terrain: Terrain;
  private readonly avatars: Avatars;

  private constructor(app: Application, world: Container, terrain: Terrain, avatars: Avatars) {
    this.app = app;
    this.world = world;
    this.terrain = terrain;
    this.avatars = avatars;
  }

  static async create(tiles: TileCache): Promise<View2D> {
    const app = new Application();
    await app.init({ resizeTo: window, background: '#0e1a24', antialias: true, autoDensity: true, resolution: devicePixelRatio, autoStart: false });
    const world = new Container();
    const terrain = new Terrain(tiles);
    world.addChild(terrain.container);
    const avatars = new Avatars();
    app.stage.addChild(world, avatars.container);
    return new View2D(app, world, terrain, avatars);
  }

  get canvas() {
    return this.app.canvas;
  }

  toWorld(d: { x: number; y: number }) {
    return d;
  }

  frame(self: { x: number; y: number }, players: Player[], zoom: number) {
    const w = this.app.screen.width, h = this.app.screen.height;
    this.world.scale.set(zoom);
    this.world.position.set(Math.round(w / 2 - self.x * zoom), Math.round(h / 2 - self.y * zoom));
    this.terrain.update(self.x, self.y, w / zoom, h / zoom);

    this.avatars.begin();
    for (const p of players) {
      this.avatars.draw(p.info, w / 2 + (p.x - self.x) * zoom, h / 2 + (p.y - self.y) * zoom, zoom, p.self);
    }
    this.avatars.end();
    this.app.render();
  }
}
