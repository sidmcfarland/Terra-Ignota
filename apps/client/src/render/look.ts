import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
} from 'three';
import { rand2 } from '@terra/shared';

/**
 * The look: palette, lighting and the master shaders every surface is built from.
 * docs/ART_DIRECTION.md is the source of truth; change both together.
 *
 * How it stays cheap: lighting is computed per vertex (flat-shaded faces carry
 * their face normal, so vertex lighting *is* flat shading), terrain shadows and
 * ambient occlusion are baked into vertex attributes when a chunk is built, and
 * colour grading runs at the end of each material's fragment shader, so there
 * is no full-screen pass and no shadow map.
 */

/** sRGB hex. */
export const PALETTE = {
  parchment: 0xe8dcc0,
  ink: 0x3a2e22,
  sun: 0xffe6be,
  sky: 0xb3cdec,
  bounce: 0x9c8566,
  waterShallow: 0x7fc0bd,
  waterDeep: 0x2f6687,
  foam: 0xf4efe2,
  canopyLow: 0x3e6243,
  canopyHigh: 0x6f9455,
  trunk: 0x6b5137,
} as const;

/** How far the inked-in world reaches around the player, in tiles. Stands in for M5's explored area. */
export const REVEAL_RADIUS = 44;
/** Width of the fringe where land is a flat ink wash before it rises into the diorama. */
export const REVEAL_BAND = 15;
/** How far the edge of the known world wanders in and out, in tiles. */
const REVEAL_WOBBLE = 2.2;

// The sun travels a tilted arc: it rises east-south-east, leans south at midday and sets west-north-west.
const ARC_AXIS = (18 * Math.PI) / 180;
const ARC_TILT = (38 * Math.PI) / 180;
const EAST = new Vector3(Math.cos(ARC_AXIS), 0, Math.sin(ARC_AXIS));
const SOUTH = new Vector3(-Math.sin(ARC_AXIS), 0, Math.cos(ARC_AXIS));

/** Direction toward the sun. `theta` runs from 0 (sunrise) through π/2 (midday) to π (sunset). */
export function sunDirection(theta: number, out = new Vector3()): Vector3 {
  const up = Math.sin(theta);
  return out
    .copy(EAST).multiplyScalar(Math.cos(theta))
    .addScaledVector(SOUTH, up * Math.sin(ARC_TILT))
    .setY(up * Math.cos(ARC_TILT))
    .normalize();
}

function azimuth(theta: number): [number, number] {
  const d = sunDirection(theta);
  const l = Math.hypot(d.x, d.z);
  return [d.x / l, d.z / l];
}
/**
 * Ground directions (world x, y) that terrain shadows are baked along: toward
 * the low morning sun and toward the low evening sun. A chunk stores, per
 * vertex, how high the land rises in each direction; the shader compares that
 * with the sun's elevation. Long soft shadows that follow the time of day, for
 * the price of one byte per vertex per direction.
 */
export const BAKE_EAST = azimuth((24 * Math.PI) / 180);
export const BAKE_WEST = azimuth((156 * Math.PI) / 180);

