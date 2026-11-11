import {
  CapsuleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { PlayerInfo, TileCache } from '@terra/shared';
import { Terrain, WATER_Y } from './terrain.ts';

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
  private sun = new DirectionalLight(0xfff1dc, 2.8);
  private terrain: Terrain;
  private avatars = new Map<string, Avatar>();
  private labels = document.createElement('div');
  private yaw = Math.PI / 4;
  private targetYaw = Math.PI / 4;
  private lastT = performance.now();

  constructor(tiles: TileCache) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x0e1a24);
    this.canvas = this.renderer.domElement;

    this.terrain = new Terrain(tiles);
    this.scene.add(this.terrain.group);
    this.scene.add(new HemisphereLight(0xcfe3ff, 0x3a2e22, 0.75));
    this.sun.position.set(-0.6, 1, 0.35).multiplyScalar(100);
    this.scene.add(this.sun, this.sun.target);
    this.scene.background = new Color(0x0e1a24);

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

  frame(self: { x: number; y: number }, players: Player[], zoom: number) {
    const now = performance.now();
    const dt = Math.min((now - this.lastT) / 1000, 0.1);
    this.lastT = now;
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * TURN_SPEED);

    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

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
    this.sun.target.position.copy(target);
    // Low sun from the west-north-west so slopes facing away fall into shade.
    this.sun.position.copy(target).add(new Vector3(-90, 55, -30));

    // Ground seen at this pitch stretches ~1/sin(pitch) vertically.
    this.terrain.update(self.x, self.y, Math.hypot(w, h / Math.sin(PITCH)) / zoom / 2);

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
      (a.mesh.material as MeshLambertMaterial).dispose();
      a.label.remove();
      this.avatars.delete(id);
    }

    this.renderer.render(this.scene, this.camera);
  }

  private avatar(p: Player): Avatar {
    let a = this.avatars.get(p.info.id);
    if (a && a.hue === p.info.hue && a.name === p.info.name) return a;
    if (a) {
      this.scene.remove(a.mesh);
      a.label.remove();
    }
    const mat = new MeshLambertMaterial({ color: new Color().setHSL(p.info.hue / 360, 0.7, 0.55) });
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
