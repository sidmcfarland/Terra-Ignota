import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LatheGeometry,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { PlayerInfo, TileCache } from '@terra/shared';
import { Look, PALETTE, REVEAL_RADIUS, U, blobShadowMaterial, paperMaterial, solidMaterial } from './look.ts';
import { Terrain, WATER_Y } from './terrain.ts';
import { ZoneLines } from './zones.ts';

export interface Player {
  info: PlayerInfo;
  x: number;
  y: number;
  self: boolean;
}

/** True isometric pitch: atan(1/√2). */
const PITCH = Math.atan(1 / Math.SQRT2);
const CAM_DIST = 400;
const TURN_SPEED = 8; // rad/s easing toward the target yaw
/** The parchment lies below the deepest seabed, so nothing ever dips under it. */
const PAPER_Y = -40;
const PERF_FRAMES = 120;

/** What the renderer is costing, for the debug panel and for checking budgets. */
export interface PerfStats {
  /** Time between frames (ms): mean and 95th percentile over the last couple of seconds. */
  frameMs: number;
  frameP95: number;
  /** Time spent inside `frame()` on the main thread (ms): mean and worst. */
  cpuMs: number;
  cpuMax: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  /** Chunk meshes built so far, and the slowest build (ms). */
  chunkBuilds: number;
  chunkBuildMax: number;
  pixelRatio: number;
}

interface Avatar {
  mesh: Mesh;
  shadow: Mesh;
  /** Baked shade of the ground under it, shared with its material. */
  shade: Vector3;
  /** x: how dark its shadow is right now. Shared with the shadow's material. */
  strength: Vector2;
  label: HTMLDivElement;
  hue: number;
  name: string;
}

/** Half-width of an explorer's shadow, in tiles, and the piece's height. */
const SHADOW_R = 0.27, PAWN_H = 0.9;
const pawnGeo = makePawn();
const shadowGeo = makeShadowDisc();

/**
 * The explorer, until characters are designed: a turned wooden playing piece standing on the map.
 * Eight flat sides, so it catches the light in facets like everything else.
 */
function makePawn(): BufferGeometry {
  const profile: Array<[number, number]> = [
    [0, 0], [0.25, 0], [0.25, 0.07], [0.16, 0.12], [0.09, 0.46], [0.15, 0.52], [0.08, 0.57],
    [0.14, 0.64], [0.17, 0.74], [0.14, 0.84], [0, PAWN_H],
  ];
  const lathe = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 8);
  const geo = lathe.toNonIndexed();
  lathe.dispose();
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  // The foot of the piece is a shade darker, like a felted base.
  const pos = geo.getAttribute('position');
  const tone = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    tone[i] = tone[i + 1] = tone[i + 2] = y < 0.1 ? 0.62 : 1;
  }
  geo.setAttribute('aTone', new BufferAttribute(tone, 1));
  return geo;
}

/** A unit disc on the ground, dark at its heart and fading to nothing at its rim. */
function makeShadowDisc(): BufferGeometry {
  const n = 16;
  const pos = new Float32Array((n + 1) * 3), fade = new Float32Array(n + 1), index: number[] = [];
  fade[0] = 1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pos[(i + 1) * 3] = Math.cos(a);
    pos[(i + 1) * 3 + 2] = Math.sin(a);
    index.push(0, 1 + ((i + 1) % n), 1 + i);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aFade', new BufferAttribute(fade, 1));
  geo.setIndex(index);
  return geo;
}

