import {
  Color,
  CustomBlending,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
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
import { airAt, makeAir, type Air } from './air.ts';
import { hourAt, keyBody, lightAt, luminance, makeLight } from './day.ts';
import { flashAt, seasonAt, weatherAt, yearAt, type Season, type Weather } from './weather.ts';
import { steadyWind, windAt, type Wind } from './wind.ts';

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

/** sRGB hex. The colours of the light are in day.ts, hour by hour. */
export const PALETTE = {
  parchment: 0xe8dcc0,
  ink: 0x3a2e22,
  waterShallow: 0x7fc0bd,
  waterDeep: 0x2f6687,
  // Lake water is greener, darker and stiller than the sea.
  lakeShallow: 0x8fb89a,
  lakeDeep: 0x2a5458,
  foam: 0xf4efe2,
  canopyLow: 0x41653f,
  canopyHigh: 0x8aa65a,
  trunk: 0x6b5137,
  pineLow: 0x2c4a3d,
  pineHigh: 0x587d5e,
  pineTrunk: 0x574333,
} as const;

/** How far the inked-in world reaches around the player, in tiles. Stands in for M5's explored area. */
export const REVEAL_RADIUS = 44;
/** Width of the fringe where land is a flat ink wash before it rises into the diorama. */
export const REVEAL_BAND = 15;
/** How far the edge of the known world wanders in and out, in tiles. */
const REVEAL_WOBBLE = 2.2;
/** Explorers carry a lantern: how many can light the land at once, how far each reaches (tiles) and how high it hangs. */
export const LAMPS = 4;
const LAMP_REACH = 7.5;
export const LAMP_HEIGHT = 0.8;
/** Luminance of open, level ground in the reference afternoon light. Blank parchment is drawn at this level. */
const DAY_LEVEL = 0.88;
/** How far the light on the parchment is pulled toward grey. */
const PAPER_GREY = 0.5;
/** What distant lightning adds to the sky fill: a cool white. */
const FLASH = [0.3, 0.35, 0.5];

// The sun travels a tilted arc: it rises east-south-east, leans south at midday and sets west-north-west.
// The moon follows the same arc twelve hours behind it.
const ARC_AXIS = (18 * Math.PI) / 180;
const ARC_TILT = (38 * Math.PI) / 180;
const EAST = new Vector3(Math.cos(ARC_AXIS), 0, Math.sin(ARC_AXIS));
const SOUTH = new Vector3(-Math.sin(ARC_AXIS), 0, Math.cos(ARC_AXIS));

/** Direction toward the sun (or moon). `theta` runs from 0 (rising) through π/2 (highest) to π (setting). */
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
  /** The key light, sun or moon: linear colour times intensity. */
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
  /** The light falling on blank parchment, so the map dims and cools with the land at dusk. */
  uPaperLight: { value: new Color(1, 1, 1) },
  /** Explorers' lanterns. xyz: where one hangs; w: how bright it is (0 = none). */
  uLamps: { value: Array.from({ length: LAMPS }, () => new Vector4()) },
  /** Lantern light: linear colour times strength. Black by day. */
  uLampColor: { value: new Color(0, 0, 0) },
  /** Strength of the key light's glint on water. */
  uGlint: { value: 1 },
  /** The wind. xy: the direction it blows toward (world x, z); z: strength, 0–1; w: how far its gusts have travelled (a phase). */
  uWind: { value: new Vector4(1, 0, 0, 0) },
  /** Mist. rgb: its colour in this light; a: how thick it lies in the low ground, 0–1. */
  uFog: { value: new Vector4(1, 1, 1, 0) },
  /** x: the height below which mist is thickest; y: the height at which it has thinned to nothing; z: the water level. */
  uFogBand: { value: new Vector3(0.3, 6, 0) },
  /** The year. x: spring; y: autumn; z: winter (each 0–1); w: how much snow lies, 0–1. */
  uSeason: { value: new Vector4(0, 0, 0, 0) },
  /** How hard it is raining, 0–1: the land is darker when wet, and the water is pocked. */
  uRain: { value: 0 },
  /** The air. x: heat shimmer, 0–1; y: stars showing in still water, 0–1; z: broken cloud, 0–1; w: how far the cloud shadows have drifted, in tiles. */
  uAir: { value: new Vector4(0, 0, 0, 0) },
  /** Sunbeams in mist. xy: a unit vector across the beams (world x, z); z: their strength. */
  uShaft: { value: new Vector3(1, 0, 0) },
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
uniform vec3 uPaperLight;
uniform vec4 uLamps[${LAMPS}];
uniform vec3 uLampColor;
uniform float uGlint;
uniform vec4 uWind;
uniform vec4 uFog;
uniform vec3 uFogBand;
uniform vec4 uSeason;
uniform float uRain;
uniform vec4 uAir;
uniform vec3 uShaft;
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
// p is the spot on the map (world x, z): broken cloud lays slow shadows on the land that drift downwind,
// and the gaps between them are pools of sun.
float bakedShadow(vec3 shade, vec2 p) {
  float horizon = mix(shade.y, shade.z, uSunBake.y);
  float lit = smoothstep(horizon - uSunBake.z, horizon + uSunBake.z, uSunBake.x);
  if (uAir.z > 0.0) {
    vec2 q = p - uWind.xy * uAir.w;
    float cloud = sin(q.x * 0.11 + 1.3 * sin(q.y * 0.071)) * sin(q.y * 0.13 + 1.7 * sin(q.x * 0.059));
    float edge = 1.3 - 2.6 * uAir.z;
    lit *= 1.0 - 0.82 * smoothstep(edge - 0.3, edge + 0.3, cloud);
  }
  return lit;
}
// Warm key light, cool sky fill from above, warm bounce from below.
vec3 lightOn(vec3 n, float ao, float shadow) {
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 fill = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);
  return uSunColor * (ndl * shadow) + fill * ao;
}
// The wind at a spot. x: how hard it blows there right now, as gusts roll downwind in broad, wandering bands.
// y: a quick flutter (-1 to 1) that differs between neighbours.
vec2 windAt(vec2 p) {
  float along = dot(p, uWind.xy), across = dot(p, vec2(-uWind.y, uWind.x));
  float gust = 0.5 + 0.5 * sin(along * 0.2 - uWind.w + 1.6 * sin(across * 0.07 + uWind.w * 0.11));
  float flutter = sin(along * 1.9 + across * 1.3 - uWind.w * 5.3);
  return vec2(uWind.z * (0.3 + 0.7 * gust), flutter);
}
// Mist lies in the low ground, thins with height and drifts on the wind. Hilltops stand clear of it.
float fogAt(vec3 p) {
  if (uFog.a <= 0.0) return 0.0;
  float drift = 0.8 + 0.2 * sin(p.x * 0.13 + p.z * 0.09 - uWind.w * 0.35);
  return uFog.a * drift * (1.0 - smoothstep(uFogBand.x, uFogBand.y, p.y));
}
// The colour of the mist at a spot. A low sun rakes through it in long soft beams.
vec3 fogLight(vec3 p) {
  // Beams of uneven width and strength: a narrow wave times a broad one, both bent along their length.
  float across = dot(p.xz, uShaft.xy), along = dot(p.xz, vec2(-uShaft.y, uShaft.x));
  float ray = (0.5 + 0.5 * sin(across * 0.55 + 1.8 * sin(along * 0.045))) * (0.45 + 0.55 * sin(across * 0.17 + 1.1 * sin(along * 0.031) + 1.3));
  return uFog.rgb + uSunColor * (uShaft.z * max(ray, 0.0));
}
// A lit colour seen through the mist. most: how much of the mist this thing takes (1 for the land).
vec3 mistOn(vec3 lit, vec3 p, float most) {
  float f = fogAt(p) * most;
  return f > 0.0 ? mix(lit, fogLight(p), f) : lit;
}
// The turning year on anything green: fresher in spring, gold in autumn, straw in winter. Rain darkens the land.
vec3 seasonOn(vec3 albedo) {
  float green = clamp((albedo.g - max(albedo.r, albedo.b)) * 6.0, 0.0, 1.0);
  albedo *= mix(vec3(1.0), vec3(0.93, 1.07, 0.9), green * uSeason.x);
  albedo = mix(albedo, albedo * vec3(1.5, 1.02, 0.62), green * uSeason.y * 0.75);
  float l = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  albedo = mix(albedo, l * vec3(1.3, 1.08, 0.72), green * uSeason.z * 0.7);
  return albedo * (1.0 - 0.2 * uRain);
}
// Snow settles in drifts on whatever faces the sky (up is the surface normal's y), but not under water.
vec3 snowOn(vec3 albedo, vec3 p, float up) {
  if (uSeason.w <= 0.0) return albedo;
  // Three bent waves in three directions, so the drifts wander and never fall into rows or spots.
  float drift = 0.5 + 0.17 * (sin(p.x * 0.37 + p.z * 0.23 + 1.9 * sin(p.z * 0.097 - p.x * 0.031))
    + sin(p.z * 0.41 - p.x * 0.19 + 1.7 + 2.3 * sin(p.x * 0.083 + p.z * 0.047)))
    + 0.12 * sin(p.x * 0.21 - p.z * 0.33 + 0.7);
  float cover = smoothstep(drift - 0.25, drift + 0.25, uSeason.w * 1.5) * smoothstep(0.0, 0.15, uSeason.w)
    * smoothstep(0.45, 0.85, up) * step(uFogBand.z + 0.02, p.y);
  // Snow does not lie on desert sand (told by its colour: far more red than green).
  cover *= 1.0 - smoothstep(1.25, 1.5, albedo.r / max(albedo.g, 0.01));
  return mix(albedo, vec3(0.8, 0.85, 0.93), cover);
}
// Lantern light on a point: a warm pool around each explorer after dark, wrapped so level ground still catches it.
vec3 lampOn(vec3 p, vec3 n) {
  if (uLampColor.r <= 0.0) return vec3(0.0);
  float sum = 0.0;
  for (int i = 0; i < ${LAMPS}; i++) {
    vec3 d = uLamps[i].xyz - p;
    float r2 = dot(d, d);
    float fall = max(1.0 - r2 * ${(1 / (LAMP_REACH * LAMP_REACH)).toFixed(5)}, 0.0);
    sum += uLamps[i].w * fall * fall * (0.6 + 0.4 * dot(n, d) * inversesqrt(r2 + 0.05));
  }
  return uLampColor * sum;
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
  return mix(c, uInk, max(l.x, l.y) * 0.13 * (0.6 + 0.8 * blotch)) * uPaperLight;
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
attribute vec4 aColor;
attribute vec3 aShade;
varying vec3 vLit;
varying vec3 vWash;
varying float vForm;
varying float vReveal;
varying vec2 vMap;
varying vec2 vStrata;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float reveal = revealAt(world.xz);
  world.y = mix(-0.03, world.y, riseOf(reveal));
  vec3 albedo = snowOn(seasonOn(toLinear(aColor.rgb)), vec3(world.x, position.y, world.z), normal.y);
  // aColor.a: how strongly the rock's bedding shows here (cliffs, and bare mountain rock more faintly).
  vStrata = vec2(aColor.a, position.y);
  vec3 light = lightOn(normal, aShade.x, bakedShadow(aShade, world.xz)) + lampOn(world.xyz, normal) * aShade.x;
  // Heat: on a still summer noon the light over bare sand and rock wavers.
  if (uAir.x > 0.0) {
    vec3 base = toLinear(aColor.rgb);
    float bare = 1.0 - clamp((base.g - max(base.r, base.b)) * 6.0, 0.0, 1.0);
    light *= 1.0 + 0.045 * uAir.x * bare * sin(world.x * 2.3 - world.z * 1.9 + uTime * 4.3 + 2.0 * sin(world.z * 0.9 + uTime * 1.3));
  }
  vLit = mistOn(albedo * light, world.xyz, 1.0);
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
varying vec2 vStrata;
void main() {
  // Bedding: sheer rock shows the layers it was laid down in. They lie level across a face and dip a
  // little across the map: thin dark seams, and every other bed a shade darker.
  float bed = vStrata.y * 1.35 + vMap.x * 0.11 + vMap.y * 0.06;
  float seam = 1.0 - smoothstep(0.1, 0.24, abs(fract(bed) - 0.5) * 2.0);
  vec3 lit = vLit * (1.0 - vStrata.x * (0.2 * seam + 0.09 * step(0.5, fract(bed * 0.5))));
  gl_FragColor = vec4(grade(inkIn(lit, vWash, vForm, vReveal, vMap)), 1.0);
  ${FRAG_END}
}`,
  );
}

/**
 * Everything that grows: instanced trees and each chunk's merged ground cover.
 * `aColor.a` is the vertex's height above its root (in units of `lift` tiles).
 * Trees carry their baked shade per instance in `instanceColor` (ambient
 * occlusion, morning horizon, evening horizon); ground cover carries it per
 * vertex in `aShade`. Both grow out of the map at the edge of the known world.
 * `leafy` marks a broadleaf tree, which follows the seasons; a pine does not.
 */
export function foliageMaterial(lift: number, doubleSided = false, leafy = false): ShaderMaterial {
  const m = material(
    VERT_COMMON + /* glsl */ `
attribute vec4 aColor;
#ifndef USE_INSTANCING
attribute vec3 aShade;
#endif
varying vec3 vLit;
varying float vReveal;
varying float vFade;
varying vec2 vMap;
void main() {
  vec3 albedo = toLinear(aColor.rgb);
#ifdef USE_INSTANCING
  vec3 origin = instanceMatrix[3].xyz;
  vec3 local = (instanceMatrix * vec4(position, 1.0)).xyz;
  vec3 n = normalize(mat3(instanceMatrix) * normal);
  vec3 shade = instanceColor;
  // No two trees quite the same green: some cooler and deeper, some warmer and sunnier, by where they stand.
  float h = fract(sin(dot(origin.xz + modelMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  albedo *= mix(vec3(0.84, 0.92, 0.98), vec3(1.14, 1.06, 0.84), h);
#else
  vec3 local = position;
  vec3 origin = vec3(position.x, position.y - aColor.a * ${lift.toFixed(2)}, position.z);
  vec3 n = normal;
  vec3 shade = aShade;
#endif
  vec4 root = modelMatrix * vec4(origin, 1.0);
  float reveal = revealAt(root.xz);
#ifdef USE_INSTANCING
  // A tree beyond the known world is not there yet: skip the rest of the work for it.
  if (reveal < 0.62) {
    vLit = vec3(0.0);
    vReveal = 0.0;
    vFade = 1.0;
    vMap = vec2(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
#endif
  float rise = riseOf(reveal);
  // Things stand up a little after the ground under them has risen.
  float grow = smoothstep(0.62, 1.0, reveal);
  vec2 wind = windAt(root.xz);
  vec3 downwind = vec3(uWind.x, 0.0, uWind.y);
#ifdef USE_INSTANCING
  // A tree is stiff: its crown leans a little and rocks slowly. Neighbours rock nearly together, because
  // the rocking is a wave that travels downwind and each tree is only a little out of step with it. A
  // wood then moves as one, not as a crowd of trees each in its own time.
  float tall = local.y - origin.y;
  float bend = tall * tall * 0.05 * wind.x * (1.0 + 0.5 * sin(uWind.w * 2.1 - dot(root.xz, uWind.xy) * 0.3 + h * 1.5));
  // The light on a crown changes only as the crown itself moves: leaning the tree tilts its facets
  // with it (the normal of a sheared surface), by the same amount and at the same moment. Nothing
  // else may change a facet's brightness, or the crown flickers.
  n = normalize(n - vec3(0.0, dot(n, downwind) * 2.0 * bend / max(tall, 0.05), 0.0));
  // Crowns standing between the explorer and the eye thin out, so you can see yourself among the trunks.
  vec2 toEye = normalize(uViewDir.xz);
  vec2 rel = root.xz - uFocus - toEye * 1.7;
  float hide = length(vec2(dot(rel, toEye) / 2.6, dot(rel, vec2(-toEye.y, toEye.x)) / 1.3));
  vFade = mix(1.0, 0.18 + 0.82 * smoothstep(0.55, 1.0, hide), smoothstep(0.25, 0.45, position.y));
#ifdef LEAFY
  // Broadleaves follow the year: fresh in spring, turning gold or rust in autumn (each tree in its own week),
  // and bare in winter, drawn as a thinner, twig-coloured crown.
  float crown = smoothstep(0.3, 0.5, position.y);
  float ramp = clamp(dot(albedo, vec3(0.2126, 0.7152, 0.0722)) * 5.0, 0.5, 1.7);
  albedo *= mix(vec3(1.0), vec3(1.04, 1.13, 0.8), uSeason.x * crown);
  float late = fract(h * 7.31) * 0.5;
  albedo = mix(albedo, mix(vec3(0.5, 0.33, 0.08), vec3(0.33, 0.14, 0.06), h * h) * ramp,
    smoothstep(late, late + 0.5, uSeason.y) * crown * (0.55 + 0.4 * fract(h * 3.7)));
  float bare = uSeason.z * crown;
  albedo = mix(albedo, vec3(0.2, 0.135, 0.085) * ramp, bare * 0.85);
  local.xz = mix(local.xz, origin.xz + (local.xz - origin.xz) * 0.5, bare);
#endif
  albedo = snowOn(albedo, root.xyz, n.y);
#else
  albedo = snowOn(seasonOn(albedo), root.xyz, n.y);
  // Grass and leaves are supple: the tip goes with every gust, and bent grass shows its paler side.
  // The lean grows with height, a little less for tall things, which are stiffer. The flutter does not
  // grow with height: a reed four times as tall as a grass blade quivers by the same small amount.
  float tall = aColor.a * ${lift.toFixed(2)};
  float bend = wind.x * (tall * (1.0 - 0.35 * min(tall, 1.0)) + 0.07 * wind.y * min(tall * 4.0, 1.0));
  albedo *= 1.0 + 0.3 * (wind.x - 0.3 * uWind.z) * min(tall * 4.0, 1.0);
  vFade = 1.0;
#endif
  // Lean downwind, dipping a little so nothing stretches.
  vec3 lean = downwind * bend - vec3(0.0, 0.5 * bend * bend / max(tall, 0.05), 0.0);
  vec4 world = modelMatrix * vec4(origin + (local - origin + lean) * grow, 1.0);
  world.y = mix(-0.03, world.y, rise);
  vec3 light = lightOn(n, shade.x, bakedShadow(shade, root.xz)) + lampOn(world.xyz, n) * shade.x;
  vLit = mix(uParchment * uPaperLight * 0.8, mistOn(albedo * light, world.xyz, 1.0), grow);
  vReveal = reveal;
  vMap = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
    FRAG_COMMON + /* glsl */ `
varying vec3 vLit;
varying float vReveal;
varying float vFade;
varying vec2 vMap;
void main() {
  if (vReveal < 0.63) discard;
  // A thinned crown is drawn as a scatter of its own pixels: no blending, no sorting.
  if (vFade < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
  gl_FragColor = vec4(grade(vLit * (0.93 + 0.14 * toothAt(vMap))), 1.0);
  ${FRAG_END}
}`,
  );
  if (doubleSided) m.side = DoubleSide;
  if (leafy) m.defines = { LEAFY: '' };
  return m;
}

/** Water: depth-tinted, faceted by its own ripples, with a sun glint and a lapping foam line at the shore. */
export function waterMaterial(): ShaderMaterial {
  const m = material(
    VERT_COMMON + /* glsl */ `
attribute float aDepth;
attribute float aLake;
attribute vec3 aShade;
varying float vLake;
varying vec3 vWorld;
varying float vDepth;
varying float vShadow;
varying float vRise;
varying vec3 vLamp;
varying float vGust;
varying float vFog;
varying vec3 vFogLight;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float rise = riseOf(revealAt(world.xz));
  // Ripples grow with depth so they never cut into the shoreline, and with the wind.
  // A lake lies stiller than the sea.
  float swell = 0.05 * smoothstep(0.05, 1.2, aDepth) * rise * (0.7 + 0.9 * uWind.z) * (1.0 - 0.6 * aLake);
  vLake = aLake;
  vGust = windAt(world.xz).x;
  vFog = fogAt(world.xyz);
  vFogLight = fogLight(world.xyz);
  world.y += swell * (sin(world.x * 0.9 + uTime * 1.1) + sin(world.z * 1.3 - uTime * 0.8 + world.x * 0.4));
  vWorld = world.xyz;
  vDepth = aDepth;
  vLamp = lampOn(world.xyz, vec3(0.0, 1.0, 0.0));
  vShadow = bakedShadow(aShade, world.xz);
  vRise = rise;
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
    FRAG_COMMON + /* glsl */ `
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uLakeShallow;
uniform vec3 uLakeDeep;
uniform vec3 uFoam;
varying float vLake;
varying vec3 vWorld;
varying float vDepth;
varying float vShadow;
varying float vRise;
varying vec3 vLamp;
varying float vGust;
varying float vFog;
varying vec3 vFogLight;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  // Face normal from screen-space derivatives: each ripple facet catches the light on its own.
  vec3 n = cross(dFdx(vWorld), dFdy(vWorld));
  n = normalize(vec3(n.x * 5.0, abs(n.y), n.z * 5.0));
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 light = uSunColor * (ndl * vShadow) + mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5) + vLamp;
  // A gust ruffles the surface and darkens it as it passes (a cat's paw).
  float deep = smoothstep(0.0, 2.4, vDepth);
  vec3 col = mix(mix(uShallow, uDeep, deep), mix(uLakeShallow, uLakeDeep, deep), vLake) * light * (1.0 - 0.16 * vGust);
  float glint = pow(max(dot(n, normalize(uSunDir + uViewDir)), 0.0), 48.0);
  col += uSunColor * (glint * 0.5 * uGlint * vShadow);
  float alpha = mix(0.6, 0.96, smoothstep(0.0, 1.6, vDepth));
  // Foam where the water thins out, breathing in and out along the shore.
  float lap = 0.045 + 0.025 * sin(uTime * 0.8 + vWorld.x * 0.6 + vWorld.z * 0.45);
  float foam = 1.0 - smoothstep(lap * 0.5, lap, vDepth);
  // A lake only laps: its edge is a thin pale line, not surf.
  foam *= 1.0 - 0.55 * vLake;
  col = mix(col, uFoam * (light * 0.9), foam * 0.8);
  alpha = max(alpha, foam * 0.75);
  // Rain pocks the surface: a scatter of small bright rings, each gone in a moment.
  if (uRain > 0.0) {
    vec2 cell = vWorld.xz * 3.3 + 0.37 * vWorld.zx, in_ = fract(cell) - 0.5;
    float drop = hash(floor(cell) + floor(uTime * 7.0) * 17.0);
    col += uSkyColor * (0.4 * uRain * step(0.965, drop) * (1.0 - smoothstep(0.15, 0.4, length(in_))));
  }
  // On a clear, still night the stars lie in the water: fixed points that twinkle, a few in each tile.
  if (uAir.y > 0.0) {
    vec2 cell = vWorld.xz * 1.7, id = floor(cell);
    float r = hash(id);
    vec2 off = fract(cell) - 0.5 - 0.6 * (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5);
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.7 + 2.0 * r) + r * 40.0);
    col += vec3(0.8, 0.88, 1.0) * (uAir.y * step(0.84, r) * twinkle * smoothstep(0.5, 1.6, vDepth)
      * (1.0 - smoothstep(0.035, 0.085, length(off))));
  }
  col *= 0.95 + 0.1 * toothAt(vWorld.xz);
  col = mix(col, vFogLight, vFog);
  gl_FragColor = vec4(grade(col), alpha * vRise);
  ${FRAG_END}
}`,
    {
      uShallow: { value: new Color(PALETTE.waterShallow) },
      uDeep: { value: new Color(PALETTE.waterDeep) },
      uLakeShallow: { value: new Color(PALETTE.lakeShallow) },
      uLakeDeep: { value: new Color(PALETTE.lakeDeep) },
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

/**
 * A solid colour under the same light and grade (explorers, for now). `shade` is the baked shade of the
 * ground it stands on (see Terrain.shadeAt), so a figure walking into a hill's shadow darkens with the land.
 * The model's `aTone` (optional, 0–1 per vertex) darkens parts of it, such as a base.
 */
export function solidMaterial(color: Color, shade: Vector3): ShaderMaterial {
  return material(
    VERT_COMMON + /* glsl */ `
uniform vec3 uColor;
uniform vec3 uShade;
attribute float aTone;
varying vec3 vLit;
void main() {
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vLit = uColor * aTone * (lightOn(n, uShade.x, bakedShadow(uShade, world.xz)) + lampOn(world.xyz, n));
  vLit = mistOn(vLit, world.xyz, 0.6);
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
    FRAG_COMMON + /* glsl */ `
varying vec3 vLit;
void main() {
  gl_FragColor = vec4(grade(vLit), 1.0);
  ${FRAG_END}
}`,
    { uColor: { value: color }, uShade: { value: shade } },
  );
}

/**
 * The soft shadow a small thing leaves on the ground: a disc that fades to nothing at its rim (`aFade`),
 * darkening what is under it toward the sky's shadow colour. `uStrength.x` is its strength in the sun.
 */
export function blobShadowMaterial(strength: Vector2): ShaderMaterial {
  const m = material(
    VERT_COMMON + /* glsl */ `
attribute float aFade;
varying float vFade;
void main() {
  vFade = aFade;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    FRAG_COMMON + /* glsl */ `
uniform vec2 uStrength;
varying float vFade;
void main() {
  float a = vFade * vFade * (3.0 - 2.0 * vFade);
  gl_FragColor = vec4(grade(uSkyColor * 0.22), a * uStrength.x);
  ${FRAG_END}
}`,
    { uStrength: { value: strength } },
  );
  m.transparent = true;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  return m;
}

/**
 * Rain and snow (see precip.ts). Each quad carries where it sits in the box (`aSeed.xyz`) and its rank
 * (`aSeed.w`): in light rain only the low ranks fall. Nothing falls on the blank map.
 * fall: xyz the direction of fall, w how much is falling (0–1). shape: x streak length, y half width,
 * z opacity, w sideways wander. box: xyz its size, w the height of its floor. drift: xyz how far
 * everything has fallen so far (wrapped), w brightness.
 */
export function precipMaterial(fall: Vector4, shape: Vector4, box: Vector4, drift: Vector4): ShaderMaterial {
  const m = material(
    VERT_COMMON + /* glsl */ `
attribute vec4 aSeed;
uniform vec4 uFall;
uniform vec4 uShape;
uniform vec4 uBox;
uniform vec4 uDrift;
varying float vAlpha;
void main() {
  vec3 centre = vec3(uFocus.x, uBox.w + uBox.y * 0.5, uFocus.y);
  vec3 p = aSeed.xyz * uBox.xyz + uDrift.xyz;
  p.xz += uShape.w * vec2(sin(uTime * 1.3 + aSeed.x * 40.0), cos(uTime * 1.1 + aSeed.z * 40.0));
  // Wrap around the explorer, so the same drops stay put in the world as the explorer walks.
  p = mod(p - centre, uBox.xyz) - 0.5 * uBox.xyz + centre;
  vec3 side = normalize(cross(uFall.xyz, uViewDir));
  vec3 world = p - uFall.xyz * (uv.y * uShape.x) + side * ((uv.x - 0.5) * 2.0 * uShape.y);
  float shown = step(aSeed.w, uFall.w) * smoothstep(0.55, 0.9, revealAt(p.xz));
  // A streak fades toward its tail.
  vAlpha = uShape.z * shown * (1.0 - 0.85 * uv.y);
  gl_Position = shown > 0.0 ? projectionMatrix * viewMatrix * vec4(world, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`,
    FRAG_COMMON + /* glsl */ `
uniform vec4 uDrift;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(grade((uSkyColor * 1.5 + uSunColor * 0.3) * uDrift.w), vAlpha);
  ${FRAG_END}
}`,
    { uFall: { value: fall }, uShape: { value: shape }, uBox: { value: box }, uDrift: { value: drift } },
  );
  m.transparent = true;
  m.depthWrite = false;
  // A streak turns with the wind and the view, so either face may be toward the eye.
  m.side = DoubleSide;
  return m;
}

/**
 * Motes (see motes.ts): small things hanging in the air near the ground. One instanced quad each, facing
 * the eye. `aBase` is the spot on the ground a mote keeps to; `aSeed` makes each one different.
 * mote: x how many show (0–1); y what they are (0 dust and pollen, 1 falling leaves, 2 fireflies).
 * Colour is written premultiplied, so fireflies add their light and dust and leaves cover what is behind.
 */
export function motesMaterial(mote: Vector4): ShaderMaterial {
  const m = material(
    VERT_COMMON + /* glsl */ `
attribute vec3 aBase;
attribute vec4 aSeed;
uniform vec4 uMote;
varying vec2 vAt;
varying vec4 vTint;
varying float vKind;
void main() {
  float t = uTime, s1 = aSeed.x * 40.0, s2 = aSeed.y * 40.0, size;
  vec3 p = aBase;
  vec2 corner = position.xy;
  vec4 tint;
  if (uMote.y < 0.5) {
    // Dust and pollen: specks that drift and glint as they turn in the sun.
    p.xz += 0.5 * vec2(sin(t * 0.31 + s1), cos(t * 0.27 + s2));
    p.y += 0.5 + 1.4 * aSeed.z + 0.25 * sin(t * 0.5 + s1);
    size = 0.03 + 0.02 * aSeed.w;
    tint = vec4(uSunColor * 0.9 + uSkyColor * 0.5, 0.25 + 0.35 * sin(t * 0.9 + s2));
  } else if (uMote.y < 1.5) {
    // Leaves: each comes down in its own time, carried downwind and tumbling.
    float fall = fract(t * (0.1 + 0.05 * aSeed.w) + aSeed.z);
    p.y += 2.4 * (1.0 - fall);
    p.xz += uWind.xy * (fall * 2.5 * uWind.z) + 0.3 * vec2(sin(t * 2.1 + s1), cos(t * 1.7 + s2));
    size = 0.055 + 0.03 * aSeed.w;
    float turn = t * 3.0 + s1;
    corner = vec2(corner.x * cos(turn) - corner.y * sin(turn), (corner.x * sin(turn) + corner.y * cos(turn)) * 0.6);
    tint = vec4(mix(vec3(0.5, 0.33, 0.08), vec3(0.33, 0.14, 0.06), aSeed.x) * (uSunColor * 0.6 + uSkyColor),
      0.95 * smoothstep(0.0, 0.08, fall) * (1.0 - smoothstep(0.9, 1.0, fall)));
  } else {
    // Fireflies: each wanders about its own spot and lights for a moment at a time.
    p.xz += 0.9 * vec2(sin(t * 0.23 + s1) + 0.4 * sin(t * 0.71 + s2), cos(t * 0.19 + s2) + 0.4 * cos(t * 0.67 + s1));
    p.y += 0.35 + 0.9 * aSeed.z + 0.2 * sin(t * 0.8 + s1);
    size = 0.12;
    tint = vec4(0.72, 0.95, 0.22, smoothstep(0.35, 0.9, sin(t * (0.9 + 0.8 * aSeed.w) + s2)));
  }
  // Nothing hangs over the blank map, and only the first so-many show when the air is nearly empty.
  float shown = step(fract(aSeed.x * 7.13 + aSeed.y * 3.7), uMote.x) * smoothstep(0.6, 0.9, revealAt(aBase.xz));
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = p + (right * corner.x + up * corner.y) * size;
  vAt = position.xy;
  vTint = vec4(tint.rgb, max(tint.a, 0.0) * shown);
  vKind = uMote.y;
  gl_Position = shown > 0.0 ? projectionMatrix * viewMatrix * vec4(world, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`,
    FRAG_COMMON + /* glsl */ `
varying vec2 vAt;
varying vec4 vTint;
varying float vKind;
void main() {
  float d = length(vAt);
  float a, cover;
  if (vKind > 1.5) {
    // A bright point in a soft halo. It adds light and hides nothing.
    float halo = max(1.0 - d, 0.0);
    a = halo * halo * 0.3 + (1.0 - smoothstep(0.12, 0.3, d));
    cover = 0.0;
  } else {
    a = vKind > 0.5 ? 1.0 : 1.0 - smoothstep(0.5, 1.0, d);
    cover = 1.0;
  }
  a *= vTint.a;
  // A firefly makes its own light, so the night's cool grade is not laid over it.
  gl_FragColor = vec4((vKind > 1.5 ? vTint.rgb : grade(vTint.rgb)) * a, a * cover);
  ${FRAG_END}
}`,
    { uMote: { value: mote } },
  );
  m.transparent = true;
  m.depthWrite = false;
  m.side = DoubleSide;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
  return m;
}

/** Sets the shared uniforms each frame from the time of day (see day.ts). */
export class Look {
  /** Pin the time of day (hours, 0–24), or null to follow the shared clock. */
  fixedHour: number | null = null;
  /** The hour being shown. */
  hour = 12;
  /** How much direct light there is, 0–1: what a small thing's own shadow should follow. */
  key = 1;
  private readonly light = makeLight();
  private readonly lamp = new Color(0xffae62);
  /** The light on open, level ground this frame (scratch). */
  private readonly open = [0, 0, 0];
  /** Hold the wind at this strength (0–1), or null to follow the shared clock. */
  fixedWind: number | null = null;
  readonly wind: Wind = { x: 1, y: 0, strength: 0 };
  /** Hold the weather (one of WEATHERS), or null to follow the shared clock. */
  fixedWeather: Weather | null = null;
  /** Hold the point in the year (0–4, see weather.ts), or null to follow the shared clock. */
  fixedYear: number | null = null;
  readonly weather: Weather = { cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0 };
  readonly season: Season = { spring: 0, summer: 1, autumn: 0, winter: 0 };
  /** What hangs in the air right now (see air.ts). */
  readonly air: Air = makeAir();
  private cloudDrift = 0;
  private windPhase = 0;
  private lastS = 0;

  constructor() {
    U.uGrain.value ??= grainTexture();
  }

  update(focus: { x: number; y: number }, viewDir: Vector3, timeS: number) {
    const hour = (this.hour = this.fixedHour ?? hourAt(Date.now()));
    const L = lightAt(hour, this.light);
    const now = Date.now();
    const S = seasonAt(this.fixedYear ?? yearAt(now), this.season), W = this.weather;
    if (this.fixedWeather) Object.assign(W, this.fixedWeather);
    else weatherAt(now, S, W);
    const fall = Math.max(W.rain, W.snow);
    const flash = W.storm > 0 ? W.storm * flashAt(now) : 0;

    // Gusts travel faster in a stronger wind, so their phase is added up frame by frame.
    const w = this.fixedWind === null ? windAt(now, this.wind) : steadyWind(this.fixedWind, this.wind);
    // Wet weather blows harder; mist needs still air.
    w.strength = Math.min(1, Math.max(0.05, w.strength + 0.22 * fall + 0.3 * W.storm - 0.12 * W.fog));
    const dt = Math.min(0.1, Math.max(0, timeS - this.lastS));
    this.lastS = timeS;
    this.windPhase = (this.windPhase + dt * (0.3 + 0.9 * w.strength)) % (Math.PI * 2000);
    U.uWind.value.set(w.x, w.y, w.strength, this.windPhase);
    this.cloudDrift += dt * (0.4 + 1.2 * w.strength);
    const air = airAt(hour, L.lamp, W, S, w.strength, this.air);

    // Weather bends the light it is given. Under cloud the sun goes in, the sky greys and brightens to fill
    // in for it, shadows soften and colour drains a little; lightning lifts everything for a moment.
    // The sun itself is dimmed spot by spot in the shader, as cloud shadows cross the land (see bakedShadow);
    // sunIn is the average of that, for setting the exposure.
    const overcast = luminance(L.sky), sunIn = 1 - 0.82 * W.cloud;
    for (let c = 0; c < 3; c++) {
      L.sky[c] = (L.sky[c] + (overcast - L.sky[c]) * 0.55 * W.cloud) * (1 + 0.3 * W.cloud) + flash * FLASH[c];
    }
    // In the heat of a summer noon the picture is a little brighter and a little bleached.
    L.level *= (1 - 0.14 * W.cloud - 0.1 * fall - 0.12 * W.storm - 0.05 * W.fog) * (1 + 0.6 * flash) * (1 + 0.04 * air.heat);
    L.sat *= (1 - 0.2 * W.cloud - 0.1 * W.fog) * (1 + 0.05 * S.spring + 0.04 * S.autumn - 0.1 * S.winter) * (1 - 0.06 * air.heat);
    L.soft += 0.1 * W.cloud;
    L.glint *= 1 - 0.85 * W.cloud;
    // The year colours the sun a little: lower and more golden in autumn, paler in winter.
    L.key[2] *= 1 - 0.1 * S.autumn;
    L.key[0] *= 1 - 0.07 * S.winter;
    const { moon, theta } = keyBody(hour);
    const dir = sunDirection(theta, U.uSunDir.value);
    // The key light fades out as it meets the horizon, where sun and moon change places.
    const t = Math.min(1, Math.max(0, dir.y / 0.09));
    const up = t * t * (3 - 2 * t);
    const flat = up * Math.max(0, dir.y) * sunIn;

    // Open, level ground is held at this hour's brightness; the three lights are scaled together to meet it.
    const k = L.key, s = L.sky, b = L.bounce, open = this.open;
    for (let c = 0; c < 3; c++) open[c] = k[c] * flat + s[c];
    const scale = L.level / Math.max(luminance(open), 1e-3);
    U.uSunColor.value.setRGB(k[0] * up * scale, k[1] * up * scale, k[2] * up * scale);
    U.uSkyColor.value.setRGB(s[0] * scale, s[1] * scale, s[2] * scale);
    U.uGroundColor.value.setRGB(b[0] * scale, b[1] * scale, b[2] * scale);
    // Parchment takes the same light as open ground, but only half its colour: it stays paper at dawn and dusk.
    const paper = scale / DAY_LEVEL, grey = luminance(open) * PAPER_GREY;
    U.uPaperLight.value.setRGB(
      (grey + open[0] * (1 - PAPER_GREY)) * paper,
      (grey + open[1] * (1 - PAPER_GREY)) * paper,
      (grey + open[2] * (1 - PAPER_GREY)) * paper,
    );

    // Mist takes the colour of the light on open ground. Rain and snow bring a little haze of their own.
    // Dawn mist is thinner and lies lower than a fog: it fills the hollows and sits on the water.
    const mist = Math.min(0.64, Math.max(0.64 * W.fog, air.mist) + 0.16 * W.rain + 0.22 * W.snow), m = scale * 0.95;
    U.uFog.value.set(open[0] * m, open[1] * m, open[2] * m, mist);
    U.uFogBand.value.y = 3.2 + 2.8 * Math.min(1, 2 * Math.max(W.fog, fall)) + 6 * W.fog;
    // A low sun (or, faintly, a low moon) rakes through the mist in beams that lie along its direction.
    const ground = Math.hypot(dir.x, dir.z) || 1, low = 1 - Math.min(1, Math.max(0, (dir.y - 0.1) / 0.4));
    U.uShaft.value.set(-dir.z / ground, dir.x / ground, up * low * sunIn * (moon ? 0.15 : 0.38));
    U.uAir.value.set(air.heat, air.stars, W.cloud, this.cloudDrift);
    // Snow lies through the winter, deeper while it is falling; a snowfall at any time leaves a dusting.
    U.uSeason.value.set(S.spring, S.autumn, S.winter, Math.max(S.winter * (0.55 + 0.45 * W.snow), 0.5 * W.snow));
    U.uRain.value = W.rain;

    U.uSunBake.value.set(
      Math.asin(Math.max(0, dir.y)) / (Math.PI / 2),
      Math.min(1, Math.max(0, (theta - 1.4) / 0.35)),
      L.soft,
    );
    // The darker the hour, the cooler the whole picture, as eyes see by moonlight.
    const cool = Math.min(1, Math.max(0, (0.5 - L.level) / 0.25));
    U.uGrade.value.set(1 - 0.2 * cool, 1 - 0.05 * cool, 1 + 0.25 * cool, L.sat);
    U.uGlint.value = L.glint;
    // A lantern flame is never quite still.
    const flicker = 1 + 0.035 * Math.sin(timeS * 7.3) + 0.025 * Math.sin(timeS * 12.1 + 1.3);
    U.uLampColor.value.copy(this.lamp).multiplyScalar(1.3 * L.lamp * flicker);
    this.key = up * sunIn * (moon ? 0.55 : 1);

    U.uViewDir.value.copy(viewDir);
    U.uFocus.value.set(focus.x, focus.y);
    U.uTime.value = timeS;
  }
}
