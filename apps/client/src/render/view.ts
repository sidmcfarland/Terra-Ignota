import {
  CapsuleGeometry,
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { PlayerInfo, TileCache } from '@terra/shared';
import { Look, PALETTE, REVEAL_RADIUS, paperMaterial, solidMaterial } from './look.ts';
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
  label: HTMLDivElement;
  hue: number;
  name: string;
}

const avatarGeo = new CapsuleGeometry(0.22, 0.45, 4, 10).translate(0, 0.45, 0);

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
      v.set(p.x, gy + 1.2, p.y).project(this.camera);
      a.label.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
      seen.add(p.info.id);
    }
    for (const [id, a] of this.avatars) {
      if (seen.has(id)) continue;
      this.scene.remove(a.mesh);
      (a.mesh.material as ShaderMaterial).dispose();
      a.label.remove();
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
    if (a) {
      this.scene.remove(a.mesh);
      a.label.remove();
    }
    const mat = solidMaterial(new Color().setHSL(p.info.hue / 360, 0.7, 0.55));
    const mesh = new Mesh(avatarGeo, mat);
    this.scene.add(mesh);
    const label = document.createElement('div');
    label.textContent = p.self ? `${p.info.name} (you)` : p.info.name;
    this.labels.appendChild(label);
    a = { mesh, label, hue: p.info.hue, name: p.info.name };
    this.avatars.set(p.info.id, a);
    return a;
  }
}