/** A small tileable noise texture: paper tooth up close, mottling at a larger scale. */
function grainTexture(): DataTexture {
  const S = 128;
  const data = new Uint8Array(S * S);
  const octaves: Array<[cells: number, amp: number]> = [[4, 0.34], [16, 0.28], [64, 0.2]];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0.18 * rand2(7, x, y);
    for (const [cells, amp] of octaves) {
      const fx = (x / S) * cells, fy = (y / S) * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = smooth(fx - ix), ty = smooth(fy - iy);
      const at = (i: number, j: number) => rand2(1000 + cells, i % cells, j % cells);
      const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
      const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
      v += amp * (a + (b - a) * ty);
    }
    data[y * S + x] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  const tex = new DataTexture(data, S, S, RedFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Uniforms shared by every material: set once per frame, seen by all. */
export const U = {
  uSunDir: { value: new Vector3(0, 1, 0) },
  /** Linear colour times intensity. */
  uSunColor: { value: new Color() },
  uSkyColor: { value: new Color() },
  uGroundColor: { value: new Color() },
  /** x: sun elevation as a fraction of 90°. y: which baked horizon to use (0 east, 1 west). z: shadow softness. */
  uSunBake: { value: new Vector3(0.3, 1, 0.045) },
  /** Direction from the scene toward the (orthographic) camera. */
  uViewDir: { value: new Vector3(0, 1, 0) },
  /** Centre of the known world (world x, z). */
  uFocus: { value: new Vector2() },
  /** x: radius, y: fringe width, z: edge wobble. */
  uReveal: { value: new Vector3(REVEAL_RADIUS, REVEAL_BAND, REVEAL_WOBBLE) },
  uParchment: { value: new Color(PALETTE.parchment) },
  uInk: { value: new Color(PALETTE.ink) },
  /** Colour grade: rgb tint, a = saturation. Day/night, weather and seasons move this, not the assets. */
  uGrade: { value: new Vector4(1, 1, 1, 1) },
  uTime: { value: 0 },
  uGrain: { value: null as DataTexture | null },
} satisfies Record<string, IUniform>;

const UNIFORMS_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uSunBake;
uniform vec3 uViewDir;
uniform vec2 uFocus;
uniform vec3 uReveal;
uniform vec3 uParchment;
uniform vec3 uInk;
uniform vec4 uGrade;
uniform float uTime;
`;

/** Vertex-stage helpers: the reveal (how inked-in a spot is) and the lighting model. */
export const VERT_COMMON = UNIFORMS_GLSL + /* glsl */ `
// 1 inside the known world, falling to 0 across the fringe. The wobble is
// anchored to the world, so the edge changes shape as the explorer moves.
float revealAt(vec2 p) {
  float d = distance(p, uFocus);
  d += uReveal.z * (sin(p.x * 0.11 + p.y * 0.07) + 0.7 * sin(p.y * 0.19 - p.x * 0.13 + 2.1)
    + 0.35 * sin(p.x * 0.53 + p.y * 0.41 + 0.6) + 0.25 * sin(p.y * 0.71 - p.x * 0.37 + 4.0));
  return 1.0 - smoothstep(uReveal.x - uReveal.y, uReveal.x, d);
}
// The outer part of the fringe is flat map; the inner part rises into the model.
float riseOf(float reveal) { return smoothstep(0.35, 0.9, reveal); }

// shade: x = ambient occlusion, y / z = baked horizon toward the morning / evening sun.
float bakedShadow(vec3 shade) {
  float horizon = mix(shade.y, shade.z, uSunBake.y);
  return smoothstep(horizon - uSunBake.z, horizon + uSunBake.z, uSunBake.x);
}
// Warm key light, cool sky fill from above, warm bounce from below.
vec3 lightOn(vec3 n, float ao, float shadow) {
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 fill = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);
  return uSunColor * (ndl * shadow) + fill * ao;
}
vec3 toLinear(vec3 srgb) { return pow(srgb, vec3(2.2)); }
`;

/** Fragment-stage helpers: paper, the ink-in transition and the colour grade. */
export const FRAG_COMMON = UNIFORMS_GLSL + /* glsl */ `
uniform sampler2D uGrain;

float toothAt(vec2 p) { return texture2D(uGrain, p * 0.11 + 0.37).r; }

// Blank parchment at a spot on the map: mottled, with a fine tooth and a faint hand-ruled graticule.
vec3 paperAt(vec2 p, float tooth) {
  float blotch = texture2D(uGrain, p * 0.013).r;
  vec3 c = uParchment * (0.905 + 0.13 * blotch + 0.06 * tooth);
  vec2 q = p + (blotch - 0.5) * 1.6;
  vec2 g = abs(fract(q / 64.0 + 0.5) - 0.5) * 64.0;
  vec2 fw = fwidth(q);
  vec2 l = 1.0 - smoothstep(fw * 0.5, fw * 1.5, g);
  return mix(c, uInk, max(l.x, l.y) * 0.13 * (0.6 + 0.8 * blotch));
}

vec3 grade(vec3 c) {
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uGrade.a) * uGrade.rgb;
  // Soft shoulder: bright sunlit faces roll off instead of clipping.
  vec3 over = max(c - 0.7, 0.0);
  return min(c, 0.7) + over / (1.0 + over * 2.2);
}