/** Three.js renderer with an orthographic isometric camera. Q / E rotate the view by 90°. */
export class GameView {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 1, CAM_DIST * 2);
  private look = new Look();
  private paper = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), paperMaterial());
  private terrain: Terrain;
  private zoneLines: ZoneLines;
  private avatars = new Map<string, Avatar>();
  private labels = document.createElement('div');
  private yaw = Math.PI / 4;
  private targetYaw = Math.PI / 4;
  private lastT = performance.now();
  private lastFrame = performance.now();
  private size = { w: 0, h: 0 };
  private viewDir = new Vector3();
  private tmpN = new Vector3();
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private frameTimes = new Float32Array(PERF_FRAMES);
  private cpuTimes = new Float32Array(PERF_FRAMES);
  private perfI = 0;

  constructor(tiles: TileCache) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(PALETTE.parchment);
    this.canvas = this.renderer.domElement;

    this.terrain = new Terrain(tiles);
    this.scene.add(this.terrain.group);
    this.zoneLines = new ZoneLines(tiles.seed);
    this.scene.add(this.zoneLines.group);
    // Drawn after the land, so it only costs the pixels the land leaves bare.
    this.paper.renderOrder = 1;
    this.paper.frustumCulled = false;
    this.scene.add(this.paper);

    this.labels.className = 'labels3d';
    document.body.appendChild(this.labels);

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'q') this.targetYaw -= Math.PI / 2;
      if (k === 'e') this.targetYaw += Math.PI / 2;
    });
  }

  /** Screen-relative input (x right, y down) → world direction, for the current camera yaw. */
  toWorld(d: { x: number; y: number }) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // Screen-up is the camera's ground-projected forward: (-sin, -cos) in world x/y.
    return { x: c * d.x + s * d.y, y: -s * d.x + c * d.y };
  }

  /** Draw zone borders and handoff margins on the ground (debug mode). */
  set showZones(on: boolean) {
    this.zoneLines.visible = on;
  }

  frame(self: { x: number; y: number }, players: Player[], zoom: number) {
    const now = performance.now();
    const dt = Math.min((now - this.lastT) / 1000, 0.1);
    this.lastT = now;
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * TURN_SPEED);

    const w = innerWidth, h = innerHeight;
    // setSize reassigns canvas.width, which reallocates the drawing buffer; only do it on resize.
    if (w !== this.size.w || h !== this.size.h) {
      this.size = { w, h };
      this.renderer.setSize(w, h);
    }

    const groundY = Math.max(this.terrain.heightAt(self.x, self.y), WATER_Y - 0.25);
    const target = new Vector3(self.x, groundY, self.y);
    const cp = Math.cos(PITCH);
    this.camera.position.set(
      target.x + CAM_DIST * cp * Math.sin(this.yaw),
      target.y + CAM_DIST * Math.sin(PITCH),
      target.z + CAM_DIST * cp * Math.cos(this.yaw),
    );
    this.camera.lookAt(target);
    this.camera.left = -w / 2 / zoom;
    this.camera.right = w / 2 / zoom;
    this.camera.top = h / 2 / zoom;
    this.camera.bottom = -h / 2 / zoom;
    this.camera.updateProjectionMatrix();
    this.viewDir.set(cp * Math.sin(this.yaw), Math.sin(PITCH), cp * Math.cos(this.yaw));
    this.look.update(self, this.viewDir, now / 1000);

    // Ground seen at this pitch stretches ~1/sin(pitch) vertically.
    const radius = Math.hypot(w, h / Math.sin(PITCH)) / zoom / 2;
    // Beyond the known world there is only parchment, so there is nothing to build or draw.
    this.terrain.update(self.x, self.y, Math.min(radius, REVEAL_RADIUS + 4));
    // The paper is far below the land, so it has to reach further up the screen to fill the view.
    const reach = (radius + Math.abs(PAPER_Y) / Math.tan(PITCH)) * 2.2;
    this.paper.position.set(target.x, PAPER_Y, target.z);
    this.paper.scale.set(reach, 1, reach);
    this.zoneLines.update(self.x, self.y, radius);

    const seen = new Set<string>();
    const v = new Vector3();
    for (const p of players) {
      const a = this.avatar(p);
      const gy = Math.max(this.terrain.heightAt(p.x, p.y), WATER_Y - 0.25);
      a.mesh.position.set(p.x, gy, p.y);
      this.ground(a, p.x, p.y);
      v.set(p.x, gy + 1.25, p.y).project(this.camera);
      a.label.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
      seen.add(p.info.id);
    }
    for (const [id, a] of this.avatars) {
      if (seen.has(id)) continue;
      this.retire(a);
      this.avatars.delete(id);
    }

    this.renderer.render(this.scene, this.camera);

    const i = this.perfI++ % PERF_FRAMES;
    this.frameTimes[i] = now - this.lastFrame;
    this.cpuTimes[i] = performance.now() - now;
    this.lastFrame = now;
  }

  get perf(): PerfStats {
    const n = Math.min(this.perfI, PERF_FRAMES);
    const frames = Array.from(this.frameTimes.subarray(0, n)).sort((a, b) => a - b);
    const cpu = this.cpuTimes.subarray(0, n);
    const mean = (a: ArrayLike<number>) => {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += a[k];
      return n ? sum / n : 0;
    };
    const info = this.renderer.info;
    return {
      frameMs: mean(frames),
      frameP95: frames[Math.floor(n * 0.95)] ?? 0,
      cpuMs: mean(cpu),
      cpuMax: n ? Math.max(...cpu) : 0,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      chunkBuilds: this.terrain.buildMs.count,
      chunkBuildMax: this.terrain.buildMs.max,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  /**
   * Render `frames` frames back to back, waiting for the GPU after each, and
   * report the mean milliseconds per frame. Unlike the frame interval, this
   * isn't capped by the display's refresh rate, so it shows headroom.
   */
  bench(frames = 60): number {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      this.renderer.render(this.scene, this.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return (performance.now() - t0) / frames;
  }

  private avatar(p: Player): Avatar {
    let a = this.avatars.get(p.info.id);
    if (a && a.hue === p.info.hue && a.name === p.info.name) return a;
    if (a) this.retire(a);
    const shade = new Vector3(1, 0, 0), strength = new Vector2(0, 0);
    const mesh = new Mesh(pawnGeo, solidMaterial(new Color().setHSL(p.info.hue / 360, 0.7, 0.55), shade));
    const shadow = new Mesh(shadowGeo, blobShadowMaterial(strength));
    shadow.matrixAutoUpdate = false;
    shadow.frustumCulled = false;
    this.scene.add(mesh, shadow);
    const label = document.createElement('div');
    label.textContent = p.self ? `${p.info.name} (you)` : p.info.name;
    this.labels.appendChild(label);
    a = { mesh, shadow, shade, strength, label, hue: p.info.hue, name: p.info.name };
    this.avatars.set(p.info.id, a);
    return a;
  }

  private retire(a: Avatar) {
    this.scene.remove(a.mesh, a.shadow);
    (a.mesh.material as ShaderMaterial).dispose();
    (a.shadow.material as ShaderMaterial).dispose();
    a.label.remove();
  }

  /**
   * Stand an explorer on the land: take the shade of the ground under it, and lay its shadow along the
   * slope, pointing away from the sun and longer when the sun is low. In shade only a soft dark patch is left.
   */
  private ground(a: Avatar, x: number, y: number) {
    const t = this.terrain, bake = U.uSunBake.value, sun = U.uSunDir.value;
    t.shadeAt(x, y, a.shade);
    const horizon = a.shade.y + (a.shade.z - a.shade.y) * bake.y;
    const lit = Math.min(1, Math.max(0, (bake.x - horizon + bake.z) / (2 * bake.z)));
    a.strength.x = 0.2 + 0.3 * lit;

    const h = t.heightAt(x, y), e = 0.3;
    const wet = h < WATER_Y;
    // The slope under it (flat on water), as a unit normal.
    const n = this.tmpN.set(
      wet ? 0 : (t.heightAt(x - e, y) - t.heightAt(x + e, y)) / (2 * e),
      1,
      wet ? 0 : (t.heightAt(x, y - e) - t.heightAt(x, y + e)) / (2 * e),
    ).normalize();
    // Along the ground, away from the sun.
    const along = this.tmpA.set(-sun.x, 0, -sun.z);
    along.addScaledVector(n, -along.dot(n)).normalize();
    const across = this.tmpB.crossVectors(n, along);
    const reach = lit * Math.min(2.2, (0.8 * PAWN_H * Math.hypot(sun.x, sun.z)) / Math.max(0.2, sun.y));
    const half = SHADOW_R + reach / 2;
    // The near end of the shadow stays under the piece; the far end reaches away from the sun.
    const cx = x + along.x * (reach / 2), cy = Math.max(h, WATER_Y) + along.y * (reach / 2), cz = y + along.z * (reach / 2);
    a.shadow.matrix
      .makeBasis(along.multiplyScalar(half), n, across.multiplyScalar(SHADOW_R))
      .setPosition(cx + n.x * 0.03, cy + n.y * 0.03, cz + n.z * 0.03);
    a.shadow.matrixWorldNeedsUpdate = true;
  }
}