// lit: the surface in full colour. wash: its ink-wash tint relative to bare paper.
// form: how much light the face catches, so the land reads as a paper relief before its colour arrives.
vec3 inkIn(vec3 lit, vec3 wash, float form, float reveal, vec2 p) {
  float tooth = toothAt(p);
  lit *= 0.93 + 0.14 * tooth;
  vec3 paper = paperAt(p, tooth);
  vec3 flat_ = paper * mix(vec3(1.0), wash, smoothstep(0.0, 0.3, reveal));
  flat_ *= mix(1.0, 0.7 + 0.3 * form, smoothstep(0.3, 0.7, reveal));
  // The edge of the known world: a thin inked line with a soft sepia shadow inside it.
  float fw = fwidth(reveal) + 1e-5;
  float line = 1.0 - smoothstep(fw * 0.8, fw * 2.2, abs(reveal - 0.1));
  float shadow = smoothstep(0.1, 0.14, reveal) * (1.0 - smoothstep(0.14, 0.45, reveal));
  flat_ = mix(flat_, uInk, clamp(line * 0.55 + shadow * 0.12, 0.0, 1.0));
  return mix(flat_, lit, smoothstep(0.6, 1.0, reveal));
}
`;

const FRAG_END = /* glsl */ `
  #include <colorspace_fragment>
`;

function material(vertexShader: string, fragmentShader: string, extra: Record<string, IUniform> = {}): ShaderMaterial {
  return new ShaderMaterial({ uniforms: { ...U, ...extra }, vertexShader, fragmentShader });
}

/** Terrain: faceted ground with baked shadows that flattens into an ink wash at the edge of the known world. */
export function groundMaterial(): ShaderMaterial {
  return material(
    VERT_COMMON + /* glsl */ `
attribute vec3 aColor;
attribute vec3 aShade;
varying vec3 vLit;
varying vec3 vWash;
varying float vForm;
varying float vReveal;
varying vec2 vMap;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float reveal = revealAt(world.xz);
  world.y = mix(-0.03, world.y, riseOf(reveal));
  vec3 albedo = toLinear(aColor);
  vec3 light = lightOn(normal, aShade.x, bakedShadow(aShade));
  vLit = albedo * light;
  vForm = dot(light, vec3(0.3333));
  vWash = mix(vec3(1.0), albedo / uParchment, 0.42);
  vReveal = reveal;
  vMap = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
    FRAG_COMMON + /* glsl */ `
varying vec3 vLit;
varying vec3 vWash;
varying float vForm;
varying float vReveal;
varying vec2 vMap;
void main() {
  gl_FragColor = vec4(grade(inkIn(vLit, vWash, vForm, vReveal, vMap)), 1.0);
  ${FRAG_END}
}`,
  );
}

/**
 * Instanced foliage. Each instance carries its baked shade in `instanceColor`
 * (ambient occlusion, morning horizon, evening horizon) and shrinks into the
 * map at the edge of the known world.
 */
export function foliageMaterial(): ShaderMaterial {
  return material(
    VERT_COMMON + /* glsl */ `
attribute vec3 aColor;
varying vec3 vLit;
varying float vReveal;
varying vec2 vMap;
void main() {
  vec3 origin = instanceMatrix[3].xyz;
  vec3 local = (instanceMatrix * vec4(position, 1.0)).xyz;
  vec4 root = modelMatrix * vec4(origin, 1.0);
  float reveal = revealAt(root.xz);
  float rise = riseOf(reveal);
  // Trees stand up a little after the ground under them has risen.
  float grow = smoothstep(0.62, 1.0, reveal);
  vec4 world = modelMatrix * vec4(origin + (local - origin) * grow, 1.0);
  world.y = mix(-0.03, world.y, rise);
  vec3 n = normalize(mat3(instanceMatrix) * normal);
  // A little variety per tree, from where it stands.
  float h = fract(sin(dot(root.xz, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 albedo = toLinear(aColor) * (0.86 + 0.28 * h);
  vLit = mix(uParchment * 0.8, albedo * lightOn(n, instanceColor.x, bakedShadow(instanceColor)), grow);
  vReveal = reveal;
  vMap = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
    FRAG_COMMON + /* glsl */ `
varying vec3 vLit;
varying float vReveal;
varying vec2 vMap;
void main() {
  if (vReveal < 0.63) discard;
  gl_FragColor = vec4(grade(vLit * (0.93 + 0.14 * toothAt(vMap))), 1.0);
  ${FRAG_END}
}`,
  );
}

/** Water: depth-tinted, faceted by its own ripples, with a sun glint and a lapping foam line at the shore. */
export function waterMaterial(): ShaderMaterial {
  const m = material(
    VERT_COMMON + /* glsl */ `
attribute float aDepth;
attribute vec3 aShade;
varying vec3 vWorld;
varying float vDepth;
varying float vShadow;
varying float vRise;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float rise = riseOf(revealAt(world.xz));
  // Ripples grow with depth so they never cut into the shoreline.
  float swell = 0.05 * smoothstep(0.05, 1.2, aDepth) * rise;
  world.y += swell * (sin(world.x * 0.9 + uTime * 1.1) + sin(world.z * 1.3 - uTime * 0.8 + world.x * 0.4));
  vWorld = world.xyz;
  vDepth = aDepth;
  vShadow = bakedShadow(aShade);
  vRise = rise;
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
    FRAG_COMMON + /* glsl */ `
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
varying vec3 vWorld;
varying float vDepth;
varying float vShadow;
varying float vRise;
void main() {
  // Face normal from screen-space derivatives: each ripple facet catches the light on its own.
  vec3 n = cross(dFdx(vWorld), dFdy(vWorld));
  n = normalize(vec3(n.x * 5.0, abs(n.y), n.z * 5.0));
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 light = uSunColor * (ndl * vShadow) + mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 2.4, vDepth)) * light;
  float glint = pow(max(dot(n, normalize(uSunDir + uViewDir)), 0.0), 48.0);
  col += uSunColor * (glint * 0.5 * vShadow);
  float alpha = mix(0.6, 0.96, smoothstep(0.0, 1.6, vDepth));
  // Foam where the water thins out, breathing in and out along the shore.
  float lap = 0.045 + 0.025 * sin(uTime * 0.8 + vWorld.x * 0.6 + vWorld.z * 0.45);
  float foam = 1.0 - smoothstep(lap * 0.5, lap, vDepth);
  col = mix(col, uFoam * (light * 0.9), foam * 0.8);
  alpha = max(alpha, foam * 0.75);
  col *= 0.95 + 0.1 * toothAt(vWorld.xz);
  gl_FragColor = vec4(grade(col), alpha * vRise);
  ${FRAG_END}
}`,
    {
      uShallow: { value: new Color(PALETTE.waterShallow) },
      uDeep: { value: new Color(PALETTE.waterDeep) },
      uFoam: { value: new Color(PALETTE.foam) },
    },
  );
  m.transparent = true;
  m.depthWrite = false;
  return m;
}

/** The blank parchment the world sits on. Drawn far below the land but patterned as if it lay at sea level. */
export function paperMaterial(): ShaderMaterial {
  return material(
    VERT_COMMON + /* glsl */ `
varying vec2 vMap;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vMap = world.xz - uViewDir.xz * (world.y / uViewDir.y);
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
    FRAG_COMMON + /* glsl */ `
varying vec2 vMap;
void main() {
  gl_FragColor = vec4(grade(paperAt(vMap, toothAt(vMap))), 1.0);
  ${FRAG_END}
}`,
  );
}

/** A smooth-shaded solid colour under the same light and grade (explorers, for now). */
export function solidMaterial(color: Color): ShaderMaterial {
  return material(
    VERT_COMMON + /* glsl */ `
uniform vec3 uColor;
varying vec3 vLit;
void main() {
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vLit = uColor * lightOn(n, 1.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    FRAG_COMMON + /* glsl */ `
varying vec3 vLit;
void main() {
  gl_FragColor = vec4(grade(vLit), 1.0);
  ${FRAG_END}
}`,
    { uColor: { value: color } },
  );
}

/** Sets the shared uniforms each frame. For now one fixed key light: a late-afternoon sun. */
export class Look {
  /** Where the sun is on its arc, 0 (sunrise) to π (sunset). */
  sunTheta = (140 * Math.PI) / 180;
  private readonly sun = new Color(PALETTE.sun);
  private readonly sky = new Color(PALETTE.sky);
  private readonly bounce = new Color(PALETTE.bounce);

  constructor() {
    U.uGrain.value ??= grainTexture();
  }

  update(focus: { x: number; y: number }, viewDir: Vector3, timeS: number) {
    const dir = sunDirection(this.sunTheta, U.uSunDir.value);
    U.uSunBake.value.x = Math.asin(Math.max(0, dir.y)) / (Math.PI / 2);
    U.uSunBake.value.y = Math.min(1, Math.max(0, (this.sunTheta - 1.4) / 0.35));
    U.uSunColor.value.copy(this.sun).multiplyScalar(1.2);
    U.uSkyColor.value.copy(this.sky).multiplyScalar(0.66);
    U.uGroundColor.value.copy(this.bounce).multiplyScalar(0.34);
    U.uViewDir.value.copy(viewDir);
    U.uFocus.value.set(focus.x, focus.y);
    U.uTime.value = timeS;
  }
}
